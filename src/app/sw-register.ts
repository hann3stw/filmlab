/**
 * Registers the service worker (offline support) and tells the user when a
 * new version of the app has been installed in the background.
 */

import { toast } from '../ui/dom.ts'
import { t } from '../i18n/index.ts'
import { log } from '../ui/debug-log.ts'

export function registerServiceWorker(): void {
  // Only in the built app — during development (npm run dev) caching would
  // just get in the way.
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return

  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new version took over. Only announce it if there was an old one.
    if (hadController) toast(t('app.updated'), 'info', 8000)
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(
      reg => {
        log('Service worker registered (offline ready)')
        // Check for updates whenever the app comes back to the foreground.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => {})
        })
      },
      err => log(`Service worker registration failed: ${err}`, 'warn'),
    )
  })
}
