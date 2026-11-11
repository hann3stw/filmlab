/**
 * App shell: the page frame with the bottom navigation, plus a minimal
 * "hash router".
 *
 * The part of the URL after "#" decides which screen is shown:
 *   #/home   #/library   #/recipes   #/camera   #/edit/<photoId>
 * Using the hash means GitHub Pages never has to know about our screens, and
 * Android's back button / gesture works automatically (browser history).
 */

import { h, replaceChildren } from '../ui/dom.ts'
import { icons } from '../ui/icons.ts'
import { t, onLangChange, type Dict } from '../i18n/index.ts'

/** A screen: draws itself into `root` and returns a cleanup function. */
export type View = (root: HTMLElement, params: string[]) => (() => void) | void

interface Route { name: string; view: View; tab?: string; fullscreen?: boolean }

const routes = new Map<string, Route>()
let mainEl: HTMLElement
let navEl: HTMLElement
let cleanup: (() => void) | void

export function addRoute(name: string, view: View, opts: { tab?: string; fullscreen?: boolean } = {}): void {
  routes.set(name, { name, view, ...opts })
}

export function navigate(path: string, replace = false): void {
  const url = '#/' + path
  if (replace) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
  render()
}

const TABS: { name: string; label: keyof Dict; icon: string }[] = [
  { name: 'home', label: 'nav.home', icon: icons.home },
  { name: 'library', label: 'nav.library', icon: icons.library },
  { name: 'recipes', label: 'nav.recipes', icon: icons.recipes },
  { name: 'camera', label: 'nav.camera', icon: icons.camera },
]

function renderNav(active: string | undefined) {
  replaceChildren(navEl, ...TABS.map(tab =>
    h('a', {
      class: `tab${tab.name === active ? ' active' : ''}`,
      href: `#/${tab.name}`,
      'aria-current': tab.name === active ? 'page' : undefined,
    },
      h('span', { class: 'tab-icon', html: tab.icon }),
      h('span', { class: 'tab-label' }, t(tab.label)),
    ),
  ))
}

/** Show the screen that matches the current URL hash. */
function render() {
  const [name = 'home', ...params] = location.hash.replace(/^#\/?/, '').split('/')
  const route = routes.get(name) ?? routes.get('home')!

  if (cleanup) cleanup()
  document.body.classList.toggle('fullscreen-route', !!route.fullscreen)
  renderNav(route.tab ?? route.name)
  mainEl.textContent = ''
  mainEl.scrollTop = 0
  window.scrollTo(0, 0)
  cleanup = route.view(mainEl, params.map(decodeURIComponent))
}

export function startShell(root: HTMLElement): void {
  mainEl = h('main', { class: 'view', id: 'view' })
  navEl = h('nav', { class: 'tabbar', 'aria-label': 'Main' })
  root.append(mainEl, navEl)
  window.addEventListener('hashchange', render)
  onLangChange(render) // redraw everything in the new language
  render()
}
