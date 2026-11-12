/**
 * ZoomImage — shows an image (optionally only a crop of it) that can be
 * zoomed with a pinch or a double-tap and moved around with one finger.
 *
 * How the crop is shown without making a new image file:
 *   a "frame" element has exactly the size of the visible crop and hides
 *   everything outside (overflow: hidden). The <img> inside is made BIGGER
 *   than the frame and shifted, so that just the crop rectangle shows through.
 *
 * How zoom works: the frame gets a CSS transform (translate + scale). All
 * gestures only change three numbers: scale, tx, ty.
 */

import type { Crop } from '../library/photos.ts'

export interface ZoomImage {
  el: HTMLElement
  setSource(url: string | null): void
  setCrop(crop: Crop | null | undefined): void
  resetZoom(): void
  destroy(): void
}

const MAX_SCALE = 8

export function createZoomImage(): ZoomImage {
  const img = document.createElement('img')
  img.alt = ''
  img.draggable = false
  const frame = document.createElement('div')
  frame.className = 'zoom-frame'
  frame.append(img)
  const el = document.createElement('div')
  el.className = 'zoom'
  el.append(frame)

  let crop: Crop | null = null
  let scale = 1, tx = 0, ty = 0

  /** Size the frame so the (cropped) image fits the container ("contain"). */
  function layout() {
    const nw = img.naturalWidth, nh = img.naturalHeight
    const cw = el.clientWidth, ch = el.clientHeight
    if (!nw || !nh || !cw || !ch) return
    const c = crop ?? { x: 0, y: 0, w: 1, h: 1 }
    const aspect = (nw * c.w) / (nh * c.h)
    let fw = cw, fh = cw / aspect
    if (fh > ch) { fh = ch; fw = ch * aspect }
    frame.style.width = `${fw}px`
    frame.style.height = `${fh}px`
    // The whole image, scaled so that the crop fills the frame
    const iw = fw / c.w, ih = fh / c.h
    img.style.width = `${iw}px`
    img.style.height = `${ih}px`
    img.style.left = `${-c.x * iw}px`
    img.style.top = `${-c.y * ih}px`
    clamp()
    apply()
  }

  function apply() {
    frame.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
    // Not zoomed: let the page scroll vertically when you drag over the image.
    // Zoomed: all touches belong to us (panning the image).
    el.style.touchAction = scale > 1.01 ? 'none' : 'pan-y'
    el.classList.toggle('zoomed', scale > 1.01)
  }

  /** Don't let the image be dragged further than its own edge. */
  function clamp() {
    const maxX = Math.max(0, (frame.offsetWidth * scale - el.clientWidth) / 2)
    const maxY = Math.max(0, (frame.offsetHeight * scale - el.clientHeight) / 2)
    tx = Math.max(-maxX, Math.min(maxX, tx))
    ty = Math.max(-maxY, Math.min(maxY, ty))
  }

  function resetZoom() {
    scale = 1; tx = 0; ty = 0
    frame.style.transition = 'none'
    apply()
  }

  // ---- gestures (same idea as in the viewer) ----
  const pointers = new Map<number, { x: number; y: number }>()
  let start: { x: number; y: number; tx: number; ty: number; scale: number; dist: number; mx: number; my: number } | null = null
  let lastTap = 0

  const center = () => {
    const r = el.getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }
  function begin() {
    const pts = [...pointers.values()]
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0
    start = { x: pts[0].x, y: pts[0].y, tx, ty, scale, dist, mx, my }
  }

  el.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    frame.style.transition = 'none'
    // Capture only when we will really use the gesture (zoomed or two fingers),
    // otherwise a normal vertical page scroll must stay possible.
    if (scale > 1.01 || pointers.size > 1) el.setPointerCapture(e.pointerId)
    begin()
  })
  el.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId) || !start) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.values()]
    if (pts.length >= 2 && start.dist > 0) {
      // PINCH: keep the point between the fingers under the fingers
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2
      const { cx, cy } = center()
      const s = Math.max(1, Math.min(MAX_SCALE, start.scale * (dist / start.dist)))
      const k = s / start.scale
      tx = mx - cx - k * (start.mx - cx - start.tx)
      ty = my - cy - k * (start.my - cy - start.ty)
      scale = s
      clamp(); apply()
    } else if (scale > 1.01) {
      // PAN
      tx = start.tx + (e.clientX - start.x)
      ty = start.ty + (e.clientY - start.y)
      clamp(); apply()
    }
  })
  const end = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return
    pointers.delete(e.pointerId)
    if (!start) return
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (pointers.size > 0) { begin(); return }
    if (moved < 10 && e.type === 'pointerup') {
      const now = Date.now()
      if (now - lastTap < 300) {
        // DOUBLE-TAP: zoom in on the tapped spot, or back out
        frame.style.transition = 'transform 0.2s ease-out'
        if (scale > 1.01) { scale = 1; tx = 0; ty = 0 }
        else {
          const { cx, cy } = center()
          scale = 3
          tx = (e.clientX - cx) * (1 - scale)
          ty = (e.clientY - cy) * (1 - scale)
          clamp()
        }
        apply()
        lastTap = 0
      } else lastTap = now
    }
    if (scale <= 1.01) { scale = 1; tx = 0; ty = 0; apply() }
    start = null
  }
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)

  img.addEventListener('load', layout)
  const ro = new ResizeObserver(layout)
  ro.observe(el)
  apply()

  return {
    el,
    setSource(url) {
      if (!url) { img.removeAttribute('src'); return }
      if (img.src !== url) img.src = url // zoom is kept on purpose: compare original/result at the same spot
    },
    setCrop(c) { crop = c ?? null; layout() },
    resetZoom,
    destroy() { ro.disconnect() },
  }
}
