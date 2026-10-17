// Airport map with gates, restrooms, food, lounges and your position.

import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { lookupAirport } from "@/lib/airports";
import { fetchAirportPois } from "@/lib/airport/fetch";
import type { AirportPoi } from "@/lib/airport/pois";
import { AirportMapClient } from "@/components/AirportMapClient";
import { Loading } from "@/components/Loading";
import { LinkIcon } from "@/components/icons";

const action = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

async function Airport({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ gate?: string }> }) {
  const [{ code: raw }, { gate }] = await Promise.all([params, searchParams]);
  await requireUser();
  const code = raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  const airport = lookupAirport(code);
  let pois: AirportPoi[] = [];
  let failed = false;
  try {
    pois = await fetchAirportPois(code);
  } catch {
    failed = true;
  }
  const center = airport
    ? { lat: airport.lat, lng: airport.lng }
    : pois.length
      ? { lat: pois.reduce((s, p) => s + p.lat, 0) / pois.length, lng: pois.reduce((s, p) => s + p.lng, 0) / pois.length }
      : null;
  const name = airport ? `${airport.name}` : code;
  const appleMaps = `https://maps.apple.com/?q=${encodeURIComponent(`${name} Airport`)}${airport ? `&ll=${airport.lat},${airport.lng}&z=17` : ""}`;
  const googleMaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} Airport`)}`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">
        {code} · {name}
      </h1>
      {center && pois.length ? (
        <AirportMapClient pois={pois} center={center} initialGate={gate} />
      ) : (
        <p className="rounded-2xl border-2 border-dashed border-ink bg-paper p-4">
          {failed ? "The map data service did not answer. Try again in a moment, or" : "No indoor map data for this airport yet;"} use Apple
          Maps or Google Maps below.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <a href={appleMaps} className={action} target="_blank" rel="noreferrer">
          <LinkIcon size={18} /> Apple Maps indoor map
        </a>
        <a href={googleMaps} className={action} target="_blank" rel="noreferrer">
          <LinkIcon size={18} /> Google Maps indoor map
        </a>
      </div>
      <p className="text-sm text-muted">
        Map data © OpenStreetMap contributors. Gates and amenities are community-mapped and may be incomplete; signage at
        the airport wins. Google Maps and Apple Maps show floor plans with levels for many large airports.
      </p>
      <Link href="/airports" className="inline-flex min-h-12 items-center font-semibold underline">
        ← Other airports
      </Link>
    </div>
  );
}

export default function AirportPage({ params, searchParams }: PageProps<"/airports/[code]">) {
  return (
    <Suspense fallback={<Loading label="Loading the airport map…" />}>
      <Airport params={params} searchParams={searchParams as Promise<{ gate?: string }>} />
    </Suspense>
  );
}
