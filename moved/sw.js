// Replacement service worker for the OLD address. Installed devices fetch this
// on their next visit: it deletes the cached old app, unregisters itself and
// sends open pages to the new address.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k)
    await self.registration.unregister()
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate('https://filmlab-app.github.io/')
  })())
})
