// Flight map: follow the plane before it reaches you, in the air, and after landing.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { userTimezone } from "@/lib/config";
import { segmentTitle } from "@/lib/present";
import type { Segment } from "@/lib/types";
import { FlightTracker } from "@/components/FlightTracker";
import { Loading } from "@/components/Loading";

async function Flight({ params }: { params: Promise<{ id: string; segmentId: string }> }) {
  const { id, segmentId } = await params;
  const { db } = await requireUser();
  const { data } = await db.from("segments").select("*").eq("id", segmentId).maybeSingle();
  const segment = data as Segment | null;
  if (!segment || segment.type !== "flight") notFound();
  return (
    <>
      <Link href={`/trips/${id}`} className="inline-flex min-h-12 items-center font-semibold underline">
        ← Back to trip
      </Link>
      <h1 className="mb-4 text-2xl font-bold">{segmentTitle(segment)}</h1>
      <FlightTracker segmentId={segment.id} homeTz={userTimezone()} />
    </>
  );
}

export default function FlightPage({ params }: PageProps<"/trips/[id]/flight/[segmentId]">) {
  return (
    <Suspense fallback={<Loading label="Loading flight…" />}>
      <Flight params={params} />
    </Suspense>
  );
}
