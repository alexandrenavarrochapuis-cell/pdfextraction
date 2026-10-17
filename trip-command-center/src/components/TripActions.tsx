"use client";

// Manual trip fixes (spec section 4): rename, merge, split.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const button = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";
const primary = "inline-flex min-h-12 items-center rounded-xl bg-accent px-5 font-bold text-white disabled:opacity-60";
const input = "min-h-12 w-full rounded-xl border-2 border-line bg-paper px-3";

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${res.status})`;
}

export function TripActions({
  tripId,
  title,
  otherTrips,
}: {
  tripId: string;
  title: string;
  otherTrips: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(title);
  const [other, setOther] = useState("");

  const run = (fn: () => Promise<string | null>, after?: () => void) =>
    start(async () => {
      const err = await fn();
      setError(err);
      if (!err) {
        after?.();
        router.refresh();
      }
    });

  return (
    <details className="rounded-2xl border border-line bg-paper">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">Edit trip</summary>
      <div className="space-y-5 border-t border-line p-4">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => send(`/api/trips/${tripId}`, "PATCH", { title: name }));
          }}
        >
          <label className="block font-semibold" htmlFor="trip-title">
            Trip name
          </label>
          <input id="trip-title" className={input} value={name} onChange={(e) => setName(e.target.value)} />
          <button className={primary} disabled={pending}>
            Rename
          </button>
        </form>

        {otherTrips.length ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (other) run(() => send(`/api/trips/${tripId}/merge`, "POST", { other_trip_id: other }));
            }}
          >
            <label className="block font-semibold" htmlFor="merge-with">
              Merge another trip into this one
            </label>
            <select id="merge-with" className={input} value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="">Choose a trip</option>
              {otherTrips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <button className={primary} disabled={pending || !other}>
              Merge
            </button>
          </form>
        ) : null}
        <p className="text-sm text-muted">
          To split a trip, open the first booking of the new trip and choose “Start new trip here”.
        </p>
        {error ? (
          <p role="alert" className="font-semibold">
            Error: {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}

export function SplitButton({ tripId, segmentId }: { tripId: string; segmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={button}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await fetch(`/api/trips/${tripId}/split`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ segment_id: segmentId }),
            });
            const data = (await res.json().catch(() => ({}))) as { trip_id?: string; error?: string };
            if (!res.ok) return setError(data.error ?? "Split failed");
            router.push(`/trips/${data.trip_id}`);
          })
        }
      >
        Start new trip here
      </button>
      {error ? (
        <p role="alert" className="w-full font-semibold">
          Error: {error}
        </p>
      ) : null}
    </>
  );
}
