/**
 * Tiny DOM helpers so we don't need a UI framework.
 *
 *   h('button', { class: 'btn', onclick: () => … }, 'Text')
 *
 * creates <button class="btn">Text</button> with a click handler.
 */

import { pushBack } from './back-stack.ts'

type Child = Node | string | number | null | undefined | false
type Attrs = Record<string, unknown>

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue
      if (key.startsWith('on') && typeof value === 'function') {
        // onclick → addEventListener('click', …)
        el.addEventListener(key.slice(2), value as EventListener)
      } else if (key === 'class') {
        el.className = String(value)
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value)
      } else if (key === 'html') {
        el.innerHTML = String(value) // only for trusted, static markup (icons)
      } else if (value === true) {
        el.setAttribute(key, '')
      } else {
        el.setAttribute(key, String(value))
      }
    }
  }
  append(el, children)
  return el
}

function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}

/** Remove all children and add new ones. */
export function replaceChildren(el: Element, ...children: (Child | Child[])[]): void {
  el.textContent = ''
  append(el, children)
}

/** Wait `ms` after the LAST call before running `fn` (for rapid slider changes). */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wrapped = (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
  wrapped.cancel = () => clearTimeout(timer)
  return wrapped
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

// ---------------------------------------------------------------------------
// Toast — a short message at the bottom of the screen
// ---------------------------------------------------------------------------

let toastEl: HTMLElement | null = null
let toastTimer: ReturnType<typeof setTimeout> | undefined

export function toast(text: string, kind: 'info' | 'error' = 'info', ms = 3200): void {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' })
    document.body.append(toastEl)
  }
  toastEl.textContent = text
  toastEl.dataset.kind = kind
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl?.classList.remove('show'), ms)
}

// ---------------------------------------------------------------------------
// Bottom sheet — a panel that slides up from the bottom (used for pickers)
// ---------------------------------------------------------------------------

export interface Sheet {
  el: HTMLElement
  body: HTMLElement
  close(): void
}

/** Open a bottom sheet. Tapping the dimmed background or "back" closes it. */
export function openSheet(title: string, onClose?: () => void): Sheet {
  const body = h('div', { class: 'sheet-body' })
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-grip' }),
    h('div', { class: 'sheet-title label' }, title),
    body,
  )
  const backdrop = h('div', { class: 'sheet-backdrop' }, panel)
  let closed = false
  const hide = () => {
    if (closed) return
    closed = true
    backdrop.classList.remove('open')
    setTimeout(() => backdrop.remove(), 220)
    onClose?.()
  }
  // Android "back" closes the sheet (see back-stack.ts)
  const release = pushBack(hide)
  const close = () => { if (!closed) { void release(); hide() } }

  backdrop.addEventListener('click', e => { if (e.target === backdrop) close() })
  document.body.append(backdrop)
  requestAnimationFrame(() => backdrop.classList.add('open'))
  return { el: panel, body, close }
}

/** Simple yes/no confirmation in a sheet. Resolves true if confirmed. */
export function confirmSheet(title: string, text: string, okLabel: string, cancelLabel: string, danger = false): Promise<boolean> {
  return new Promise(resolve => {
    let result = false
    const s = openSheet(title, () => resolve(result))
    s.body.append(
      h('p', { class: 'sheet-text' }, text),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => s.close() }, cancelLabel),
        h('button', { class: `btn${danger ? ' danger' : ''}`, onclick: () => { result = true; s.close() } }, okLabel),
      ),
    )
  })
}

/** Ask for a short text (e.g. an album name). Resolves null if cancelled. */
export function promptSheet(title: string, placeholder: string, okLabel: string, cancelLabel: string, initial = ''): Promise<string | null> {
  return new Promise(resolve => {
    let result: string | null = null
    const s = openSheet(title, () => resolve(result))
    const input = h('input', { class: 'text-input', type: 'text', placeholder, value: initial, maxlength: 60 }) as HTMLInputElement
    const ok = () => { const v = input.value.trim(); if (v) { result = v; s.close() } }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok() })
    s.body.append(
      input,
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => s.close() }, cancelLabel),
        h('button', { class: 'btn', onclick: ok }, okLabel),
      ),
    )
    setTimeout(() => input.focus(), 250)
  })
}
