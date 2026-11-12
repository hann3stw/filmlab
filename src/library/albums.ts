/**
 * Albums — named collections of photos.
 *
 * An album is only a name + id. Which photos belong to it is stored on each
 * photo (photo.albums = [albumId, …]), so a photo can be in several albums.
 */

import { dbDelete, dbGetAll, dbPut } from '../storage/db.ts'
import { newId, updatePhotos, listPhotos } from './photos.ts'

export interface Album {
  id: string
  name: string
  createdAt: number
}

const listeners = new Set<() => void>()
export function onAlbumsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const notify = () => listeners.forEach(fn => fn())

export async function listAlbums(): Promise<Album[]> {
  const all = await dbGetAll<Album>('albums')
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

export async function createAlbum(name: string): Promise<Album> {
  const album: Album = { id: newId(), name: name.trim(), createdAt: Date.now() }
  await dbPut('albums', album)
  notify()
  return album
}

export async function renameAlbum(album: Album, name: string): Promise<void> {
  await dbPut('albums', { ...album, name: name.trim() })
  notify()
}

/** Delete an album (the photos stay in the library). */
export async function deleteAlbum(id: string): Promise<void> {
  const members = (await listPhotos()).filter(p => p.albums.includes(id)).map(p => p.id)
  await updatePhotos(members, p => ({ ...p, albums: p.albums.filter(a => a !== id) }))
  await dbDelete('albums', id)
  notify()
}

export async function addToAlbum(albumId: string, photoIds: string[]): Promise<void> {
  await updatePhotos(photoIds, p => (p.albums.includes(albumId) ? p : { ...p, albums: [...p.albums, albumId] }))
}

export async function removeFromAlbum(albumId: string, photoIds: string[]): Promise<void> {
  await updatePhotos(photoIds, p => ({ ...p, albums: p.albums.filter(a => a !== albumId) }))
}
