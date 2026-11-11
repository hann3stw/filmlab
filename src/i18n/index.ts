/**
 * Tiny translation system (German / English).
 *
 * Every text in the UI is looked up by a key:   t('nav.home')  →  "Start" / "Home"
 * Texts can contain placeholders:               t('lib.count', { n: 3 })
 * The chosen language is remembered in localStorage.
 *
 * Why not a library? This is ~60 lines and easy to understand.
 */

import { de } from './de.ts'
import { en } from './en.ts'

export type Lang = 'de' | 'en'
export type Dict = Record<keyof typeof en, string>

const DICTS: Record<Lang, Dict> = { de, en }
const STORAGE_KEY = 'filmlab.lang'

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'de' || saved === 'en') return saved
  } catch { /* storage blocked — fall through */ }
  // First start: follow the phone's language.
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en'
}

let current: Lang = detectLang()
const listeners = new Set<() => void>()

export function getLang(): Lang {
  return current
}

/** Switch language; every registered listener re-renders its UI. */
export function setLang(lang: Lang): void {
  current = lang
  try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
  document.documentElement.lang = lang
  listeners.forEach(fn => fn())
}

/** Call `fn` whenever the language changes. Returns an "unsubscribe" function. */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Translate a key, filling in {placeholders}. */
export function t(key: keyof Dict, vars?: Record<string, string | number>): string {
  let s = DICTS[current][key] ?? DICTS.en[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

document.documentElement.lang = current
