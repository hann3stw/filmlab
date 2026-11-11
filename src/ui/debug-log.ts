/**
 * On-screen debug log.
 *
 * On a phone you usually can't open Chrome DevTools, so every important step
 * (USB commands, errors, timings) is written into a box ON the page. You can
 * copy or share the whole log, e.g. to paste it into a chat or GitHub issue.
 *
 * Usage:
 *   import { log } from './ui/debug-log.ts'
 *   log('Hello')              // normal line
 *   log('Oops', 'error')      // red line
 */

export type LogLevel = 'info' | 'ok' | 'warn' | 'error'

interface LogLine {
  time: number   // ms since page load (performance.now)
  level: LogLevel
  text: string
}

const MAX_LINES = 3000 // keep memory bounded; oldest lines are dropped
const lines: LogLine[] = []
let listEl: HTMLElement | null = null

/** Format milliseconds since page load as "  12.345 s" */
function stamp(ms: number): string {
  return (ms / 1000).toFixed(3).padStart(8, ' ')
}

/** Add one line to the log (and to the browser console, for desktop debugging). */
export function log(text: string, level: LogLevel = 'info'): void {
  const line: LogLine = { time: performance.now(), level, text }
  lines.push(line)
  if (lines.length > MAX_LINES) lines.shift()

  // Also mirror to the real console (visible when the phone is attached to a PC).
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn.call(console, `[FilmLab] ${text}`)

  if (listEl) appendLineEl(line)
}

function appendLineEl(line: LogLine): void {
  if (!listEl) return
  // Only auto-scroll if the user is already at the bottom (so reading old
  // lines isn't interrupted by new ones arriving).
  const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40

  const row = document.createElement('div')
  row.className = `log-line ${line.level}`
  row.textContent = `${stamp(line.time)}  ${line.text}`
  listEl.appendChild(row)
  while (listEl.childElementCount > MAX_LINES) listEl.firstElementChild?.remove()

  if (atBottom) listEl.scrollTop = listEl.scrollHeight
}

/** The whole log as plain text (for copy/share). */
export function logAsText(): string {
  const header = [
    `FilmLab ${__APP_VERSION__} debug log`,
    `Date: ${new Date().toISOString()}`,
    `UA: ${navigator.userAgent}`,
    '',
  ]
  return header.concat(lines.map(l => `${stamp(l.time)} [${l.level}] ${l.text}`)).join('\n')
}

/** Copy text to the clipboard, with a fallback for older WebViews. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback: put the text in a hidden textarea and use execCommand.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/**
 * Build the debug log panel and return its root element.
 * Also installs global error handlers so crashes show up in the log.
 */
export function createDebugPanel(): HTMLElement {
  const root = document.createElement('section')
  root.className = 'card debug'
  root.innerHTML = `
    <div class="card-head">
      <h2>Debug log</h2>
      <span class="label">on-screen · no DevTools needed</span>
    </div>
    <div class="log-list" role="log" aria-live="polite"></div>
    <div class="row wrap">
      <button class="btn small ghost" data-act="copy">Copy</button>
      <button class="btn small ghost" data-act="share">Share</button>
      <button class="btn small ghost" data-act="clear">Clear</button>
    </div>
  `
  listEl = root.querySelector('.log-list')!
  for (const l of lines) appendLineEl(l) // show lines logged before the panel existed

  root.querySelector('[data-act="copy"]')!.addEventListener('click', async () => {
    const ok = await copyText(logAsText())
    log(ok ? 'Log copied to clipboard' : 'Copy failed', ok ? 'ok' : 'warn')
  })
  root.querySelector('[data-act="share"]')!.addEventListener('click', async () => {
    try {
      // Web Share API: opens Android's share sheet (WhatsApp, Mail, …)
      await navigator.share({ title: 'FilmLab debug log', text: logAsText() })
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') log(`Share failed: ${err}`, 'warn')
    }
  })
  root.querySelector('[data-act="clear"]')!.addEventListener('click', () => {
    lines.length = 0
    listEl!.innerHTML = ''
  })

  return root
}

/** Catch uncaught errors anywhere on the page and log them. */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', e => {
    log(`Uncaught error: ${e.message} (${e.filename}:${e.lineno})`, 'error')
  })
  window.addEventListener('unhandledrejection', e => {
    log(`Unhandled promise rejection: ${e.reason}`, 'error')
  })
}
