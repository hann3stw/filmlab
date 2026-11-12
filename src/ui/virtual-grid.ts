/**
 * Virtualized photo grid with group headings.
 *
 * Problem: 800 photos = 800 <img> elements = slow scrolling and lots of memory.
 * Solution ("virtualization"): we calculate where every row WOULD be, make
 * the container as tall as all rows together, but only create the rows that
 * are on (or near) the screen. While you scroll, rows that leave the screen
 * are removed and new ones are created.
 *
 * Every row has a known height (cells are square), so positions are simple
 * arithmetic — no need to measure anything.
 */

import type { Group } from '../library/query.ts'
import type { Photo } from '../library/photos.ts'

const GAP = 4
const HEADER_H = 52

type Row =
  | { kind: 'header'; title: string; top: number; height: number }
  | { kind: 'cells'; photos: Photo[]; firstIndex: number; top: number; height: number }

export interface VirtualGrid {
  el: HTMLElement
  /** New data and/or column count → recompute layout */
  setData(groups: Group[], cols: number): void
  /** Re-draw visible rows (e.g. after the selection changed) */
  refresh(): void
  /** Scroll so that photo #index is visible */
  scrollToIndex(index: number): void
  destroy(): void
}

export function createVirtualGrid(renderCell: (photo: Photo, index: number) => HTMLElement): VirtualGrid {
  const el = document.createElement('div')
  el.className = 'vgrid'
  let rows: Row[] = []
  let cols = 3
  let groups: Group[] = []
  const live = new Map<number, HTMLElement>() // row index → element on screen
  let frame = 0

  function layout() {
    const width = el.clientWidth || window.innerWidth
    const cell = (width - GAP * (cols - 1)) / cols
    rows = []
    let top = 0
    let index = 0
    for (const g of groups) {
      if (g.title) {
        rows.push({ kind: 'header', title: g.title, top, height: HEADER_H })
        top += HEADER_H
      }
      for (let i = 0; i < g.photos.length; i += cols) {
        const photos = g.photos.slice(i, i + cols)
        rows.push({ kind: 'cells', photos, firstIndex: index, top, height: cell + GAP })
        top += cell + GAP
        index += photos.length
      }
    }
    el.style.height = `${top}px`
    el.style.setProperty('--cols', String(cols))
    el.style.setProperty('--cell', `${cell}px`)
    for (const node of live.values()) node.remove()
    live.clear()
    update()
  }

  /** Create rows that came into view, remove those that left it. */
  function update() {
    frame = 0
    const rect = el.getBoundingClientRect()
    const viewTop = -rect.top
    const buffer = window.innerHeight // one extra screen above and below
    const from = viewTop - buffer
    const to = viewTop + window.innerHeight + buffer

    // Rows are sorted by top → binary search for the first visible one
    let lo = 0, hi = rows.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (rows[mid].top + rows[mid].height < from) lo = mid + 1
      else hi = mid
    }
    const wanted = new Set<number>()
    for (let i = lo; i < rows.length && rows[i].top <= to; i++) wanted.add(i)

    for (const [i, node] of live) {
      if (!wanted.has(i)) { node.remove(); live.delete(i) }
    }
    for (const i of wanted) {
      if (live.has(i)) continue
      const node = drawRow(rows[i])
      live.set(i, node)
      el.append(node)
    }
  }

  function drawRow(r: Row): HTMLElement {
    const node = document.createElement('div')
    node.style.transform = `translateY(${r.top}px)`
    node.style.height = `${r.height}px`
    if (r.kind === 'header') {
      node.className = 'vgrid-head'
      const h = document.createElement('h3')
      h.textContent = r.title
      node.append(h)
    } else {
      node.className = 'vgrid-row'
      r.photos.forEach((p, k) => node.append(renderCell(p, r.firstIndex + k)))
    }
    return node
  }

  const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
  window.addEventListener('scroll', onScroll, { passive: true })
  const ro = new ResizeObserver(() => layout())
  ro.observe(el)

  return {
    el,
    setData(g, c) { groups = g; cols = c; layout() },
    refresh() { for (const node of live.values()) node.remove(); live.clear(); update() },
    scrollToIndex(index) {
      const row = rows.find(r => r.kind === 'cells' && index >= r.firstIndex && index < r.firstIndex + r.photos.length)
      if (!row) return
      const rect = el.getBoundingClientRect()
      const y = window.scrollY + rect.top + row.top
      if (y < window.scrollY + 80 || y + row.height > window.scrollY + window.innerHeight - 80) {
        window.scrollTo({ top: y - window.innerHeight / 3 })
      }
    },
    destroy() {
      window.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
    },
  }
}
