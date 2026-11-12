/**
 * Light / dark theme.
 *
 * 'system' follows the phone's setting; 'light' and 'dark' force one.
 * The choice is stored in localStorage and applied by setting
 * <html data-theme="light|dark"> — all colors are CSS variables (base.css),
 * so switching the attribute recolors the whole app instantly.
 */

export type ThemeChoice = 'system' | 'light' | 'dark'
const KEY = 'filmlab.theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch { /* ignore */ }
  return 'system'
}

function apply(): void {
  const choice = getTheme()
  const dark = choice === 'dark' || (choice === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  // Color of the Android status bar / app title bar
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1B1C17' : '#3B4527')
}

export function setTheme(choice: ThemeChoice): void {
  try { localStorage.setItem(KEY, choice) } catch { /* ignore */ }
  apply()
}

export function initTheme(): void {
  apply()
  media.addEventListener('change', apply) // phone switches to dark at night → follow
}
