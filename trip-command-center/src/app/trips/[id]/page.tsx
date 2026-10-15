// Screen 2: trip timeline, day by day (spec section 6).

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getTrip } from "@/lib/data";
import { userTimezone } from "@/lib/config";
import { buildTimeline } from "@/lib/timeline";
import { formatMonthDay } from "@/lib/time";
import { SegmentCard } from "@/components/SegmentCard";
import { TripActions } from "@/components/TripActions";
import { Loading } from "@/components/Loading";
import { ClockIcon } from "@/components/icons";

async function Timeline({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requireUser();
  const result = await getTrip(db, id);
  if (!result) notFound();
  const { trip, segments } = result;
  const { data: others } = await db.from("trips").select("id, title").neq("id", id).order("start_at");
  const homeTz = userTimezone();
  const { days, unscheduled } = buildTimeline(segments);
  const startTz = segments.find((s) => s.start_tz)?.start_tz ?? homeTz;
  const endTz = [...segments].reverse().find((s) => s.end_tz ?? s.start_tz);
  const lastTz = endTz?.end_tz ?? endTz?.start_tz ?? homeTz;

  return (
    <>
      <Link href="/" className="inline-flex min-h-12 items-center font-semibold underline">
        ← All trips
      </Link>
      <h1 className="text-3xl font-bold">{trip.title}</h1>
      <p className="mb-4 text-muted">
        {trip.start_at ? formatMonthDay(trip.start_at, startTz) : "Dates not set"}
        {trip.end_at ? ` to ${formatMonthDay(trip.end_at, lastTz)}` : ""} · {segments.length}{" "}
        {segments.length === 1 ? "booking" : "bookings"}
      </p>

      <ol className="space-y-6">
        {days.map((day) => (
          <li key={day.dateKey}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold">{day.label}</h2>
              <Link
                href={`/trips/${trip.id}/brief/${day.dateKey}`}
                className="inline-flex min-h-12 items-center gap-1.5 rounded-xl px-2 font-semibold underline"
              >
                <ClockIcon size={18} /> Day brief
              </Link>
            </div>
            <ul className="space-y-3">
              {day.entries.map((e) => (
                <li key={e.key}>
                  <SegmentCard
                    segment={e.segment}
                    kind={e.kind}
                    at={e.at}
                    tz={e.tz}
                    homeTz={homeTz}
                    tripId={trip.id}
                  />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {unscheduled.length ? (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-bold">Not yet scheduled</h2>
          <ul className="space-y-3">
            {unscheduled.map((s) => (
              <li key={s.id}>
                <SegmentCard segment={s} homeTz={homeTz} tripId={trip.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-8">
        <TripActions tripId={trip.id} title={trip.title} otherTrips={(others ?? []) as { id: string; title: string }[]} />
      </div>
    </>
  );
}

export default function TripPage({ params }: PageProps<"/trips/[id]">) {
  return (
    <Suspense fallback={<Loading label="Loading trip…" />}>
      <Timeline params={params} />
    </Suspense>
  );
}
