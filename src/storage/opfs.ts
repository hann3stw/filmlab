/**
 * Origin Private File System (OPFS) helpers.
 *
 * OPFS is a private folder that belongs to this website/app. It is much better
 * for big binary files (50 MB RAFs, 12 MB JPEGs) than IndexedDB: files are
 * written as real files and can be read in slices without loading everything.
 *
 * Layout used by FilmLab:
 *   raw/<photoId>.raf       the imported RAW file
 *   thumbs/<photoId>.jpg    small thumbnail (from the RAF's embedded preview)
 *   results/<photoId>.jpg   latest camera-rendered JPEG
 */

async function root(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

/** Split "a/b/c.jpg" → folder handle for "a/b" + file name "c.jpg". */
async function resolve(path: string, create: boolean): Promise<[FileSystemDirectoryHandle, string]> {
  const parts = path.split('/')
  const name = parts.pop()!
  let dir = await root()
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create })
  return [dir, name]
}

/** Write a Blob / bytes / stream to a file (replaces an existing file). */
export async function writeFile(path: string, data: Blob | BufferSource | ReadableStream<Uint8Array>): Promise<void> {
  const [dir, name] = await resolve(path, true)
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  if (data instanceof ReadableStream) {
    // pipeTo streams the data chunk by chunk — a 50 MB file never has to be
    // in memory all at once. It also closes the file when done.
    await data.pipeTo(writable)
  } else {
    await writable.write(data)
    await writable.close()
  }
}

/** Get a file as a File object (lazy: nothing is read until you ask for bytes). */
export async function readFile(path: string): Promise<File | null> {
  try {
    const [dir, name] = await resolve(path, false)
    const handle = await dir.getFileHandle(name)
    return await handle.getFile()
  } catch {
    return null
  }
}

export async function deleteFile(path: string): Promise<void> {
  try {
    const [dir, name] = await resolve(path, false)
    await dir.removeEntry(name)
  } catch { /* already gone */ }
}

export function isOpfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
}

/** How much storage the app uses / may use (bytes). */
export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  const e = await navigator.storage.estimate()
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
}

/**
 * Ask the browser to never auto-delete our data when the phone runs low on
 * space. Chrome usually grants this for installed apps.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
