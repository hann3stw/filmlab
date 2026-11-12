/**
 * The photo library: importing RAF files and keeping track of them.
 *
 *  - The RAF itself is copied into OPFS (raw/<id>.raf)
 *  - A small thumbnail is made from the JPEG preview INSIDE the RAF
 *    (no camera needed, very fast) → thumbs/<id>.jpg
 *  - Everything else (name, date, settings, edits) is a "Photo" record in IndexedDB
 */

import { dbDelete, dbGet, dbGetAll, dbPut } from '../storage/db.ts'
import { deleteFile, readFile, requestPersistence, writeFile } from '../storage/opfs.ts'
import { parseJpegExif, type ExifData } from '../raw/raf.ts'
import { recipeFromExif, type Recipe } from '../recipes/recipe.ts'
import { log } from '../ui/debug-log.ts'

export interface Photo {
  id: string
  fileName: string
  fileSize: number
  cameraName: string
  /** ISO date-time the photo was taken (from EXIF), or null */
  dateTaken: string | null
  importedAt: number
  /** Where the embedded JPEG preview sits inside the RAF */
  previewOffset: number
  previewLength: number
  /** Settings the photo was shot with (from EXIF) */
  asShot: Recipe
  /** Current edited settings, or null if never edited */
  recipe: Recipe | null
  /** Size of the camera-rendered JPEG (results/<id>.jpg), or null */
  resultSize: number | null
  editedAt: number | null
  favorite: boolean
  albums: string[]
  /** Pixel size of the thumbnail (for layout without waiting for the image) */
  /** Highest dynamic range this RAW can be developed with (known after first render) */
  maxDR?: number
  thumbW: number
  thumbH: number
}

const rawPath = (id: string) => `raw/${id}.raf`
const thumbPath = (id: string) => `thumbs/${id}.jpg`
const resultPath = (id: string) => `results/${id}.jpg`

// ---- change notifications (so screens can refresh themselves) -------------

const listeners = new Set<() => void>()
export function onPhotosChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify() { listeners.forEach(fn => fn()) }

// ---- reading -------------------------------------------------------------

export async function listPhotos(): Promise<Photo[]> {
  const all = await dbGetAll<Photo>('photos')
  // Newest photo first (by date taken, falling back to import time)
  return all.sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
}
function sortKey(p: Photo): string {
  return p.dateTaken ?? new Date(p.importedAt).toISOString()
}

export async function getPhoto(id: string): Promise<Photo | undefined> {
  return dbGet<Photo>('photos', id)
}

/** Object-URL cache so a thumbnail file is only turned into a URL once. */
const thumbUrls = new Map<string, string>()
export async function thumbUrl(id: string): Promise<string | null> {
  const cached = thumbUrls.get(id)
  if (cached) return cached
  const f = await readFile(thumbPath(id))
  if (!f) return null
  const url = URL.createObjectURL(f)
  thumbUrls.set(id, url)
  return url
}

/** The embedded preview JPEG (the "original" look straight from the camera). */
export async function previewBlob(p: Photo): Promise<Blob | null> {
  const raf = await readFile(rawPath(p.id))
  if (!raf) return null
  return raf.slice(p.previewOffset, p.previewOffset + p.previewLength, 'image/jpeg')
}

/** The whole RAF file as bytes (needed for uploading to the camera). */
export async function rafBytes(p: Photo): Promise<ArrayBuffer | null> {
  const raf = await readFile(rawPath(p.id))
  return raf ? raf.arrayBuffer() : null
}

export async function resultFile(id: string): Promise<File | null> {
  return readFile(resultPath(id))
}

// ---- writing --------------------------------------------------------------

/** A random, unique id like "k3j9x2…" */
function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** "2026:10:19 10:01:21" (EXIF) → "2026-10-19T10:01:21" (ISO, local time) */
function exifDateToIso(s: string | undefined): string | null {
  const m = s?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null
}

/** Make a small JPEG thumbnail (longest side `size` px) from an image blob. */
async function makeThumbnail(jpeg: Blob, size = 480): Promise<{ blob: Blob; w: number; h: number }> {
  // imageOrientation 'from-image' applies the EXIF rotation (portrait photos!)
  const bmp = await createImageBitmap(jpeg, { imageOrientation: 'from-image' })
  const scale = Math.min(1, size / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return { blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 }), w, h }
}

export type ImportResult = { ok: true; photo: Photo; duplicate: boolean } | { ok: false; fileName: string; error: string }

/**
 * Import one .RAF file. Reads only the small parts it needs (header + preview)
 * into memory; the big file is streamed straight into OPFS.
 */
export async function importRaf(file: File): Promise<ImportResult> {
  try {
    // 1. Header: magic text + where the embedded JPEG is (see raf.ts)
    const head = new DataView(await file.slice(0, 100).arrayBuffer())
    const magic = String.fromCharCode(...new Uint8Array(head.buffer, 0, 15))
    if (magic !== 'FUJIFILMCCD-RAW') return { ok: false, fileName: file.name, error: 'not-raf' }
    const cameraName = String.fromCharCode(...new Uint8Array(head.buffer, 28, 32)).replace(/\0.*$/s, '').trim()
    const previewOffset = head.getUint32(84, false)
    const previewLength = head.getUint32(88, false)

    // Skip duplicates (same name + same size).
    const existing = (await dbGetAll<Photo>('photos')).find(p => p.fileName === file.name && p.fileSize === file.size)
    if (existing) return { ok: true, photo: existing, duplicate: true }

    // 2. EXIF from the embedded preview → date + as-shot settings
    const preview = file.slice(previewOffset, previewOffset + previewLength, 'image/jpeg')
    let exif: ExifData = { fuji: new Map() }
    try { exif = parseJpegExif(new Uint8Array(await preview.arrayBuffer())) } catch (e) { log(`EXIF read failed for ${file.name}: ${e}`, 'warn') }

    // 3. Thumbnail
    const thumb = await makeThumbnail(preview)

    // 4. Store files, then the record (record last = no half-imported photos)
    const id = newId()
    await writeFile(rawPath(id), file.stream())
    await writeFile(thumbPath(id), thumb.blob)

    const photo: Photo = {
      id, fileName: file.name, fileSize: file.size, cameraName,
      dateTaken: exifDateToIso(exif.dateTimeOriginal),
      importedAt: Date.now(), previewOffset, previewLength,
      asShot: recipeFromExif(exif), recipe: null,
      resultSize: null, editedAt: null, favorite: false, albums: [],
      thumbW: thumb.w, thumbH: thumb.h,
    }
    await dbPut('photos', photo)
    return { ok: true, photo, duplicate: false }
  } catch (err) {
    return { ok: false, fileName: file.name, error: String(err) }
  }
}

/** Import several files one after another, reporting progress. */
export async function importFiles(files: File[], onProgress?: (done: number, total: number) => void): Promise<ImportResult[]> {
  void requestPersistence() // ask once that our data is never auto-deleted
  const results: ImportResult[] = []
  for (let i = 0; i < files.length; i++) {
    const r = await importRaf(files[i])
    results.push(r)
    if (r.ok) log(`Imported ${files[i].name}${r.duplicate ? ' (already in library)' : ''}`)
    else log(`Import failed: ${files[i].name}: ${r.error}`, 'warn')
    onProgress?.(i + 1, files.length)
  }
  notify()
  return results
}

export async function updatePhoto(p: Photo): Promise<void> {
  await dbPut('photos', p)
  notify()
}

/** Store a new camera-rendered JPEG for a photo together with its recipe. */
export async function saveResult(p: Photo, jpeg: Uint8Array, recipe: Recipe): Promise<Photo> {
  await writeFile(resultPath(p.id), jpeg as Uint8Array<ArrayBuffer>)
  const updated: Photo = { ...p, recipe: { ...recipe }, resultSize: jpeg.length, editedAt: Date.now() }
  await dbPut('photos', updated)
  notify()
  return updated
}

export async function deletePhoto(id: string): Promise<void> {
  await Promise.all([deleteFile(rawPath(id)), deleteFile(thumbPath(id)), deleteFile(resultPath(id))])
  const url = thumbUrls.get(id)
  if (url) { URL.revokeObjectURL(url); thumbUrls.delete(id) }
  await dbDelete('photos', id)
  notify()
}
