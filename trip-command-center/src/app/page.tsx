// Screen 1: trips list. Upcoming first, then active, then past (spec section 6).

import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { countReview, listTrips, type TripCard } from "@/lib/data";
import { userTimezone } from "@/lib/config";
import { formatMonthDay } from "@/lib/time";
import { ReviewCountBadge } from "@/components/Badges";
import { AlertIcon, ChevronDownIcon } from "@/components/icons";
import { Loading } from "@/components/Loading";
import type { TripStatus } from "@/lib/types";

const GROUP_LABEL: Record<TripStatus, string> = {
  upcoming: "Upcoming",
  active: "Under way",
  past: "Past",
};

function dateRange(trip: TripCard, tz: string): string {
  if (!trip.start_at) return "Dates not set";
  const from = formatMonthDay(trip.start_at, tz);
  const to = trip.end_at ? formatMonthDay(trip.end_at, tz) : from;
  return from === to ? from : `${from} to ${to}`;
}

function TripRow({ trip, tz }: { trip: TripCard; tz: string }) {
  const allCancelled = trip.segment_count > 0 && trip.cancelled_count === trip.segment_count;
  return (
    <li>
      <Link
        href={`/trips/${trip.id}`}
        className={`block rounded-2xl bg-paper p-4 ${trip.review_count ? "border-2 border-dashed border-ink" : "border border-line"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className={`text-xl font-bold ${allCancelled ? "line-through" : ""}`}>{trip.title}</h3>
          <ChevronDownIcon className="mt-1 shrink-0 -rotate-90" />
        </div>
        <p className="mt-1 text-muted">
          {dateRange(trip, tz)} · {trip.segment_count} {trip.segment_count === 1 ? "booking" : "bookings"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <ReviewCountBadge count={trip.review_count} />
          {allCancelled ? <span className="font-semibold">Cancelled</span> : null}
        </div>
      </Link>
    </li>
  );
}

async function TripsList() {
  const { db } = await requireUser();
  const [trips, reviewCount] = await Promise.all([listTrips(db), countReview(db)]);
  const tz = userTimezone();
  const groups: TripStatus[] = ["upcoming", "active", "past"];

  return (
    <>
      {reviewCount > 0 ? (
        <Link
          href="/review"
          className="mb-5 flex min-h-14 items-center gap-3 rounded-2xl border-2 border-dashed border-ink bg-paper px-4 font-semibold"
        >
          <AlertIcon />
          {reviewCount} {reviewCount === 1 ? "booking needs" : "bookings need"} review
        </Link>
      ) : null}
      {trips.length === 0 ? (
        <div className="rounded-2xl border border-line bg-paper p-5">
          <p className="font-semibold">No trips yet.</p>
          <p className="mt-1 text-muted">
            Forward a flight, hotel or car confirmation to your inbound address. See{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>{" "}
            for the address and forwarding rules.
          </p>
        </div>
      ) : (
        groups.map((g) => {
          const list = trips.filter((t) => t.status === g);
          if (!list.length) return null;
          return (
            <section key={g} className="mb-6">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{GROUP_LABEL[g]}</h2>
              <ul className="space-y-3">
                {list.map((t) => (
                  <TripRow key={t.id} trip={t} tz={tz} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}

export default function TripsPage() {
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Trips</h1>
        <Link href="/add" className="inline-flex min-h-12 items-center rounded-xl bg-accent px-4 font-bold text-white">
          + Add
        </Link>
      </div>
      <Suspense fallback={<Loading label="Loading trips…" />}>
        <TripsList />
      </Suspense>
    </>
  );
}
