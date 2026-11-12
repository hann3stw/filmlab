/**
 * LIBRARY — all photos (originals + camera renders).
 *
 *  - virtualized grid (2/3/4 columns), grouped by date or film simulation
 *  - quick filters: All / Edited / Not edited / Favorites
 *  - albums, sorting, filters (film simulation, album, date range)
 *  - tap → full-screen viewer; long-press → multi-select
 *  - multi-select actions: album, apply recipe, save, share, delete
 *  - storage indicator + "delete originals of exported photos"
 */

import { h, replaceChildren as setKids, toast, openSheet, confirmSheet, promptSheet, formatBytes } from '../ui/dom.ts'
import { icons } from '../ui/icons.ts'
import { t, type Dict } from '../i18n/index.ts'
import { header, importButton } from '../app/components.ts'
import {
  listPhotos, onPhotosChanged, thumbUrl, deletePhotos, outputFile, exportName, markExported,
  libraryUsage, deleteOriginals, type Photo,
} from '../library/photos.ts'
import { listAlbums, onAlbumsChanged, createAlbum, renameAlbum, deleteAlbum, addToAlbum, removeFromAlbum, type Album } from '../library/albums.ts'
import {
  applyQuery, groupPhotos, activeFilterCount, currentFilmSim, DEFAULT_QUERY,
  type LibraryQuery, type QuickFilter, type SortOrder,
} from '../library/query.ts'
import { createVirtualGrid } from '../ui/virtual-grid.ts'
import { openViewer } from './viewer.ts'
import { navigate, type View } from '../app/shell.ts'
import { filmSimName } from '../recipes/recipe.ts'
import { pickRecipe } from '../app/recipe-picker.ts'
import { runBatch } from '../app/batch-ui.ts'
import { saveFiles, shareFiles } from '../library/export.ts'
import { cameraService } from '../camera/camera-service.ts'
import { storageEstimate } from '../storage/opfs.ts'
import { pushBack } from '../ui/back-stack.ts'

const PREFS_KEY = 'filmlab.library'
interface Prefs { cols: number; query: LibraryQuery }

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '') as Prefs
    return { cols: [2, 3, 4].includes(p.cols) ? p.cols : 3, query: { ...DEFAULT_QUERY, ...p.query } }
  } catch {
    return { cols: 3, query: { ...DEFAULT_QUERY } }
  }
}

const QUICK: { key: QuickFilter; label: keyof Dict }[] = [
  { key: 'all', label: 'lib.f.all' }, { key: 'edited', label: 'lib.f.edited' },
  { key: 'unedited', label: 'lib.f.unedited' }, { key: 'favorites', label: 'lib.f.favorites' },
]
const SORTS: { key: SortOrder; label: keyof Dict }[] = [
  { key: 'newest', label: 'lib.s.newest' }, { key: 'oldest', label: 'lib.s.oldest' },
  { key: 'filmSim', label: 'lib.s.filmSim' }, { key: 'name', label: 'lib.s.name' },
]

export const libraryView: View = root => {
  const prefs = loadPrefs()
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* ignore */ } }
  const q = prefs.query

  let all: Photo[] = []      // every photo
  let shown: Photo[] = []    // after filter + sort (same order as the grid)
  let albums: Album[] = []
  const selected = new Set<string>()
  let selecting = false

  // ---- elements ----
  const count = h('span', { class: 'label' })
  const colsSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('lib.gridSize') })
  const quickSeg = h('div', { class: 'seg wide' })
  const chips = h('div', { class: 'chips' })
  const empty = h('div', { class: 'empty', hidden: true })
  const storage = h('section', { class: 'storage' })
  const selBar = h('div', { class: 'selbar', hidden: true })

  const grid = createVirtualGrid((p, index) => cell(p, index))

  root.append(
    header(t('nav.library'), undefined, count, colsSeg, importButton('icon')),
    quickSeg, chips, empty, grid.el, storage, selBar,
  )

  // ======================================================================
  // Grid cells (tap = open, long-press = select)
  // ======================================================================

  function cell(p: Photo, index: number): HTMLElement {
    const img = h('img', { alt: p.fileName, decoding: 'async', draggable: 'false' })
    void thumbUrl(p).then(url => { if (url) img.src = url })
    const isSel = selected.has(p.id)
    const el = h('button', { class: `cell${isSel ? ' selected' : ''}`, 'aria-label': p.fileName, 'aria-pressed': selecting ? String(isSel) : undefined },
      img,
      p.recipe ? h('span', { class: 'cell-badge label' }, filmSimName(currentFilmSim(p))) : null,
      p.favorite ? h('span', { class: 'cell-heart', html: icons.heartFilled }) : null,
      selecting ? h('span', { class: 'cell-check', html: isSel ? icons.check : '' }) : null,
    )

    // Long-press: start a timer on touch; if the finger stays put for 450 ms
    // we enter selection mode. Moving (= scrolling) or lifting cancels it.
    let timer: ReturnType<typeof setTimeout> | undefined
    let longPressed = false
    let sx = 0, sy = 0
    el.addEventListener('pointerdown', e => {
      longPressed = false
      sx = e.clientX; sy = e.clientY
      timer = setTimeout(() => {
        longPressed = true
        navigator.vibrate?.(15) // tiny haptic "tick"
        if (!selecting) startSelecting()
        toggle(p.id)
      }, 450)
    })
    el.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clearTimeout(timer) })
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) el.addEventListener(ev, () => clearTimeout(timer))
    el.addEventListener('contextmenu', e => e.preventDefault()) // no browser menu on long-press
    el.addEventListener('click', () => {
      if (longPressed) { longPressed = false; return }
      if (selecting) toggle(p.id)
      else openViewer(shown, index, { onEdit: id => navigate(`edit/${id}`), onClose: i => grid.scrollToIndex(i) })
    })
    return el
  }

  // ======================================================================
  // Selection mode
  // ======================================================================

  let releaseBack: (() => Promise<void>) | null = null
  function startSelecting() {
    selecting = true
    releaseBack = pushBack(() => stopSelecting(true)) // Android "back" leaves selection mode
  }
  function stopSelecting(fromBack = false) {
    if (!selecting) return
    selecting = false
    selected.clear()
    if (!fromBack) void releaseBack?.()
    releaseBack = null
    grid.refresh()
    drawSelBar()
  }
  function toggle(id: string) {
    if (selected.has(id)) selected.delete(id); else selected.add(id)
    grid.refresh()
    drawSelBar()
  }

  function drawSelBar() {
    selBar.hidden = !selecting
    document.body.classList.toggle('selecting', selecting)
    if (!selecting) return
    const n = selected.size
    const act = (icon: string, label: keyof Dict, fn: () => void) =>
      h('button', { class: 'selbar-btn', disabled: n === 0, onclick: fn }, h('span', { html: icon }), h('span', { class: 'label' }, t(label)))
    selBar.replaceChildren(
      h('div', { class: 'selbar-head' },
        h('button', { class: 'icon-btn', 'aria-label': t('common.cancel'), html: icons.close, onclick: () => stopSelecting() }),
        h('span', { class: 'selbar-count' }, t('lib.selected', { n })),
        h('button', { class: 'btn ghost small', onclick: () => {
          if (selected.size === shown.length) selected.clear(); else shown.forEach(p => selected.add(p.id))
          grid.refresh(); drawSelBar()
        } }, selected.size === shown.length ? t('lib.selectNone') : t('lib.selectAll')),
      ),
      h('div', { class: 'selbar-actions' },
        act(icons.album, 'lib.a.album', () => void albumSheet([...selected])),
        act(icons.wand, 'lib.a.recipe', () => void applyRecipe([...selected])),
        act(icons.download, 'lib.a.save', () => void exportSelected('save')),
        act(icons.share, 'lib.a.share', () => void exportSelected('share')),
        act(icons.trash, 'lib.a.delete', () => void deleteSelected()),
      ),
    )
  }

  async function deleteSelected() {
    const ids = [...selected]
    const ok = await confirmSheet(t('lib.deleteTitle'), t('lib.deleteText', { n: ids.length }), t('view.delete'), t('common.cancel'), true)
    if (!ok) return
    await deletePhotos(ids)
    stopSelecting()
    toast(t('lib.deleted', { n: ids.length }))
  }

  async function exportSelected(mode: 'save' | 'share') {
    const files: File[] = []
    const ids: string[] = []
    for (const id of selected) {
      const p = all.find(x => x.id === id)
      const f = p ? await outputFile(p) : null
      if (p && f) { files.push(new File([f], exportName(p), { type: 'image/jpeg' })); ids.push(id) }
    }
    const skipped = selected.size - files.length
    if (skipped) toast(t('lib.exportSkipped', { n: skipped }))
    if (!files.length) return
    if (mode === 'save') { await saveFiles(files); await markExported(ids) }
    else if (await shareFiles(files)) await markExported(ids)
  }

  /** Apply one recipe to all selected photos — rendered by the camera. */
  async function applyRecipe(ids: string[]) {
    if (!cameraService.isReady) { toast(t('lib.needCamera'), 'error'); return }
    const choice = await pickRecipe()
    if (!choice) return
    // "As shot" = each photo's own original settings, so it is resolved per photo.
    const done = await runBatch(ids, p => (choice.kind === 'asShot' ? p.asShot : choice.recipe))
    if (done === null) return
    await refresh()
    stopSelecting()
  }

  // ======================================================================
  // Albums
  // ======================================================================

  /** Sheet to put the given photos into albums (or take them out). */
  async function albumSheet(ids: string[]) {
    const sheet = openSheet(t('lib.a.album'))
    const draw = async () => {
      albums = await listAlbums()
      all = await listPhotos()
      const members = (a: Album) => ids.filter(id => all.find(p => p.id === id)?.albums.includes(a.id)).length
      setKids(sheet.body,
        h('div', { class: 'opt-list' }, ...albums.map(a => {
          const m = members(a)
          const state = m === ids.length ? 'on' : ''
          return h('button', { class: `opt ${state}`, onclick: async () => {
            if (m === ids.length) await removeFromAlbum(a.id, ids); else await addToAlbum(a.id, ids)
            void draw()
          } }, h('span', null, a.name), h('span', { class: 'label' }, m === ids.length ? t('lib.inAlbum') : m ? `${m}/${ids.length}` : ''))
        })),
        albums.length ? null : h('p', { class: 'sheet-note' }, t('lib.noAlbums')),
        h('div', { class: 'row between' },
          h('button', { class: 'btn ghost small', onclick: async () => {
            const name = await promptSheet(t('lib.newAlbum'), t('lib.albumName'), t('common.create'), t('common.cancel'))
            if (name) { const a = await createAlbum(name); await addToAlbum(a.id, ids); void draw() }
          } }, h('span', { html: icons.plus }), t('lib.newAlbum')),
          h('button', { class: 'btn small', onclick: () => sheet.close() }, t('ed.done')),
        ),
      )
    }
    await draw()
  }

  /** Rename / delete one album. */
  function manageAlbum(a: Album) {
    const sheet = openSheet(a.name)
    sheet.body.append(h('div', { class: 'opt-list' },
      h('button', { class: 'opt', onclick: async () => {
        sheet.close()
        const name = await promptSheet(t('lib.renameAlbum'), t('lib.albumName'), t('common.save'), t('common.cancel'), a.name)
        if (name) await renameAlbum(a, name)
      } }, t('lib.renameAlbum')),
      h('button', { class: 'opt danger', onclick: async () => {
        sheet.close()
        if (await confirmSheet(t('lib.deleteAlbum'), t('lib.deleteAlbumText', { name: a.name }), t('view.delete'), t('common.cancel'), true)) {
          if (q.album === a.id) q.album = null
          await deleteAlbum(a.id)
        }
      } }, t('lib.deleteAlbum')),
    ))
  }

  // ======================================================================
  // Filter & sort sheet
  // ======================================================================

  function filterSheet() {
    const sheet = openSheet(t('lib.filterTitle'))
    const draw = () => {
      const sims = [...new Set(all.map(currentFilmSim))].sort((a, b) => filmSimName(a).localeCompare(filmSimName(b)))
      const pill = (label: string, on: boolean, fn: () => void) =>
        h('button', { class: `chip${on ? ' on' : ''}`, onclick: () => { fn(); changed(); draw() } }, label)
      const from = h('input', { class: 'text-input', type: 'date', value: q.from ?? '', 'aria-label': t('lib.from') }) as HTMLInputElement
      const to = h('input', { class: 'text-input', type: 'date', value: q.to ?? '', 'aria-label': t('lib.to') }) as HTMLInputElement
      from.addEventListener('change', () => { q.from = from.value || null; changed() })
      to.addEventListener('change', () => { q.to = to.value || null; changed() })
      sheet.body.replaceChildren(
        h('div', { class: 'label' }, t('lib.sort')),
        h('div', { class: 'chip-wrap' }, ...SORTS.map(s => pill(t(s.label), q.sort === s.key, () => { q.sort = s.key }))),
        h('div', { class: 'label' }, t('f.filmSimulation')),
        h('div', { class: 'chip-wrap' },
          pill(t('lib.any'), q.filmSim === null, () => { q.filmSim = null }),
          ...sims.map(s => pill(filmSimName(s), q.filmSim === s, () => { q.filmSim = s }))),
        h('div', { class: 'label' }, t('lib.album')),
        h('div', { class: 'chip-wrap' },
          pill(t('lib.any'), q.album === null, () => { q.album = null }),
          ...albums.map(a => pill(a.name, q.album === a.id, () => { q.album = a.id }))),
        h('div', { class: 'label' }, t('lib.dateRange')),
        h('div', { class: 'date-row' }, from, h('span', null, '–'), to),
        h('div', { class: 'row between' },
          h('button', { class: 'btn ghost small', onclick: () => {
            Object.assign(q, { filmSim: null, album: null, from: null, to: null, sort: 'newest' }); changed(); draw()
          } }, t('lib.resetFilters')),
          h('button', { class: 'btn small', onclick: () => sheet.close() }, t('ed.done')),
        ),
      )
    }
    draw()
  }

  function changed() { savePrefs(); drawControls(); applyAndShow() }

  // ======================================================================
  // Controls (segments, chips), list, storage
  // ======================================================================

  function drawControls() {
    colsSeg.replaceChildren(...[2, 3, 4].map(n =>
      h('button', { class: prefs.cols === n ? 'on' : '', 'aria-pressed': String(prefs.cols === n), onclick: () => { prefs.cols = n; changed() } }, String(n))))
    quickSeg.replaceChildren(...QUICK.map(f =>
      h('button', { class: q.quick === f.key ? 'on' : '', onclick: () => { q.quick = f.key; changed() } }, t(f.label))))

    const n = activeFilterCount(q) + (q.sort !== 'newest' ? 1 : 0)
    chips.replaceChildren(
      h('button', { class: `chip${n ? ' on' : ''}`, onclick: filterSheet }, h('span', { html: icons.filter }), t('lib.filter') + (n ? ` · ${n}` : '')),
      ...albums.map(a => {
        const chip = h('button', { class: `chip${q.album === a.id ? ' on' : ''}`, onclick: () => { q.album = q.album === a.id ? null : a.id; changed() } },
          h('span', { html: icons.album }), a.name)
        // long-press an album chip → rename / delete
        let timer: ReturnType<typeof setTimeout> | undefined
        chip.addEventListener('pointerdown', () => { timer = setTimeout(() => manageAlbum(a), 500) })
        for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'pointermove'] as const) chip.addEventListener(ev, () => clearTimeout(timer))
        chip.addEventListener('contextmenu', e => e.preventDefault())
        return chip
      }),
      h('button', { class: 'chip dashed', onclick: async () => {
        const name = await promptSheet(t('lib.newAlbum'), t('lib.albumName'), t('common.create'), t('common.cancel'))
        if (name) await createAlbum(name)
      } }, h('span', { html: icons.plus }), t('lib.newAlbum')),
    )
  }

  function applyAndShow() {
    shown = applyQuery(all, q)
    count.textContent = shown.length === all.length ? t('lib.count', { n: all.length }) : `${shown.length} / ${all.length}`
    grid.setData(groupPhotos(shown, q.sort), prefs.cols)
    empty.hidden = shown.length > 0
    if (!shown.length) {
      empty.replaceChildren(
        h('p', null, all.length ? t('lib.emptyFiltered') : t('lib.empty')),
        all.length
          ? h('button', { class: 'btn ghost', onclick: () => { Object.assign(q, DEFAULT_QUERY); changed() } }, t('lib.resetFilters'))
          : importButton(),
      )
    }
    // Forget selected photos that are no longer there
    for (const id of selected) if (!all.some(p => p.id === id)) selected.delete(id)
    drawSelBar()
  }

  async function drawStorage() {
    const [u, est, persisted] = await Promise.all([libraryUsage(), storageEstimate(), navigator.storage.persisted().catch(() => false)])
    const pct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0
    setKids(storage,
      h('div', { class: 'section-head' }, h('h2', null, t('lib.storage')), h('span', { class: 'label' }, formatBytes(est.usage))),
      h('div', { class: 'progress-bar' }, h('i', { style: { width: `${Math.max(pct, 1)}%` } })),
      h('p', { class: 'muted small' }, t('lib.storageDetail', {
        raw: formatBytes(u.raw), rawN: u.rawCount, jpg: formatBytes(u.results), jpgN: u.resultCount, quota: formatBytes(est.quota),
      })),
      h('p', { class: 'muted small' }, t(persisted ? 'lib.persisted' : 'lib.notPersisted')),
      u.exportedRawIds.length
        ? h('button', { class: 'btn ghost small', onclick: async () => {
          const ok = await confirmSheet(t('lib.freeTitle'), t('lib.freeText', { n: u.exportedRawIds.length, size: formatBytes(u.exportedRaw) }),
            t('lib.freeOk'), t('common.cancel'), true)
          if (!ok) return
          const freed = await deleteOriginals(u.exportedRawIds)
          toast(t('lib.freed', { size: formatBytes(freed) }))
        } }, t('lib.freeButton', { size: formatBytes(u.exportedRaw) }))
        : null,
    )
  }

  async function refresh() {
    ;[all, albums] = await Promise.all([listPhotos(), listAlbums()])
    drawControls()
    applyAndShow()
    void drawStorage()
  }

  void refresh()
  const off1 = onPhotosChanged(() => void refresh())
  const off2 = onAlbumsChanged(() => void refresh())
  return () => {
    off1(); off2()
    grid.destroy()
    if (selecting) void releaseBack?.()
    document.body.classList.remove('selecting')
  }
}
