/**
 * Library queries: which photos to show (filter), in which order (sort),
 * and under which headings (group).
 *
 * All of this runs on the plain list of Photo records in memory — even with
 * a thousand photos that takes well under a millisecond.
 */

import { photoDate, type Photo } from './photos.ts'
import { filmSimName } from '../recipes/recipe.ts'
import { getLang } from '../i18n/index.ts'

export type QuickFilter = 'all' | 'edited' | 'unedited' | 'favorites'
export type SortOrder = 'newest' | 'oldest' | 'filmSim' | 'name'

export interface LibraryQuery {
  quick: QuickFilter
  sort: SortOrder
  /** Only photos with this film simulation (code), or null = any */
  filmSim: number | null
  /** Only photos in this album, or null = any */
  album: string | null
  /** Date range "YYYY-MM-DD" (inclusive), or null = open */
  from: string | null
  to: string | null
}

export const DEFAULT_QUERY: LibraryQuery = {
  quick: 'all', sort: 'newest', filmSim: null, album: null, from: null, to: null,
}

/** The film simulation a photo currently looks like (edited or as shot). */
export function currentFilmSim(p: Photo): number {
  return (p.recipe ?? p.asShot).filmSimulation
}

/** Number of active "advanced" filters (shown as a badge on the filter button). */
export function activeFilterCount(q: LibraryQuery): number {
  return [q.filmSim !== null, q.album !== null, !!q.from || !!q.to].filter(Boolean).length
}

export function applyQuery(photos: Photo[], q: LibraryQuery): Photo[] {
  const out = photos.filter(p => {
    if (q.quick === 'edited' && !p.recipe) return false
    if (q.quick === 'unedited' && p.recipe) return false
    if (q.quick === 'favorites' && !p.favorite) return false
    if (q.filmSim !== null && currentFilmSim(p) !== q.filmSim) return false
    if (q.album !== null && !p.albums.includes(q.album)) return false
    const day = photoDate(p).slice(0, 10)
    if (q.from && day < q.from) return false
    if (q.to && day > q.to) return false
    return true
  })

  const byDate = (a: Photo, b: Photo) => photoDate(a).localeCompare(photoDate(b))
  switch (q.sort) {
    case 'newest': out.sort((a, b) => byDate(b, a)); break
    case 'oldest': out.sort(byDate); break
    case 'name': out.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true })); break
    case 'filmSim': out.sort((a, b) =>
      filmSimName(currentFilmSim(a)).localeCompare(filmSimName(currentFilmSim(b))) || byDate(b, a)); break
  }
  return out
}

export interface Group { title: string; photos: Photo[] }

/** Split the (already sorted) list into headed groups. */
export function groupPhotos(photos: Photo[], sort: SortOrder): Group[] {
  if (sort === 'name') return photos.length ? [{ title: '', photos }] : []
  const keyOf = sort === 'filmSim'
    ? (p: Photo) => filmSimName(currentFilmSim(p))
    : (p: Photo) => photoDate(p).slice(0, 10)
  const groups: Group[] = []
  for (const p of photos) {
    const key = keyOf(p)
    const last = groups[groups.length - 1]
    if (last && last.title === key) last.photos.push(p)
    else groups.push({ title: key, photos: [p] })
  }
  if (sort !== 'filmSim') for (const g of groups) g.title = formatDay(g.title)
  return groups
}

/** "2026-10-19" → "Monday, 19 October 2026" in the app language */
export function formatDay(day: string): string {
  const d = new Date(day + 'T12:00:00')
  if (isNaN(d.getTime())) return day
  return d.toLocaleDateString(getLang() === 'de' ? 'de-DE' : 'en-GB',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
