// Road trip: stops on a map, with turn-by-turn handed to Google Maps,
// Apple Maps or Waze, or the destination sent to the car.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { userTimezone } from "@/lib/config";
import { googleDirectionsUrl, placeText, segmentTitle, wazeUrl } from "@/lib/present";
import type { Place, Segment } from "@/lib/types";
import { RouteMapClient } from "@/components/RouteMapClient";
import type { RoutePoint } from "@/components/RouteMap";
import { ShareButton } from "@/components/ShareButton";
import { TimePair } from "@/components/TimePair";
import { Loading } from "@/components/Loading";
import { MapIcon, PinIcon } from "@/components/icons";

const action = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

function point(p: Place | null, label: string, marker: string): RoutePoint | null {
  if (!p || p.lat == null || p.lng == null) return null;
  return { lat: p.lat, lng: p.lng, label, marker };
}

async function Drive({ params }: { params: Promise<{ id: string; segmentId: string }> }) {
  const { id, segmentId } = await params;
  const { db } = await requireUser();
  const { data } = await db.from("segments").select("*").eq("id", segmentId).maybeSingle();
  const seg = data as Segment | null;
  if (!seg || seg.type !== "drive" || !seg.destination) notFound();
  const stops = seg.details?.stops ?? [];
  const points = [
    point(seg.origin, seg.origin?.name ?? seg.origin?.city ?? "Start", "S"),
    ...stops.map((s, i) => point(s, s.name ?? s.city ?? `Stop ${i + 1}`, String(i + 1))),
    point(seg.destination, seg.destination.name ?? seg.destination.city ?? "Destination", "E"),
  ].filter((p): p is RoutePoint => !!p);
  const legs: { label: string; place: Place }[] = [
    ...stops.map((s, i) => ({ label: `Stop ${i + 1}${s.name ? `: ${s.name}` : ""}`, place: s })),
    { label: `Destination${seg.destination.name ? `: ${seg.destination.name}` : ""}`, place: seg.destination },
  ];

  return (
    <>
      <Link href={`/trips/${id}`} className="inline-flex min-h-12 items-center font-semibold underline">
        ← Back to trip
      </Link>
      <h1 className="text-2xl font-bold">{segmentTitle(seg)}</h1>
      {seg.details?.vehicle ? <p className="text-muted">Car: {seg.details.vehicle}</p> : null}
      {seg.start_at && seg.start_tz ? (
        <div className="my-3">
          <p className="text-sm font-semibold uppercase text-muted">Leave</p>
          <TimePair at={seg.start_at} tz={seg.start_tz} homeTz={userTimezone()} />
        </div>
      ) : null}
      <a
        href={googleDirectionsUrl(seg.origin, seg.destination, stops)}
        target="_blank"
        rel="noreferrer"
        className="mb-4 flex min-h-14 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-lg font-bold text-white"
      >
        <MapIcon /> Start GPS in Google Maps (all stops)
      </a>
      {points.length >= 2 ? (
        <RouteMapClient points={points} />
      ) : (
        <p className="rounded-2xl border border-line bg-paper p-4">Some addresses could not be found on the map.</p>
      )}
      <p className="mt-2 text-sm text-muted">Straight lines join the stops; Google Maps plans the actual roads.</p>

      <ol className="mt-4 space-y-3">
        {legs.map((leg, i) => (
          <li key={i} className="space-y-2 rounded-2xl border border-line bg-paper p-4">
            <p className="font-bold">{leg.label}</p>
            <p>{placeText(leg.place)}</p>
            <div className="flex flex-wrap gap-2">
              <a href={wazeUrl(leg.place)} className={action} target="_blank" rel="noreferrer">
                <PinIcon size={18} /> Waze
              </a>
              <ShareButton title={leg.label} text={placeText(leg.place)} label="Send to car" />
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

export default function DrivePage({ params }: PageProps<"/trips/[id]/drive/[segmentId]">) {
  return (
    <Suspense fallback={<Loading label="Loading route…" />}>
      <Drive params={params} />
    </Suspense>
  );
}
