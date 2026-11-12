/**
 * EDITOR — change the recipe of one photo; the CAMERA renders the result.
 *
 * Flow:
 *   1. Show the RAF's embedded preview right away ("original").
 *   2. The user changes a setting in the grid → the tile updates instantly.
 *   3. After a short pause (debounce) the new settings go to the camera:
 *      (first time: upload the RAF) → patch profile → convert → JPEG.
 *   4. The JPEG is shown and stored as the photo's result (OPFS).
 *
 * Rapid changes are merged: while you tap "+ + + +", nothing is sent; 700 ms
 * after the LAST tap one render starts. If you change something during a
 * render, the next render starts as soon as the camera is free.
 */

import { h, debounce, toast, openSheet, type Sheet } from '../ui/dom.ts'
import { icons } from '../ui/icons.ts'
import { t } from '../i18n/index.ts'
import { cameraService, CancelledError } from '../camera/camera-service.ts'
import type { ConvertStage } from '../camera/ptp/session.ts'
import { FIELDS, TONE_FIELDS, recipesEqual, summarize, type FieldDef, type Recipe } from '../recipes/recipe.ts'
import { getPhoto, markExported, previewBlob, rafBytes, resultFile, saveResult, type Photo } from '../library/photos.ts'
import { cameraPill } from '../app/components.ts'
import { navigate, type View } from '../app/shell.ts'
import { log } from '../ui/debug-log.ts'
import { pushBack } from '../ui/back-stack.ts'

const RENDER_DEBOUNCE_MS = 700

export const editorView: View = (root, [photoId]) => {
  let disposed = false
  let photo: Photo | undefined
  let recipe: Recipe            // what the tiles show
  let rendered: Recipe | null = null // what the shown result was rendered with
  const undoStack: Recipe[] = [] // for undo
  let originalUrl: string | null = null
  let resultUrl: string | null = null
  let showOriginal = false
  let rendering = false
  let renderAgain = false

  // ---- elements ----
  const img = h('img', { class: 'stage-img', alt: '' })
  const overlay = h('div', { class: 'stage-overlay', hidden: true }, h('div', { class: 'spinner' }), h('span', { class: 'label' }))
  const overlayText = overlay.querySelector('span')!
  const tag = h('span', { class: 'stage-tag label' })
  const compareBtn = h('button', { class: 'icon-btn on-image', 'aria-label': t('ed.compare'), html: icons.compare })
  const fullBtn = h('button', { class: 'icon-btn on-image', 'aria-label': t('ed.fullscreen'), html: icons.expand })
  const stage = h('div', { class: 'stage' }, img, overlay, tag, h('div', { class: 'stage-tools' }, compareBtn, fullBtn))
  const statusLine = h('div', { class: 'ed-status label' })
  const summaryLine = h('div', { class: 'ed-summary label' })
  const grid = h('div', { class: 'tiles' })
  const undoBtn = h('button', { class: 'icon-btn', 'aria-label': t('ed.undo'), html: icons.undo, disabled: true })
  const pill = cameraPill(() => navigate('camera'))
  const downloadBtn = h('button', { class: 'btn' }, h('span', { html: icons.download }), t('ed.save'))
  const shareBtn = h('button', { class: 'btn ghost', 'aria-label': t('ed.share') }, h('span', { html: icons.share }))
  const resetBtn = h('button', { class: 'btn ghost' }, t('ed.reset'))
  const title = h('div', { class: 'ed-title' })

  root.append(
    h('div', { class: 'editor' },
      h('div', { class: 'ed-top' },
        h('button', { class: 'icon-btn', 'aria-label': t('ed.back'), html: icons.back, onclick: () => goBack() }),
        title,
        undoBtn,
      ),
      h('div', { class: 'ed-main' },
        h('div', { class: 'ed-left' }, stage, h('div', { class: 'ed-meta' }, statusLine, pill), summaryLine),
        h('div', { class: 'ed-right' },
          grid,
          h('div', { class: 'ed-actions' }, downloadBtn, shareBtn, resetBtn),
        ),
      ),
    ),
  )

  function goBack() {
    // Prefer real "back" (keeps scroll position of the previous screen)
    if (window.history.length > 1) window.history.back()
    else navigate('library', true)
  }

  // ======================================================================
  // Loading the photo
  // ======================================================================

  void (async () => {
    photo = await getPhoto(photoId)
    if (disposed) return
    if (!photo) { toast(t('ed.notFound'), 'error'); navigate('library', true); return }
    title.replaceChildren(h('div', { class: 'label' }, photo.fileName), h('div', { class: 'ed-date' }, formatDate(photo.dateTaken)))

    recipe = { ...(photo.recipe ?? photo.asShot) }
    const pv = await previewBlob(photo)
    if (pv) originalUrl = URL.createObjectURL(pv)
    if (photo.resultSize) {
      const f = await resultFile(photo.id)
      if (f) { resultUrl = URL.createObjectURL(f); rendered = { ...recipe } }
    }
    if (disposed) return
    drawTiles()
    showImage()
    updateStatus()
    // No camera render yet? Do one now if the camera is there.
    if (!rendered) scheduleRender(0)
  })()

  // When the camera (re)connects and the shown image is out of date → render.
  const offCam = cameraService.subscribe(() => {
    updateStatus()
    if (cameraService.isReady && photo && isDirty()) scheduleRender(0)
  })

  // ======================================================================
  // Rendering in the camera
  // ======================================================================

  const isDirty = () => !rendered || !recipesEqual(recipe, rendered)

  const STAGE_TEXT: Record<ConvertStage, string> = {
    upload: t('ed.stage.upload'),
    profile: t('ed.stage.profile'),
    convert: t('ed.stage.convert'),
    download: t('ed.stage.download'),
    done: '',
  }

  const debouncedRender = debounce(() => void render(), RENDER_DEBOUNCE_MS)
  function scheduleRender(delay = RENDER_DEBOUNCE_MS) {
    updateStatus()
    if (delay === 0) { debouncedRender.cancel(); void render() } else debouncedRender()
  }

  async function render() {
    if (disposed || !photo || photo.rafDeleted || !cameraService.isReady || !isDirty()) { updateStatus(); return }
    if (rendering) { renderAgain = true; return } // camera busy: run again when done
    rendering = true
    const p = photo
    const snapshot = { ...recipe }
    const t0 = performance.now()
    overlay.hidden = false
    overlayText.textContent = t('ed.stage.start')
    try {
      const jpeg = await cameraService.render(p.id, () => rafBytes(p), snapshot, p.asShot, {
        onStage: s => { overlayText.textContent = STAGE_TEXT[s] },
        onUploadProgress: (done, total) => {
          overlayText.textContent = `${STAGE_TEXT.upload} ${Math.round((done / total) * 100)} %`
        },
      })
      const secs = ((performance.now() - t0) / 1000).toFixed(1)
      log(`Rendered ${p.fileName} in ${secs} s (${(jpeg.length / 1024 / 1024).toFixed(1)} MB)`, 'ok')
      const maxDR = cameraService.shotDynamicRange ?? p.maxDR
      photo = await saveResult({ ...p, maxDR }, jpeg, snapshot)
      if (disposed) return
      if (resultUrl) URL.revokeObjectURL(resultUrl)
      resultUrl = URL.createObjectURL(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }))
      rendered = snapshot
      lastRenderSecs = secs
      showOriginal = false
      showImage()
      drawTiles()
    } catch (err) {
      if (!(err instanceof CancelledError)) {
        log(`Render failed: ${err}`, 'error')
        toast(t('ed.renderFailed'), 'error')
      }
    } finally {
      rendering = false
      overlay.hidden = true
      updateStatus()
      if (renderAgain && !disposed) { renderAgain = false; void render() }
    }
  }
  let lastRenderSecs = ''

  // ======================================================================
  // Image display
  // ======================================================================

  function showImage() {
    const useOriginal = showOriginal || !resultUrl
    const src = useOriginal ? originalUrl : resultUrl
    if (src && img.src !== src) img.src = src
    tag.textContent = useOriginal ? t('ed.original') : t('ed.result')
    compareBtn.classList.toggle('active', showOriginal)
    compareBtn.hidden = !resultUrl
  }

  compareBtn.addEventListener('click', () => { showOriginal = !showOriginal; showImage() })

  fullBtn.addEventListener('click', () => openFullscreen(img.src))

  // ======================================================================
  // Status line under the image
  // ======================================================================

  function updateStatus() {
    if (!photo) return
    undoBtn.disabled = undoStack.length === 0
    summaryLine.textContent = summarize(recipe)
    let text: string
    if (photo.rafDeleted) text = t('ed.st.rawDeleted')
    else if (rendering) text = t('ed.st.rendering')
    else if (!cameraService.isReady && isDirty()) text = t('ed.st.needCamera')
    else if (isDirty()) text = t('ed.st.pending')
    else text = lastRenderSecs ? t('ed.st.renderedIn', { s: lastRenderSecs }) : t('ed.st.upToDate')
    statusLine.textContent = text
    shareBtn.disabled = !resultUrl
    downloadBtn.disabled = !resultUrl
    resetBtn.disabled = recipesEqual(recipe, photo.asShot)
  }

  // ======================================================================
  // Settings grid
  // ======================================================================

  function drawTiles() {
    if (!photo) return
    const asShot = photo.asShot
    grid.replaceChildren(...FIELDS.filter(f => !f.visible || f.visible(recipe)).map(f => {
      const locked = f.lockedBy?.(recipe) ?? null
      const changed = recipe[f.key] !== asShot[f.key]
      return h('button', {
        class: `tile${changed ? ' changed' : ''}${locked ? ' locked' : ''}`,
        onclick: () => openPicker(f),
      },
        h('span', { class: 'tile-label label' }, t(f.label)),
        h('span', { class: 'tile-value' }, f.format(recipe)),
      )
    }))
  }

  /** Apply a change to the recipe (with all the rules that go with it). */
  function apply(key: keyof Recipe, value: unknown) {
    const next = { ...recipe, [key]: value } as Recipe
    // Changing a tone setting turns D-Range Priority off (like in the camera
    // menu, where tones are greyed out while D-Range Priority is active).
    if (TONE_FIELDS.includes(key) && next.dRangePriority !== 'off') next.dRangePriority = 'off'
    // Choosing grain size while grain is off → switch grain on (weak).
    if (key === 'grainSize' && next.grain === 'off') next.grain = 'weak'
    recipe = next
    drawTiles()
    scheduleRender()
  }

  function pushHistory(r: Recipe) {
    undoStack.push({ ...r })
    if (undoStack.length > 100) undoStack.shift()
  }

  undoBtn.addEventListener('click', () => {
    const prev = undoStack.pop()
    if (!prev) return
    recipe = prev
    drawTiles()
    scheduleRender()
  })

  resetBtn.addEventListener('click', () => {
    if (!photo) return
    pushHistory(recipe)
    recipe = { ...photo.asShot }
    drawTiles()
    scheduleRender()
  })

  /** Open the bottom sheet for one setting. */
  /** Options of a field, minus those this particular photo can't use. */
  function optionsFor(f: FieldDef) {
    const opts = f.options()
    if (f.key !== 'dynamicRange' || !photo?.maxDR) return opts
    return opts.filter(o => typeof o.value !== 'number' || o.value <= photo!.maxDR!)
  }

  function openPicker(f: FieldDef) {
    let firstChange = true
    const change = (value: unknown) => {
      if (recipe[f.key] === value) return
      if (firstChange) { pushHistory(recipe); firstChange = false } // one undo step per sheet
      apply(f.key, value)
      redraw()
    }
    const sheet: Sheet = openSheet(t(f.label))
    const redraw = () => {
      const parts = f.numeric ? numericBody() : listBody()
      sheet.body.replaceChildren(...(parts.filter(Boolean) as Node[]))
    }

    const lockNote = () => {
      const reason = f.lockedBy?.(recipe)
      return reason ? h('p', { class: 'sheet-note' }, t(reason)) : null
    }

    // Long lists (film simulations, white balance): one big row per value.
    const listBody = () => [
      lockNote(),
      h('div', { class: 'opt-list' }, ...optionsFor(f).map(o =>
        h('button', {
          class: `opt${o.value === recipe[f.key] ? ' on' : ''}`,
          onclick: () => { change(o.value); sheet.close() },
        }, h('span', null, o.label), o.value === photo!.asShot[f.key] ? h('span', { class: 'label' }, t('ed.asShot')) : null),
      )),
    ]

    // Numbers: big value, − / + buttons and a slider. Stays open for fine-tuning.
    const numericBody = () => {
      const opts = optionsFor(f)
      const idx = Math.max(0, opts.findIndex(o => o.value === recipe[f.key]))
      const slider = h('input', { type: 'range', min: 0, max: opts.length - 1, step: 1, value: idx, class: 'slider', 'aria-label': t(f.label) }) as HTMLInputElement
      slider.addEventListener('input', () => change(opts[Number(slider.value)].value))
      return [
        lockNote(),
        h('div', { class: 'stepper' },
          h('button', { class: 'icon-btn big', 'aria-label': '−', html: icons.minus, disabled: idx === 0, onclick: () => change(opts[idx - 1].value) }),
          h('div', { class: 'stepper-value' }, opts[idx]?.label ?? '?'),
          h('button', { class: 'icon-btn big', 'aria-label': '+', html: icons.plus, disabled: idx === opts.length - 1, onclick: () => change(opts[idx + 1].value) }),
        ),
        slider,
        h('div', { class: 'row between' },
          h('button', { class: 'btn ghost small', onclick: () => change(photo!.asShot[f.key]) }, t('ed.asShot')),
          h('button', { class: 'btn small', onclick: () => sheet.close() }, t('ed.done')),
        ),
      ]
    }
    redraw()
  }

  // ======================================================================
  // Save / share
  // ======================================================================

  function exportName(): string {
    return (photo?.fileName ?? 'photo').replace(/\.raf$/i, '') + '_FilmLab.jpg'
  }

  async function resultAsFile(): Promise<File | null> {
    if (!photo) return null
    if (isDirty()) toast(t('ed.notRenderedYet'))
    const f = await resultFile(photo.id)
    return f ? new File([f], exportName(), { type: 'image/jpeg' }) : null
  }

  shareBtn.addEventListener('click', async () => {
    const file = await resultAsFile()
    if (!file) return
    // Web Share API: opens Android's share sheet (Google Photos, Gallery, …)
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: exportName() })
        if (photo) await markExported([photo.id])
        return
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return
        log(`Share failed: ${err}`, 'warn')
      }
    }
    toast(t('ed.shareUnavailable'))
  })

  downloadBtn.addEventListener('click', async () => {
    const file = await resultAsFile()
    if (file) { download(file); if (photo) await markExported([photo.id]) }
  })

  function download(file: File) {
    const url = URL.createObjectURL(file)
    const a = h('a', { href: url, download: file.name })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    toast(t('ed.downloaded'))
  }

  // ======================================================================
  // Cleanup when leaving the screen
  // ======================================================================

  return () => {
    disposed = true
    debouncedRender.cancel()
    offCam()
    pill.dispose()
    if (originalUrl) URL.revokeObjectURL(originalUrl)
    if (resultUrl) URL.revokeObjectURL(resultUrl)
  }
}

/** "2026-10-19T10:01:21" → localized "19.10.2026, 10:01" */
function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Full-screen image view. Tap or Android "back" closes it. */
function openFullscreen(src: string) {
  if (!src) return
  const view = h('div', { class: 'fullscreen' }, h('img', { src, alt: '' }))
  const hide = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    view.remove()
  }
  const release = pushBack(hide)
  view.addEventListener('click', () => { void release(); hide() })
  document.body.append(view)
  void view.requestFullscreen?.().catch(() => {})
}
