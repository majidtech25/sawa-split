// Sawa Split's service worker (SCOPE_V2 MUST 20): makes the app installable and keeps
// the screens loading on a bad connection. It never touches money: the API and Supabase
// are on other origins, so they never pass through here, and nothing but same-origin
// GETs is ever handled. Payments and balances always come from the network.
//
// Hand-written on purpose (no plugin). Change CACHE whenever this file changes, so the
// new worker clears the old cache on activate.
const CACHE = "sawa-v2"

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline · Sawa Split</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FAFAF8;
color:#1A1A1A;font-family:system-ui,sans-serif;text-align:center;padding:24px}p{max-width:320px;line-height:1.5}</style>
</head><body><main><img src="/logo.svg" alt="" width="56" height="56"><h1>You're offline.</h1>
<p>Payments and balances need a connection. Reconnect and try again.</p></main></body></html>`

self.addEventListener("install", () => self.skipWaiting())

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

// Hashed build files and the app's icons: they never change under the same URL.
function isStatic(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    /^\/(logo\.svg|favicon-32\.png|apple-touch-icon\.png|icon-[\w-]+\.png|manifest\.webmanifest)$/.test(url.pathname)
  )
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  // Only same-origin GETs. Everything else (the API, Supabase, fonts, any POST) goes
  // straight to the network: no respondWith, no cache.
  if (request.method !== "GET" || url.origin !== self.location.origin) return

  if (request.mode === "navigate") {
    // Network first; the last good copy of the app only when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put("/", copy))
          }
          return response
        })
        .catch(() =>
          caches
            .match("/")
            .then((cached) => cached || new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } })),
        ),
    )
    return
  }

  if (isStatic(url)) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              if (response.ok) cache.put(request, response.clone())
              return response
            }),
        ),
      ),
    )
  }
  // Any other same-origin GET: the browser handles it as usual.
})
