/**
 * Small UI pieces used on several screens.
 */

import { h } from '../ui/dom.ts'
import { icons } from '../ui/icons.ts'
import { t, getLang, setLang, type Dict } from '../i18n/index.ts'
import { cameraService, type CameraStatus } from '../camera/camera-service.ts'
import { importFiles, thumbUrl, type Photo } from '../library/photos.ts'
import { toast } from '../ui/dom.ts'
import { navigate } from './shell.ts'
import { getTheme, setTheme, type ThemeChoice } from './theme.ts'

/** Screen header: serif title + optional small label + right-side extras. */
export function header(title: string, label?: string, ...right: Node[]): HTMLElement {
  return h('header', { class: 'screen-head' },
    h('div', null,
      label ? h('div', { class: 'label' }, label) : null,
      h('h1', null, title),
    ),
    h('div', { class: 'row' }, ...right),
  )
}

/** "DE | EN" language switch. */
export function langSwitch(): HTMLElement {
  const cur = getLang()
  return h('div', { class: 'seg', role: 'group', 'aria-label': 'Language' },
    ...(['de', 'en'] as const).map(l =>
      h('button', { class: l === cur ? 'on' : '', 'aria-pressed': String(l === cur), onclick: () => setLang(l) }, l.toUpperCase())),
  )
}

/** Theme switch: system / light / dark */
export function themeSwitch(): HTMLElement {
  const cur = getTheme()
  const names = { system: 'theme.system', light: 'theme.light', dark: 'theme.dark' } as const
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('theme.label') })
  const draw = (active: ThemeChoice) => seg.replaceChildren(...(['system', 'light', 'dark'] as const).map(c =>
    h('button', { class: c === active ? 'on' : '', 'aria-pressed': String(c === active), onclick: () => { setTheme(c); draw(c) } }, t(names[c]))))
  draw(cur)
  return seg
}

const STATUS_TEXT: Record<CameraStatus, keyof Dict> = {
  unsupported: 'cam.status.unsupported',
  idle: 'cam.status.idle',
  waiting: 'cam.status.waiting',
  connecting: 'cam.status.connecting',
  connected: 'cam.status.connected',
  'wrong-mode': 'cam.status.wrongMode',
  error: 'cam.status.error',
}

/**
 * Live camera status pill (dot + text). Updates itself; call the returned
 * element's `dispose()` (via the cleanup list) when the screen closes.
 */
export function cameraPill(onClick?: () => void): HTMLElement & { dispose: () => void } {
  const text = h('span')
  const pill = h(onClick ? 'button' : 'span', { class: 'status-pill', onclick: onClick }, h('i'), text) as HTMLElement & { dispose: () => void }
  const update = () => {
    pill.dataset.kind = cameraService.status
    const model = cameraService.isReady ? ` · ${cameraService.model}` : ''
    text.textContent = t(STATUS_TEXT[cameraService.status]) + model
  }
  update()
  pill.dispose = cameraService.subscribe(update)
  return pill
}

/** A photo thumbnail that loads lazily (only when scrolled into view). */
export function thumb(p: Photo, onClick?: () => void): HTMLElement {
  const img = h('img', { alt: p.fileName, loading: 'lazy', decoding: 'async', width: p.thumbW, height: p.thumbH })
  void thumbUrl(p).then(url => { if (url) img.src = url })
  return h('button', { class: 'thumb', onclick: onClick, 'aria-label': p.fileName },
    img,
    p.recipe ? h('span', { class: 'badge label' }, t('lib.edited')) : null,
  )
}

/**
 * "Import RAF" button: opens the Android file picker (files app / SD card),
 * imports all selected files, then opens the editor if it was just one.
 */
export function importButton(kind: 'primary' | 'ghost' | 'icon' = 'primary'): HTMLElement {
  // No `accept` filter on purpose: Android often greys out .RAF files when one is set.
  const input = h('input', { type: 'file', multiple: true, hidden: true }) as HTMLInputElement
  const label = h('span', null, t('import.button'))
  // 'icon' = small round "+" button for crowded headers
  const btn = kind === 'icon'
    ? h('button', { class: 'icon-btn outlined', 'aria-label': t('import.button'), html: icons.plus, onclick: () => input.click() })
    : h('button', { class: `btn${kind === 'ghost' ? ' ghost' : ''}`, onclick: () => input.click() }, h('span', { html: icons.plus }), label)

  input.addEventListener('change', async () => {
    const files = Array.from(input.files ?? [])
    input.value = '' // allow picking the same file again later
    if (!files.length) return
    btn.setAttribute('disabled', '')
    const results = await importFiles(files, (done, total) => {
      label.textContent = t('import.progress', { done, total })
      if (kind === 'icon') toast(t('import.progress', { done, total }), 'info', 60_000)
    })
    label.textContent = t('import.button')
    btn.removeAttribute('disabled')

    const ok = results.filter(r => r.ok)
    const failed = results.length - ok.length
    if (failed) toast(t('import.failed', { n: failed }), 'error')
    else toast(t('import.done', { n: ok.length }))
    if (ok.length === 1 && ok[0].ok) navigate(`edit/${ok[0].photo.id}`)
  })
  return h('span', null, btn, input)
}
