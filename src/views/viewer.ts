/**
 * Full-screen photo viewer.
 *
 *  - swipe left/right → next/previous photo
 *  - pinch with two fingers → zoom, drag → move around, double-tap → zoom in/out
 *  - (i) button → info panel: recipe, file name, date, sizes
 *  - heart, original/result toggle, edit, save, share, delete
 *
 * Gestures are built on "pointer events", which work the same for touch,
 * mouse and pen. We remember every finger that is down (by pointerId):
 * one finger = swipe or pan, two fingers = pinch.
 */

import { h, toast, confirmSheet } from '../ui/dom.ts'
import { icons } from '../ui/icons.ts'
import { t } from '../i18n/index.ts'
import { FIELDS, summarize } from '../recipes/recipe.ts'
import {
  deletePhoto, exportName, getPhoto, markExported, previewBlob, resultFile, thumbUrl, updatePhoto, type Photo,
} from '../library/photos.ts'
import { formatBytes } from '../ui/dom.ts'
import { saveFiles, shareFiles } from '../library/export.ts'
import { pushBack } from '../ui/back-stack.ts'

export interface ViewerOptions {
  onEdit: (id: string) => void
  /** Called when the viewer closes, with the index it ended on */
  onClose?: (index: number) => void
}

export function openViewer(list: Photo[], startIndex: number, opts: ViewerOptions): void {
  let photos = [...list]
  let index = startIndex
  let showOriginal = false
  let infoOpen = false

  // ---- zoom / pan state of the current image ----
  let scale = 1, tx = 0, ty = 0

  // ---- elements ----
  const slides = [0, 1, 2].map(() => h('div', { class: 'vslide' }, h('img', { alt: '', draggable: 'false' })))
  const track = h('div', { class: 'vtrack' }, ...slides)
  const stage = h('div', { class: 'vstage' }, track)
  const counter = h('span', { class: 'label' })
  const heartBtn = h('button', { class: 'icon-btn dark', 'aria-label': t('view.favorite') })
  const compareBtn = h('button', { class: 'icon-btn dark', 'aria-label': t('ed.compare'), html: icons.compare })
  const info = h('div', { class: 'vinfo', hidden: true })
  const tag = h('span', { class: 'vtag label' })
  const root = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true' },
    stage,
    h('div', { class: 'vtop' },
      h('button', { class: 'icon-btn dark', 'aria-label': t('ed.back'), html: icons.close, onclick: () => void close() }),
      counter,
      h('div', { class: 'row' }, compareBtn, heartBtn),
    ),
    tag,
    info,
    h('div', { class: 'vbottom' },
      h('button', { class: 'icon-btn dark', 'aria-label': t('view.info'), html: icons.info, onclick: () => { infoOpen = !infoOpen; drawInfo() } }),
      h('button', { class: 'btn small', onclick: () => {
        const id = photos[index].id
        // Close first (= history.back()); navigate once that has happened.
        void close().then(() => opts.onEdit(id))
      } }, t('view.edit')),
      h('button', { class: 'icon-btn dark', 'aria-label': t('ed.save'), html: icons.download, onclick: () => void doSave() }),
      h('button', { class: 'icon-btn dark', 'aria-label': t('ed.share'), html: icons.share, onclick: () => void doShare() }),
      h('button', { class: 'icon-btn dark', 'aria-label': t('view.delete'), html: icons.trash, onclick: () => void doDelete() }),
    ),
  )
  document.body.append(root)
  document.body.classList.add('viewer-open')

  // Android back gesture closes the viewer
  const release = pushBack(() => teardown())

  // ---- image URLs: full image for the current photo, thumbnails for neighbours ----
  const ownedUrls = new Set<string>()
  async function fullUrl(p: Photo): Promise<string | null> {
    const blob = !showOriginal && p.resultSize ? await resultFile(p.id) : await previewBlob(p)
    if (!blob) return thumbUrl(p)
    const url = URL.createObjectURL(blob)
    ownedUrls.add(url)
    return url
  }

  let drawToken = 0
  async function draw() {
    const token = ++drawToken
    const p = photos[index]
    counter.textContent = `${index + 1} / ${photos.length}`
    heartBtn.innerHTML = p.favorite ? icons.heartFilled : icons.heart
    heartBtn.classList.toggle('on', p.favorite)
    compareBtn.hidden = !p.resultSize
    compareBtn.classList.toggle('active', showOriginal)
    tag.textContent = p.resultSize && !showOriginal ? t('ed.result') : t('ed.original')
    resetZoom()
    track.style.transition = 'none'
    track.style.transform = 'translateX(-100%)'

    // neighbours: thumbnails (fast); current: thumbnail first, then full image
    const imgs = slides.map(s => s.querySelector('img')!)
    for (const [k, off] of [[0, -1], [2, 1]] as const) {
      const n = photos[index + off]
      imgs[k].removeAttribute('src')
      if (n) void thumbUrl(n).then(u => { if (u && token === drawToken) imgs[k].src = u })
    }
    const thumb = await thumbUrl(p)
    if (token !== drawToken) return
    if (thumb) imgs[1].src = thumb
    const full = await fullUrl(p)
    if (token !== drawToken || !full) return
    // Swap only after decoding, so there is no blank flash
    const tmp = new Image()
    tmp.src = full
    await tmp.decode().catch(() => {})
    if (token !== drawToken) return
    for (const u of ownedUrls) if (u !== full) { URL.revokeObjectURL(u); ownedUrls.delete(u) }
    imgs[1].src = full
    drawInfo()
  }

  function drawInfo() {
    info.hidden = !infoOpen
    if (!infoOpen) return
    const p = photos[index]
    const r = p.recipe ?? p.asShot
    const date = p.dateTaken ? new Date(p.dateTaken).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }) : '—'
    info.replaceChildren(
      h('div', { class: 'vinfo-summary label' }, summarize(r)),
      h('dl', { class: 'vinfo-grid' },
        h('dt', { class: 'label' }, t('view.file')), h('dd', null, p.fileName),
        h('dt', { class: 'label' }, t('view.taken')), h('dd', null, date),
        h('dt', { class: 'label' }, t('view.camera')), h('dd', null, p.cameraName),
        h('dt', { class: 'label' }, 'RAW'), h('dd', null, p.rafDeleted ? t('view.rawDeleted') : formatBytes(p.fileSize)),
        h('dt', { class: 'label' }, 'JPEG'), h('dd', null, p.resultSize ? formatBytes(p.resultSize) : '—'),
      ),
      h('div', { class: 'label vinfo-sub' }, p.recipe ? t('view.recipe') : t('ed.asShot')),
      h('dl', { class: 'vinfo-grid' },
        ...FIELDS.filter(f => !f.visible || f.visible(r)).flatMap(f => [
          h('dt', { class: 'label' }, t(f.label)), h('dd', null, f.format(r)),
        ]),
      ),
    )
  }

  // ---- navigation ----
  function go(delta: number) {
    const next = index + delta
    if (next < 0 || next >= photos.length) { springBack(); return }
    track.style.transition = 'transform 0.22s ease-out'
    track.style.transform = `translateX(${-100 - delta * 100}%)`
    setTimeout(() => { index = next; showOriginal = false; void draw() }, 220)
  }
  function springBack() {
    track.style.transition = 'transform 0.2s ease-out'
    track.style.transform = 'translateX(-100%)'
  }

  // ---- zoom helpers ----
  const img = () => slides[1].querySelector('img')!
  function applyZoom() {
    img().style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
  }
  function resetZoom() { scale = 1; tx = 0; ty = 0; img().style.transition = 'none'; applyZoom() }
  function clampPan() {
    const w = stage.clientWidth, hgt = stage.clientHeight
    const maxX = ((scale - 1) * w) / 2, maxY = ((scale - 1) * hgt) / 2
    tx = Math.max(-maxX, Math.min(maxX, tx))
    ty = Math.max(-maxY, Math.min(maxY, ty))
  }

  // ---- gestures ----
  const pointers = new Map<number, { x: number; y: number }>()
  let start: { x: number; y: number; tx: number; ty: number; scale: number; dist: number; mx: number; my: number } | null = null
  let swiping = false
  let lastTap = 0

  const center = () => {
    const r = stage.getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }

  function beginGesture() {
    const pts = [...pointers.values()]
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0
    start = { x: pts[0].x, y: pts[0].y, tx, ty, scale, dist, mx, my }
    swiping = false
  }

  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    img().style.transition = 'none'
    track.style.transition = 'none'
    beginGesture()
  })

  stage.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId) || !start) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.values()]

    if (pts.length >= 2 && start.dist > 0) {
      // PINCH: new scale from finger distance; keep the point between the
      // fingers under the fingers (that's what makes zoom feel natural).
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2
      const { cx, cy } = center()
      const s = Math.max(1, Math.min(6, start.scale * (dist / start.dist)))
      const k = s / start.scale
      tx = mx - cx - k * (start.mx - cx - start.tx)
      ty = my - cy - k * (start.my - cy - start.ty)
      scale = s
      clampPan()
      applyZoom()
      return
    }

    const dx = e.clientX - start.x, dy = e.clientY - start.y
    if (scale > 1.01) {
      // PAN the zoomed image
      tx = start.tx + dx; ty = start.ty + dy
      clampPan()
      applyZoom()
    } else if (swiping || (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy))) {
      // SWIPE between photos
      swiping = true
      track.style.transform = `translateX(calc(-100% + ${dx}px))`
    }
  })

  const end = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return
    pointers.delete(e.pointerId)
    if (!start) return
    const dx = e.clientX - start.x, dy = e.clientY - start.y

    if (pointers.size > 0) { beginGesture(); return } // one finger lifted during pinch

    if (swiping) {
      const w = stage.clientWidth
      if (dx < -w * 0.18) go(1)
      else if (dx > w * 0.18) go(-1)
      else springBack()
    } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      // A tap. Two taps within 300 ms = double-tap → zoom in / out
      const now = Date.now()
      if (now - lastTap < 300) {
        img().style.transition = 'transform 0.2s ease-out'
        if (scale > 1.01) { scale = 1; tx = 0; ty = 0 }
        else {
          const { cx, cy } = center()
          scale = 2.5
          tx = (e.clientX - cx) * (1 - scale)
          ty = (e.clientY - cy) * (1 - scale)
          clampPan()
        }
        applyZoom()
        lastTap = 0
      } else lastTap = now
    }
    start = null
    swiping = false
  }
  stage.addEventListener('pointerup', end)
  stage.addEventListener('pointercancel', end)

  // ---- actions ----
  heartBtn.addEventListener('click', async () => {
    const p = photos[index]
    const updated = { ...p, favorite: !p.favorite }
    photos[index] = updated
    await updatePhoto(updated)
    void draw()
  })
  compareBtn.addEventListener('click', () => { showOriginal = !showOriginal; void draw() })

  async function currentFile(): Promise<File | null> {
    const p = photos[index]
    const f = p.resultSize ? await resultFile(p.id) : null
    if (!f) { toast(t('view.noRender')); return null }
    return new File([f], exportName(p), { type: 'image/jpeg' })
  }
  async function doSave() {
    const f = await currentFile()
    if (!f) return
    await saveFiles([f])
    await markExported([photos[index].id])
  }
  async function doShare() {
    const f = await currentFile()
    if (!f) return
    if (await shareFiles([f])) await markExported([photos[index].id])
  }
  async function doDelete() {
    const p = photos[index]
    const ok = await confirmSheet(t('view.deleteTitle'), t('view.deleteText', { name: p.fileName }), t('view.delete'), t('common.cancel'), true)
    if (!ok) return
    await deletePhoto(p.id)
    photos.splice(index, 1)
    if (!photos.length) { void close(); return }
    index = Math.min(index, photos.length - 1)
    void draw()
  }

  // ---- closing ----
  let closed = false
  /** Close via button: also remove our history entry. Resolves when done. */
  function close(): Promise<void> {
    const done = release()
    teardown()
    return done
  }
  function teardown() {
    if (closed) return
    closed = true
    for (const u of ownedUrls) URL.revokeObjectURL(u)
    document.body.classList.remove('viewer-open')
    root.remove()
    opts.onClose?.(index)
  }

  // Refresh the record (e.g. favorite changed elsewhere) and draw
  void getPhoto(photos[index].id).then(p => { if (p) photos[index] = p; void draw() })
}
