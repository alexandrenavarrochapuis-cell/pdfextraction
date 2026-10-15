"use client";

// Follows one flight: the inbound aircraft before boarding, the plane in the
// air, and the arrival after landing. Refreshes every 2 minutes while visible.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { TrackView } from "@/lib/flight/view";
import type { FlightPhase } from "@/lib/flight/track";
import { TimePair } from "./TimePair";
import { CheckIcon, ClockIcon, LinkIcon, PlaneIcon, XIcon } from "./icons";

const FlightMap = dynamic(() => import("./FlightMap"), {
  ssr: false,
  loading: () => <div className="h-[55vh] min-h-80 rounded-2xl border border-line bg-paper" />,
});

const REFRESH_MS = 120_000;

const PHASE: Record<FlightPhase, { label: string; Icon: typeof PlaneIcon }> = {
  scheduled: { label: "Scheduled", Icon: ClockIcon },
  boarding: { label: "Boarding soon", Icon: ClockIcon },
  en_route: { label: "In the air", Icon: PlaneIcon },
  landed: { label: "Landed", Icon: CheckIcon },
  cancelled: { label: "Cancelled", Icon: XIcon },
};

const card = "rounded-2xl border border-line bg-paper p-4 space-y-2";
const action = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

function minutesAgo(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return m === 0 ? "just now" : m === 1 ? "1 minute ago" : `${m} minutes ago`;
}

/** Best known time with a word saying which kind it is. */
function bestTime(t: { scheduled: string | null; estimated: string | null; actual: string | null } | undefined, fallback: string) {
  if (t?.actual) return { at: t.actual, kind: "Actual" };
  if (t?.estimated) return { at: t.estimated, kind: "Estimated" };
  return { at: t?.scheduled ?? fallback, kind: "Scheduled" };
}

function delayText(t: { scheduled: string | null; estimated: string | null; actual: string | null } | undefined): string | null {
  const best = t?.actual ?? t?.estimated;
  if (!t?.scheduled || !best) return null;
  const mins = Math.round((Date.parse(best) - Date.parse(t.scheduled)) / 60_000);
  if (Math.abs(mins) < 5) return "On time";
  return mins > 0 ? `${mins} min late` : `${-mins} min early`;
}

export function FlightTracker({ segmentId, homeTz }: { segmentId: string; homeTz: string }) {
  const [view, setView] = useState<TrackView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/flights/${segmentId}/track`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setView(data as TrackView);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the flight");
    }
    setNow(Date.now());
  }, [segmentId]);

  useEffect(() => {
    // Polling only while the screen is visible keeps live-data costs down.
    const first = setTimeout(load, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  if (error && !view) {
    return (
      <p role="alert" className="font-semibold">
        Error: {error}
      </p>
    );
  }
  if (!view) return <p className="py-10 text-center text-muted">Loading flight…</p>;

  const { label, Icon } = PHASE[view.phase];
  const dep = bestTime(view.live?.departure, view.depart_at);
  const arr = bestTime(view.live?.arrival, view.arrive_at);
  const pct = Math.round(view.progress * 100);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-paper px-3 py-1 text-lg font-bold">
          <Icon size={20} /> {label}
        </span>
        {view.live?.status ? <span className="font-semibold">{view.live.status}</span> : null}
      </div>

      {view.phase === "en_route" ? (
        <div>
          <div className="h-4 w-full overflow-hidden rounded-full border-2 border-ink bg-paper" aria-hidden="true">
            <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 font-semibold">{pct}% of the way</p>
        </div>
      ) : null}

      <FlightMap view={view} />

      <p className="text-sm text-muted">
        {view.plane?.source === "live"
          ? `Live position from FlightAware, ${minutesAgo(view.plane.at, now) ?? "time unknown"}.`
          : view.plane
            ? "Plane position estimated from the schedule."
            : "The plane appears on the map once it departs."}{" "}
        Updated {minutesAgo(view.refreshed_at, now)}.
        {!view.live_configured ? " Add a FlightAware AeroAPI key for live position and the inbound aircraft." : ""}
      </p>

      {view.inbound ? (
        <section className={card}>
          <h2 className="text-lg font-bold">Your plane before it reaches you</h2>
          <p>
            The aircraft for this flight is coming in as <strong>{view.inbound.ident}</strong>
            {view.inbound.origin ? ` from ${view.inbound.origin.label}` : ""}.
          </p>
          {view.inbound.status ? <p className="font-semibold">{view.inbound.status}</p> : null}
          {(() => {
            const ib = bestTime(view.inbound!.arrival, view.depart_at);
            const delay = delayText(view.inbound!.arrival);
            return (
              <div>
                <p className="text-sm font-semibold uppercase text-muted">{ib.kind} arrival at {view.origin.code}</p>
                <TimePair at={ib.at} tz={view.depart_tz} homeTz={homeTz} size="md" />
                {delay ? <p className="font-semibold">{delay}</p> : null}
              </div>
            );
          })()}
        </section>
      ) : null}

      <section className={card}>
        <h2 className="text-lg font-bold">{view.title}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase text-muted">
              {dep.kind} departure, {view.origin.label}
            </p>
            <TimePair at={dep.at} tz={view.depart_tz} homeTz={homeTz} />
            {delayText(view.live?.departure) ? <p className="font-semibold">{delayText(view.live?.departure)}</p> : null}
            {view.live?.terminal_origin || view.live?.gate_origin ? (
              <p>
                {view.live.terminal_origin ? `Terminal ${view.live.terminal_origin}` : ""}
                {view.live.terminal_origin && view.live.gate_origin ? ", " : ""}
                {view.live.gate_origin ? `Gate ${view.live.gate_origin}` : ""}
              </p>
            ) : null}
            {view.origin.code ? (
              <a
                href={`/airports/${view.origin.code}${view.live?.gate_origin ? `?gate=${encodeURIComponent(view.live.gate_origin)}` : ""}`}
                className={action}
              >
                {view.live?.gate_origin ? `Find gate ${view.live.gate_origin}` : `${view.origin.code} airport map`}
              </a>
            ) : null}
          </div>
          <div>
            <p className="text-sm font-semibold uppercase text-muted">
              {arr.kind} arrival, {view.destination.label}
            </p>
            <TimePair at={arr.at} tz={view.arrive_tz} homeTz={homeTz} />
            {delayText(view.live?.arrival) ? <p className="font-semibold">{delayText(view.live?.arrival)}</p> : null}
            {view.live?.terminal_destination || view.live?.gate_destination ? (
              <p>
                {view.live.terminal_destination ? `Terminal ${view.live.terminal_destination}` : ""}
                {view.live.terminal_destination && view.live.gate_destination ? ", " : ""}
                {view.live.gate_destination ? `Gate ${view.live.gate_destination}` : ""}
              </p>
            ) : null}
            {view.live?.baggage_claim ? <p>Baggage claim {view.live.baggage_claim}</p> : null}
            {view.destination.code ? (
              <a
                href={`/airports/${view.destination.code}${view.live?.gate_destination ? `?gate=${encodeURIComponent(view.live.gate_destination)}` : ""}`}
                className={action}
              >
                {view.destination.code} airport map
              </a>
            ) : null}
          </div>
        </div>
        {view.plane?.source === "live" && (view.plane.altitude_ft || view.plane.groundspeed_kt) ? (
          <p>
            {view.plane.altitude_ft ? `${view.plane.altitude_ft.toLocaleString("en-US")} ft` : ""}
            {view.plane.altitude_ft && view.plane.groundspeed_kt ? " · " : ""}
            {view.plane.groundspeed_kt ? `${Math.round(view.plane.groundspeed_kt * 1.15078)} mph` : ""}
          </p>
        ) : null}
        {view.live?.aircraft_type ? (
          <p className="text-muted">
            Aircraft {view.live.aircraft_type}
            {view.live.registration ? ` (${view.live.registration})` : ""}
          </p>
        ) : null}
      </section>

      {view.links ? (
        <div className="flex flex-wrap gap-2">
          <a href={view.links.flightaware} className={action} target="_blank" rel="noreferrer">
            <LinkIcon size={18} /> FlightAware
          </a>
          <a href={view.links.flightradar24} className={action} target="_blank" rel="noreferrer">
            <LinkIcon size={18} /> Flightradar24
          </a>
        </div>
      ) : null}
    </div>
  );
}
