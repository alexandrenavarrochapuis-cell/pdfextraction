// Service worker: web push for the day-before brief, and offline copies of
// the trips and boarding passes for travel without a connection.
//
// - App code (/_next/static, content-hashed): from the cache once saved.
// - Pages: from the network, falling back to the saved copy when offline or
//   when the network takes more than a few seconds and a copy exists.
// - Boarding pass files: from the network, falling back to the saved copy.
// - Nothing else is cached: no API calls (Atlas, uploads, ingest), no sign-in
//   pages, no POSTs. The sign-in page deletes every saved copy.
// The Trips screen asks for its trips and passes to be saved ("warm").

const PAGES = "atlas-pages-v1";
const STATIC = "atlas-static-v1";
const KEEP = [PAGES, STATIC];
const SLOW_NETWORK_MS = 4000;
const MAX_STATIC = 400;
const NEVER = /^\/(api|auth|login)(\/|$)/;
const PASS_FILE = /^\/api\/passes\/[^/]+\/file$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("atlas-") && !KEEP.includes(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  ),
);

function savable(res) {
  return res && res.ok && !res.redirected && res.type === "basic";
}

async function trimStatic() {
  const cache = await caches.open(STATIC);
  const keys = await cache.keys();
  // Oldest first: drop what earlier deploys left behind.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_STATIC)).map((k) => cache.delete(k)));
}

async function fromCacheFirst(request) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (savable(res)) {
    const cache = await caches.open(STATIC);
    await cache.put(request, res.clone());
  }
  return res;
}

async function savedCopy(request) {
  return (
    (await caches.match(request, { ignoreVary: true })) ||
    (await caches.match(request, { ignoreVary: true, ignoreSearch: true }))
  );
}

function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas offline</title>
<style>body{font-family:system-ui,sans-serif;background:#f3f5f9;color:#14161b;margin:0;padding:24px}main{max-width:32rem;margin:10vh auto;background:#fff;border-radius:24px;padding:24px}a{display:inline-block;margin-top:12px;padding:12px 20px;border-radius:12px;background:#2047c4;color:#fff;font-weight:700;text-decoration:none}</style></head>
<body><main><h1>You are offline</h1><p>This page was not saved on this phone. Your trips and boarding passes are saved each time you open Atlas with a connection.</p><a href="/">Open my trips</a></main></body></html>`;
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
}

async function page(event) {
  const request = event.request;
  const network = fetch(request).then(async (res) => {
    if (savable(res)) {
      const cache = await caches.open(PAGES);
      await cache.put(request, res.clone());
    }
    return res;
  });
  event.waitUntil(network.catch(() => {}));
  const slow = new Promise((resolve) => setTimeout(resolve, SLOW_NETWORK_MS, "slow"));
  try {
    const first = await Promise.race([network, slow]);
    if (first !== "slow") return first;
    const copy = await savedCopy(request);
    return copy || (await network);
  } catch {
    return (await savedCopy(request)) || offlinePage();
  }
}

async function passFile(request) {
  try {
    const res = await fetch(request);
    if (savable(res)) {
      const cache = await caches.open(PAGES);
      await cache.put(request, res.clone());
    }
    return res;
  } catch {
    return (await caches.match(request, { ignoreVary: true })) || new Response("Offline", { status: 503 });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(fromCacheFirst(request));
  } else if (PASS_FILE.test(url.pathname)) {
    event.respondWith(passFile(request));
  } else if (request.mode === "navigate" && !NEVER.test(url.pathname)) {
    event.respondWith(page(event));
  }
});

// Save pages and files for offline use, with the app code each page loads.
async function warm(urls) {
  const pages = await caches.open(PAGES);
  const assets = new Set();
  for (const u of urls.slice(0, 60)) {
    const url = new URL(u, self.location.origin);
    if (url.origin !== self.location.origin) continue;
    const isPage = !url.pathname.startsWith("/api/");
    if (isPage && NEVER.test(url.pathname)) continue;
    if (!isPage && !PASS_FILE.test(url.pathname)) continue;
    try {
      const res = await fetch(url.href, { credentials: "same-origin" });
      if (!savable(res)) continue;
      if (isPage) {
        const text = await res.clone().text();
        for (const asset of text.match(/\/_next\/static\/[^"'\\\s)]+/g) || []) assets.add(asset);
      }
      await pages.put(url.href, res);
    } catch {
      // Offline or failed: keep the copy saved earlier.
    }
  }
  const statics = await caches.open(STATIC);
  for (const asset of assets) {
    if (await statics.match(asset)) continue;
    try {
      const res = await fetch(asset);
      if (savable(res)) await statics.put(asset, res);
    } catch {
      // Ignore.
    }
  }
  await trimStatic();
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "warm" && Array.isArray(data.urls)) event.waitUntil(warm(data.urls));
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Trip brief", body: event.data.text(), url: "/" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Trip brief", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
      tag: data.url || "brief",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
