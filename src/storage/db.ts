/**
 * IndexedDB wrapper — stores the small, structured data (photo metadata,
 * later recipes and albums). Big files live in OPFS (see opfs.ts).
 *
 * IndexedDB's own API is callback-based and verbose, so we wrap the few
 * operations we need in Promises.
 */

const DB_NAME = 'filmlab'
const DB_VERSION = 2 // 2: added 'albums'

/** Names of the "tables" (object stores). */
export type StoreName = 'photos' | 'albums' | 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    // Runs on first start, and whenever DB_VERSION increases: create stores here.
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' })
        photos.createIndex('importedAt', 'importedAt')
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      if (!db.objectStoreNames.contains('albums')) db.createObjectStore('albums', { keyPath: 'id' })
    }
    req.onsuccess = () => {
      // If a newer app version (in another tab) needs to upgrade the
      // database, close ours so the upgrade isn't blocked.
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

/** Turn an IDBRequest into a Promise. */
function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function store(name: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb()
  return db.transaction(name, mode).objectStore(name)
}

export async function dbGet<T>(name: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return done((await store(name, 'readonly')).get(key)) as Promise<T | undefined>
}

export async function dbGetAll<T>(name: StoreName): Promise<T[]> {
  return done((await store(name, 'readonly')).getAll()) as Promise<T[]>
}

/** Insert or replace. For 'kv' pass the key separately. */
export async function dbPut<T>(name: StoreName, value: T, key?: IDBValidKey): Promise<void> {
  await done((await store(name, 'readwrite')).put(value, key))
}

export async function dbDelete(name: StoreName, key: IDBValidKey): Promise<void> {
  await done((await store(name, 'readwrite')).delete(key))
}
