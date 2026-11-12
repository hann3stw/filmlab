/**
 * Back-stack: makes Android's "back" gesture close overlays one at a time.
 *
 * Every overlay (sheet, viewer, selection mode, full screen) registers here.
 * We add a dummy browser-history entry for it; when the user goes "back",
 * only the TOP overlay is closed — even if several are stacked (e.g. a
 * "new album" prompt on top of the album list on top of the viewer).
 *
 * Tricky part: history.back() is ASYNCHRONOUS — the browser finishes it a
 * moment later. If we called pushState() in between (closing one sheet and
 * immediately opening the next), the two would overtake each other and the
 * history would end up one entry short. So all history operations go through
 * a queue and run strictly one after another.
 */

const stack: (() => void)[] = []
/** Number of popstate events caused by our own history.back() calls */
let ownBacks = 0
let onOwnBack: (() => void) | null = null
/** The queue: each history operation waits for the previous one */
let queue: Promise<void> = Promise.resolve()

window.addEventListener('popstate', () => {
  if (ownBacks > 0) {
    // Triggered by our own code (an overlay closed by a button) — nothing to close.
    ownBacks--
    onOwnBack?.()
    return
  }
  stack.pop()?.() // the user pressed back → close the top overlay
})

function queuedPush(): void {
  queue = queue.then(() => { history.pushState({ overlay: true }, '') })
}

function queuedBack(): Promise<void> {
  queue = queue.then(() => new Promise<void>(resolve => {
    ownBacks++
    // Safety net: if the browser never reports the back (very rare), go on anyway.
    const timer = setTimeout(() => { ownBacks = Math.max(0, ownBacks - 1); onOwnBack = null; resolve() }, 500)
    onOwnBack = () => { clearTimeout(timer); onOwnBack = null; resolve() }
    history.back()
  }))
  return queue
}

/**
 * Register an overlay. `onBack` runs when the user presses back while this
 * overlay is on top. Returns `release()`: call it when the overlay is closed
 * by other means (button, tap outside) — it removes the history entry and
 * resolves once the browser has finished going back.
 */
export function pushBack(onBack: () => void): () => Promise<void> {
  stack.push(onBack)
  queuedPush()
  let released = false
  return () => {
    if (released) return Promise.resolve()
    released = true
    const i = stack.lastIndexOf(onBack)
    if (i < 0) return Promise.resolve() // already closed via back
    stack.splice(i, 1)
    return queuedBack()
  }
}
