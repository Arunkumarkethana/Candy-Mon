self.addEventListener('install', (e) => {
  self.skipWaiting()
})
self.addEventListener('activate', (e) => {
  self.clients.claim()
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  e.respondWith((async () => {
    try {
      const net = await fetch(req)
      return net
    } catch {
      return caches.match(req)
    }
  })())
})
