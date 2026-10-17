"use client";

// Push notifications for the brief. On iPhone, web push works only once the
// app is added to the Home Screen (iOS 16.4+), and permission must be asked
// from a tap, so this is a button rather than an automatic prompt.

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "loading" | "unsupported" | "needs-install" | "off" | "on" | "denied";

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState(ios && !standalone ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    if (!vapidPublicKey) return setError("Push keys are not configured on the server.");
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("Could not save the subscription");
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn on notifications");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  const button = "min-h-14 w-full rounded-xl px-4 text-lg font-bold disabled:opacity-60";
  return (
    <div className="space-y-3">
      {state === "needs-install" ? (
        <p>
          To get the brief as a notification on iPhone, add this app to the Home Screen first: tap{" "}
          <strong>Share</strong>, then <strong>Add to Home Screen</strong>, then open it from there.
        </p>
      ) : null}
      {state === "unsupported" ? <p>This browser does not support push notifications.</p> : null}
      {state === "denied" ? (
        <p>Notifications are blocked for this app. Allow them in the device settings, then come back.</p>
      ) : null}
      {state === "on" ? (
        <>
          <p className="font-semibold">On for this device.</p>
          <button className={`${button} border-2 border-ink bg-paper`} onClick={turnOff} disabled={busy}>
            Turn off on this device
          </button>
        </>
      ) : null}
      {state === "off" ? (
        <>
          <p className="font-semibold">Off for this device.</p>
          <button className={`${button} bg-accent text-white`} onClick={turnOn} disabled={busy}>
            Turn on notifications
          </button>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="font-semibold">
          Error: {error}
        </p>
      ) : null}
    </div>
  );
}
