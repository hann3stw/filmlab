/**
 * "Install app": Chrome fires the `beforeinstallprompt` event when the page
 * can be installed as an app (PWA). We keep the event and trigger it later
 * from our own button. Installed = own icon, full screen, works offline.
 */

import { h, toast } from '../ui/dom.ts'
import { t } from '../i18n/index.ts'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault() // don't show Chrome's own mini-banner
  deferred = e as InstallPromptEvent
  listeners.forEach(fn => fn())
})
window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach(fn => fn()) })

/** true when FilmLab already runs as an installed app */
export function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
}

/** Section for the home screen. Returns null when already installed. */
export function installSection(): (HTMLElement & { dispose: () => void }) | null {
  if (isInstalled()) return null
  const btn = h('button', { class: 'btn' }, t('install.button'))
  const hint = h('p', { class: 'muted small' })
  const el = h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, t('install.title'))),
    h('p', { class: 'muted' }, t('install.text')),
    h('div', { class: 'row wrap', style: { marginTop: '12px' } }, btn),
    hint,
  ) as unknown as HTMLElement & { dispose: () => void }
  const update = () => {
    btn.hidden = !deferred
    // No prompt available (yet): explain the manual way via Chrome's menu
    hint.textContent = deferred ? '' : t('install.manual')
  }
  btn.addEventListener('click', async () => {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') { toast(t('install.done')); el.remove() }
    deferred = null
    update()
  })
  update()
  listeners.add(update)
  el.dispose = () => listeners.delete(update)
  return el
}
