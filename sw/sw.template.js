/*
 * FilmLab service worker — makes the app work OFFLINE and installable.
 *
 * A service worker is a script the browser runs in the background, between
 * the app and the network. This one:
 *   1. on install: downloads ALL app files into a cache ("precache")
 *   2. on every request: answers from the cache first (fast, works offline)
 *   3. page navigations: tries the network first (to get updates), falls back
 *      to the cached page when offline
 *
 * The list of files and the version are filled in by vite.config.ts at build
 * time (the __PLACEHOLDERS__ below).
 */

const VERSION = '__VERSION__'
const CACHE = 'filmlab-' + VERSION
const PRECACHE = __PRECACHE__

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      // Activate the new version right away (the app shows "update ready").
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Delete caches of older versions
    for (const key of await caches.keys()) {
      if (key.startsWith('filmlab-') && key !== CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // never touch other sites

  if (req.mode === 'navigate') {
    // Pages: network first, cache as fallback (offline)
    event.respondWith((async () => {
      try {
        return await fetch(req)
      } catch {
        const cache = await caches.open(CACHE)
        const path = url.pathname.endsWith('diagnostics.html') ? 'diagnostics.html' : 'index.html'
        return (await cache.match(path)) || (await cache.match('./')) || Response.error()
      }
    })())
    return
  }

  // Everything else (JS, CSS, fonts, icons): cache first
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true })
    if (cached) return cached
    const res = await fetch(req)
    if (res.ok && res.type === 'basic') {
      const cache = await caches.open(CACHE)
      cache.put(req, res.clone())
    }
    return res
  })())
})
