/**
 * Crop screen: drag the corners of the rectangle, or move it as a whole.
 * Aspect-ratio buttons lock the shape (1:1, 4:5, 16:9 …).
 *
 * All math is done in FRACTIONS of the image (0…1), so it is independent of
 * how large the image happens to be shown on screen.
 */

import { h } from '../ui/dom.ts'
import { t } from '../i18n/index.ts'
import { pushBack } from '../ui/back-stack.ts'
import type { Crop } from '../library/photos.ts'

const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 }
const MIN = 0.08 // smallest crop: 8 % of the image

/** Ratios as width / height. 0 = free, -1 = same shape as the photo. */
const RATIOS: { label: string; value: number }[] = [
  { label: 'crop.free', value: 0 }, { label: 'crop.original', value: -1 },
  { label: '1:1', value: 1 }, { label: '4:5', value: 4 / 5 }, { label: '5:4', value: 5 / 4 },
  { label: '3:2', value: 3 / 2 }, { label: '2:3', value: 2 / 3 }, { label: '16:9', value: 16 / 9 }, { label: '9:16', value: 9 / 16 },
]

/**
 * Open the crop screen.
 * Resolves with the new crop, `null` for "no crop", or `undefined` if cancelled.
 */
export function openCropper(imageUrl: string, initial: Crop | null | undefined): Promise<Crop | null | undefined> {
  return new Promise(resolve => {
    let crop: Crop = { ...(initial ?? FULL) }
    let ratio = 0 // currently locked ratio (width / height in pixels), 0 = free
    let result: Crop | null | undefined

    const img = h('img', { src: imageUrl, alt: '', draggable: 'false' })
    const box = h('div', { class: 'crop-box' },
      ...['nw', 'ne', 'sw', 'se'].map(c => h('i', { class: `crop-handle ${c}`, 'data-corner': c })),
      h('div', { class: 'crop-grid' }),
    )
    const area = h('div', { class: 'crop-area' }, img, box)
    const chips = h('div', { class: 'chips crop-chips' })
    const root = h('div', { class: 'cropper', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'crop-stage' }, area),
      chips,
      h('div', { class: 'crop-actions' },
        h('button', { class: 'btn ghost small', onclick: () => finish(undefined) }, t('common.cancel')),
        h('button', { class: 'btn ghost small', onclick: () => { crop = { ...FULL }; ratio = 0; draw() } }, t('crop.reset')),
        h('button', { class: 'btn small', onclick: () => finish(isFull(crop) ? null : crop) }, t('ed.done')),
      ),
    )
    document.body.append(root)
    const release = pushBack(() => close())

    const isFull = (c: Crop) => c.x < 0.001 && c.y < 0.001 && c.w > 0.999 && c.h > 0.999
    /** Pixel aspect of the whole image (width / height) */
    const imageAspect = () => (img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1.5)
    /** For a locked pixel ratio r: how wide is the box per unit of height, in fractions? */
    const k = () => ratio / imageAspect()

    function draw() {
      box.style.left = `${crop.x * 100}%`
      box.style.top = `${crop.y * 100}%`
      box.style.width = `${crop.w * 100}%`
      box.style.height = `${crop.h * 100}%`
      chips.replaceChildren(...RATIOS.map(r => {
        const value = r.value === -1 ? imageAspect() : r.value
        const on = Math.abs(value - ratio) < 0.001
        const label = r.label.startsWith('crop.') ? t(r.label as 'crop.free' | 'crop.original') : r.label
        return h('button', { class: `chip${on ? ' on' : ''}`, onclick: () => setRatio(value) }, label)
      }))
    }

    /** Lock a ratio: biggest box of that shape, centred on the current box. */
    function setRatio(r: number) {
      ratio = r
      if (r > 0) {
        const kk = k()
        let w = crop.w, hh = w / kk
        if (hh > 1) { hh = 1; w = kk }
        if (w > 1) { w = 1; hh = 1 / kk }
        // grow to the largest that still fits around the old centre
        const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2
        const scale = Math.min(1 / w, 1 / hh)
        w *= scale; hh *= scale
        crop = { w, h: hh, x: Math.min(Math.max(0, cx - w / 2), 1 - w), y: Math.min(Math.max(0, cy - hh / 2), 1 - hh) }
      }
      draw()
    }

    // ---- dragging ----
    let drag: { corner: string | null; startX: number; startY: number; start: Crop } | null = null
    const toFrac = (e: PointerEvent) => {
      const r = area.getBoundingClientRect()
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
    }
    const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

    box.addEventListener('pointerdown', e => {
      const corner = (e.target as HTMLElement).dataset.corner ?? null
      const p = toFrac(e)
      drag = { corner, startX: p.x, startY: p.y, start: { ...crop } }
      box.setPointerCapture(e.pointerId)
      e.preventDefault()
    })
    box.addEventListener('pointermove', e => {
      if (!drag) return
      const p = toFrac(e)
      const s = drag.start
      if (!drag.corner) {
        // MOVE the whole box
        crop = {
          ...s,
          x: Math.min(Math.max(0, s.x + p.x - drag.startX), 1 - s.w),
          y: Math.min(Math.max(0, s.y + p.y - drag.startY), 1 - s.h),
        }
      } else {
        // RESIZE: the corner opposite to the dragged one stays fixed
        const fx = drag.corner.includes('w') ? s.x + s.w : s.x
        const fy = drag.corner.includes('n') ? s.y + s.h : s.y
        const px = clamp01(p.x), py = clamp01(p.y)
        let w = Math.max(MIN, Math.abs(px - fx)), hh = Math.max(MIN, Math.abs(py - fy))
        if (ratio > 0) {
          const kk = k()
          if (w / hh > kk) w = hh * kk; else hh = w / kk
          // keep inside the image on the side we grow towards
          const maxW = drag.corner.includes('w') ? fx : 1 - fx
          const maxH = drag.corner.includes('n') ? fy : 1 - fy
          const shrink = Math.min(1, maxW / w, maxH / hh)
          w *= shrink; hh *= shrink
        }
        crop = { w, h: hh, x: drag.corner.includes('w') ? fx - w : fx, y: drag.corner.includes('n') ? fy - hh : fy }
      }
      draw()
    })
    const stop = () => { drag = null }
    box.addEventListener('pointerup', stop)
    box.addEventListener('pointercancel', stop)

    function close() {
      root.remove()
      resolve(result)
    }
    function finish(value: Crop | null | undefined) {
      result = value
      void release()
      close()
    }

    img.addEventListener('load', draw)
    draw()
  })
}
