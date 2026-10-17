"use client";

// Offline support on the page side: ask the service worker to save the
// trips and passes, say when the phone has no connection, and wipe the saved
// copies when signed out.

import { useEffect, useSyncExternalStore } from "react";

const WARM_KEY = "atlas-offline-warm";
const WARM_EVERY_MS = 30 * 60_000;

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <p role="status" className="mb-3 rounded-2xl border-2 border-dashed border-ink bg-paper px-4 py-3 font-semibold">
      Offline. You are seeing the copy saved on this phone; changes and Atlas need a connection.
    </p>
  );
}

/** Saves the given pages and files for offline use, at most every 30 minutes for the same list. */
export function OfflineWarmup({ urls }: { urls: string[] }) {
  const list = urls.join("\n");
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !navigator.onLine) return;
    try {
      const last = JSON.parse(sessionStorage.getItem(WARM_KEY) ?? "null") as { list: string; at: number } | null;
      if (last && last.list === list && Date.now() - last.at < WARM_EVERY_MS) return;
    } catch {
      // Storage blocked: warm anyway.
    }
    navigator.serviceWorker.ready
      .then((reg) => {
        reg.active?.postMessage({ type: "warm", urls: list.split("\n") });
        try {
          sessionStorage.setItem(WARM_KEY, JSON.stringify({ list, at: Date.now() }));
        } catch {
          // Ignore.
        }
      })
      .catch(() => {});
  }, [list]);
  return null;
}

/** On the sign-in page: delete every saved copy so the next person sees nothing. */
export function ClearOfflineCopies() {
  useEffect(() => {
    try {
      sessionStorage.removeItem(WARM_KEY);
    } catch {
      // Ignore.
    }
    if (!("caches" in window)) return;
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("atlas-")).map((k) => caches.delete(k))))
      .catch(() => {});
  }, []);
  return null;
}
