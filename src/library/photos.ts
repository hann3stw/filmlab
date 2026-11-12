/**
 * The photo library: importing RAF files and keeping track of them.
 *
 *  - The RAF itself is copied into OPFS (raw/<id>.raf)
 *  - A small thumbnail is made from the JPEG preview INSIDE the RAF
 *    (no camera needed, very fast) → thumbs/<id>.jpg
 *  - The latest camera render is stored as results/<id>.jpg, with its own
 *    thumbnail thumbs/<id>-r.jpg (made lazily, see resultThumb below)
 *  - Everything else (name, date, settings, edits, albums …) is a "Photo"
 *    record in IndexedDB
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
  /** Ids of the albums this photo belongs to */
  albums: string[]
  /** Highest dynamic range this RAW can be developed with (known after first render) */
  maxDR?: number
  /** Pixel size of the thumbnail (for layout without waiting for the image) */
  thumbW: number
  thumbH: number
  /** When the result was last saved to the gallery / shared */
  exportedAt?: number | null
  /** The RAF was deleted to save space (only preview + result remain) */
  rafDeleted?: boolean
  /** editedAt of the render the result thumbnail was made from */
  resultThumbAt?: number | null
}

const rawPath = (id: string) => `raw/${id}.raf`
const thumbPath = (id: string) => `thumbs/${id}.jpg`
const resultThumbPath = (id: string) => `thumbs/${id}-r.jpg`
const resultPath = (id: string) => `results/${id}.jpg`
/** Copy of the embedded preview, kept when the RAF is deleted */
const keptPreviewPath = (id: string) => `previews/${id}.jpg`

// ---- change notifications (so screens can refresh themselves) -------------

const listeners = new Set<() => void>()
export function onPhotosChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify() { listeners.forEach(fn => fn()) }

// ---- reading -------------------------------------------------------------

/** Date used for sorting/grouping: when taken, else when imported. */
export function photoDate(p: Photo): string {
  return p.dateTaken ?? new Date(p.importedAt).toISOString().slice(0, 19)
}

export async function listPhotos(): Promise<Photo[]> {
  const all = await dbGetAll<Photo>('photos')
  // Newest photo first
  return all.sort((a, b) => photoDate(b).localeCompare(photoDate(a)))
}

export async function getPhoto(id: string): Promise<Photo | undefined> {
  return dbGet<Photo>('photos', id)
}

/**
 * Object-URL cache so a thumbnail file is only turned into a URL once.
 * Key includes the edit time, so a new render gets a new thumbnail.
 */
const thumbUrls = new Map<string, string>()

/**
 * Thumbnail URL for a photo: the camera render if there is one, otherwise the
 * RAF's embedded preview.
 */
export async function thumbUrl(p: Photo | string): Promise<string | null> {
  if (typeof p === 'string') {
    const found = await getPhoto(p)
    if (!found) return null
    p = found
  }
  const useResult = !!p.resultSize && !!p.editedAt
  const key = useResult ? `${p.id}@${p.editedAt}` : p.id
  const cached = thumbUrls.get(key)
  if (cached) return cached

  let file: File | null = null
  if (useResult) file = await resultThumb(p)
  if (!file) file = await readFile(thumbPath(p.id))
  if (!file) return null
  const url = URL.createObjectURL(file)
  thumbUrls.set(key, url)
  return url
}

/**
 * Result thumbnails are made lazily (not after every render in the editor,
 * which would slow it down) and one at a time (decoding a 26 MP JPEG needs a
 * lot of memory — doing several at once can crash a phone browser).
 */
let thumbQueue: Promise<unknown> = Promise.resolve()
async function resultThumb(p: Photo): Promise<File | null> {
  if (p.resultThumbAt === p.editedAt) return readFile(resultThumbPath(p.id))
  const job = thumbQueue.then(async () => {
    const fresh = await getPhoto(p.id)
    if (!fresh?.resultSize) return null
    if (fresh.resultThumbAt === fresh.editedAt) return readFile(resultThumbPath(p.id))
    const res = await readFile(resultPath(p.id))
    if (!res) return null
    const thumb = await makeThumbnail(res)
    await writeFile(resultThumbPath(p.id), thumb.blob)
    // Save silently (no notify → no re-render loop of the grid)
    await dbPut('photos', { ...fresh, resultThumbAt: fresh.editedAt })
    return readFile(resultThumbPath(p.id))
  })
  thumbQueue = job.catch(() => null)
  return job
}

/** The embedded preview JPEG (the "original" look straight from the camera). */
export async function previewBlob(p: Photo): Promise<Blob | null> {
  if (p.rafDeleted) return readFile(keptPreviewPath(p.id))
  const raf = await readFile(rawPath(p.id))
  if (!raf) return readFile(keptPreviewPath(p.id))
  return raf.slice(p.previewOffset, p.previewOffset + p.previewLength, 'image/jpeg')
}

/** The whole RAF file as bytes (needed for uploading to the camera). */
export async function rafBytes(p: Photo): Promise<ArrayBuffer | null> {
  if (p.rafDeleted) return null
  const raf = await readFile(rawPath(p.id))
  return raf ? raf.arrayBuffer() : null
}

export async function resultFile(id: string): Promise<File | null> {
  return readFile(resultPath(id))
}

/** File name used when saving/sharing a render. */
export function exportName(p: Photo): string {
  return p.fileName.replace(/\.raf$/i, '') + '_FilmLab.jpg'
}

// ---- writing --------------------------------------------------------------

/** A random, unique id like "k3j9x2…" */
export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** "2026:10:19 10:01:21" (EXIF) → "2026-10-19T10:01:21" (ISO, local time) */
function exifDateToIso(s: string | undefined): string | null {
  const m = s?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null
}

/** Make a small JPEG thumbnail (longest side `size` px) from an image blob. */
export async function makeThumbnail(jpeg: Blob, size = 480): Promise<{ blob: Blob; w: number; h: number }> {
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

/** Change some fields of several photos at once (e.g. add to album). */
export async function updatePhotos(ids: string[], change: (p: Photo) => Photo): Promise<void> {
  for (const id of ids) {
    const p = await getPhoto(id)
    if (p) await dbPut('photos', change(p))
  }
  notify()
}

/** Store a new camera-rendered JPEG for a photo together with its recipe. */
export async function saveResult(p: Photo, jpeg: Uint8Array, recipe: Recipe, quiet = false): Promise<Photo> {
  await writeFile(resultPath(p.id), jpeg as Uint8Array<ArrayBuffer>)
  const updated: Photo = { ...p, recipe: { ...recipe }, resultSize: jpeg.length, editedAt: Date.now() }
  await dbPut('photos', updated)
  if (!quiet) notify()
  return updated
}

/** Remember that a photo was saved to the gallery / shared. */
export async function markExported(ids: string[]): Promise<void> {
  const now = Date.now()
  await updatePhotos(ids, p => ({ ...p, exportedAt: now }))
}

/**
 * Delete the big RAF of a photo to free space. The embedded preview is copied
 * out first, so the photo still shows its "original" look — but it can't be
 * re-rendered by the camera any more.
 */
export async function deleteOriginal(id: string): Promise<number> {
  const p = await getPhoto(id)
  if (!p || p.rafDeleted) return 0
  const pv = await previewBlob(p)
  if (pv) await writeFile(keptPreviewPath(id), pv)
  await deleteFile(rawPath(id))
  await dbPut('photos', { ...p, rafDeleted: true })
  return p.fileSize
}

export async function deleteOriginals(ids: string[]): Promise<number> {
  let freed = 0
  for (const id of ids) freed += await deleteOriginal(id)
  notify()
  return freed
}

export async function deletePhoto(id: string, quiet = false): Promise<void> {
  await Promise.all([
    deleteFile(rawPath(id)), deleteFile(thumbPath(id)), deleteFile(resultThumbPath(id)),
    deleteFile(resultPath(id)), deleteFile(keptPreviewPath(id)),
  ])
  for (const [key, url] of thumbUrls) {
    if (key === id || key.startsWith(id + '@')) { URL.revokeObjectURL(url); thumbUrls.delete(key) }
  }
  await dbDelete('photos', id)
  if (!quiet) notify()
}

export async function deletePhotos(ids: string[]): Promise<void> {
  for (const id of ids) await deletePhoto(id, true)
  notify()
}

/** Bytes used by the library, split by kind (estimated from the records). */
export async function libraryUsage(): Promise<{ raw: number; results: number; rawCount: number; resultCount: number; exportedRaw: number; exportedRawIds: string[] }> {
  const all = await dbGetAll<Photo>('photos')
  let raw = 0, results = 0, rawCount = 0, resultCount = 0, exportedRaw = 0
  const exportedRawIds: string[] = []
  for (const p of all) {
    if (!p.rafDeleted) { raw += p.fileSize; rawCount++ }
    if (p.resultSize) { results += p.resultSize; resultCount++ }
    if (!p.rafDeleted && p.exportedAt) { exportedRaw += p.fileSize; exportedRawIds.push(p.id) }
  }
  return { raw, results, rawCount, resultCount, exportedRaw, exportedRawIds }
}
