// The whole trip on a map: flights, drives with Tesla Superchargers, trains,
// stays and stops.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getTrip } from "@/lib/data";
import { tripMapData } from "@/lib/trips/map";
import { TripMapClient } from "@/components/TripMapClient";
import { Loading } from "@/components/Loading";

async function TripMapView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requireUser();
  const found = await getTrip(db, id);
  if (!found) notFound();
  const data = tripMapData(found.segments);
  return (
    <>
      <Link href={`/trips/${id}`} className="inline-flex min-h-12 items-center font-semibold underline">
        ← Back to trip
      </Link>
      <h1 className="text-2xl font-bold">{found.trip.title}: map</h1>
      {data.markers.length ? (
        <TripMapClient data={data} />
      ) : (
        <p className="rounded-2xl border border-line bg-paper p-4">None of this trip&rsquo;s places could be found on the map yet.</p>
      )}
      <p className="mt-2 text-sm text-muted">
        Straight lines join the places; Google Maps plans the actual roads. Map data © OpenStreetMap contributors.
      </p>
    </>
  );
}

export default function TripMapPage({ params }: PageProps<"/trips/[id]/map">) {
  return (
    <Suspense fallback={<Loading label="Loading the map…" />}>
      <TripMapView params={params} />
    </Suspense>
  );
}
