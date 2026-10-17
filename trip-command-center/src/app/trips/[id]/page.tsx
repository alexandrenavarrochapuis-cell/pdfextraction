// Screen 2: trip timeline, day by day (spec section 6).

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getTrip } from "@/lib/data";
import { userTimezone } from "@/lib/config";
import { buildTimeline } from "@/lib/timeline";
import { homeAirports } from "@/lib/config";
import { airbnbSearchUrl, airportPageUrl, bookingSearchUrl, findConnections, findStayGaps, type Connection } from "@/lib/trips/insights";
import type { SavedPlace, TravelDocument, Traveler } from "@/lib/types";
import { passportWarnings } from "@/lib/vault/expiry";
import { countryName, tripCountries } from "@/lib/assistant/countries";
import { fetchPerDiem, FOREIGN_PER_DIEM_URL, stateCode } from "@/lib/assistant/perdiem";
import { openMeteoGeocoder } from "@/lib/geo";
import { CountryBriefCard } from "@/components/CountryBriefCard";
import { formatMonthDay } from "@/lib/time";
import { SegmentCard } from "@/components/SegmentCard";
import { TripActions } from "@/components/TripActions";
import { Loading } from "@/components/Loading";
import { AlertIcon, BedIcon, ClockIcon, MapIcon } from "@/components/icons";

const linkBtn = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

function ConnectionRow({ c }: { c: Connection }) {
  const map = airportPageUrl(c.airport, c.depart_gate);
  return (
    <div
      className={`ml-6 rounded-2xl bg-paper p-3 ${c.tight ? "border-2 border-dashed border-ink" : "border border-line"}`}
    >
      <p className="flex items-center gap-2 font-semibold">
        {c.tight ? <AlertIcon size={18} /> : <ClockIcon size={18} />}
        {c.tight ? "Tight connection" : "Connection"}: {duration(c.minutes)} in {c.airport}
      </p>
      {c.arrive_terminal || c.depart_terminal ? (
        <p className="text-sm">
          Arrive terminal {c.arrive_terminal ?? "?"}, depart terminal {c.depart_terminal ?? "?"}
          {c.arrive_terminal && c.depart_terminal && c.arrive_terminal !== c.depart_terminal ? " (terminal change)" : ""}
        </p>
      ) : null}
      {map ? (
        <Link href={map} className={`${linkBtn} mt-2`}>
          <MapIcon size={18} /> {c.depart_gate ? `Find gate ${c.depart_gate}` : "Airport map"}
        </Link>
      ) : null}
    </div>
  );
}

async function Timeline({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requireUser();
  const result = await getTrip(db, id);
  if (!result) notFound();
  const { trip, segments } = result;
  const { data: others } = await db.from("trips").select("id, title").neq("id", id).order("start_at");
  const homeTz = userTimezone();
  const { days, unscheduled } = buildTimeline(segments);
  const connections = findConnections(segments);
  const flightIds = segments.filter((s) => s.type === "flight").map((s) => s.id);
  const { data: passRows } = flightIds.length
    ? await db.from("boarding_passes").select("segment_id").in("segment_id", flightIds)
    : { data: [] };
  const [{ data: docRows }, { data: travelerRows }] = await Promise.all([
    db.from("travel_documents").select("id, kind, traveler_id, expires_on").eq("kind", "passport"),
    db.from("travelers").select("id, name"),
  ]);
  const countries = tripCountries(segments);
  let perDiem = null;
  if (!countries.length && trip.primary_city && trip.start_at) {
    const geo = await openMeteoGeocoder(trip.primary_city, "US");
    const st = stateCode(geo?.region);
    if (st) perDiem = await fetchPerDiem(trip.primary_city, st, new Date(trip.start_at));
  }
  const stays = segments.filter((s) => s.type === "hotel" && s.status !== "cancelled" && s.details?.rate_per_night);
  const warnings = passportWarnings((docRows ?? []) as TravelDocument[], trip.end_at, segments);
  const travelerName = (id: string | null) =>
    ((travelerRows ?? []) as Pick<Traveler, "id" | "name">[]).find((t) => t.id === id)?.name ?? "A traveler";
  const passCounts = new Map<string, number>();
  for (const p of (passRows ?? []) as { segment_id: string }[]) {
    passCounts.set(p.segment_id, (passCounts.get(p.segment_id) ?? 0) + 1);
  }
  const { data: homes } = await db.from("places").select("city").eq("kind", "home");
  const gaps = findStayGaps(
    segments,
    homeAirports(),
    ((homes ?? []) as Pick<SavedPlace, "city">[]).map((h) => h.city).filter((c): c is string => !!c),
  );
  const startTz = segments.find((s) => s.start_tz)?.start_tz ?? homeTz;
  const endTz = [...segments].reverse().find((s) => s.end_tz ?? s.start_tz);
  const lastTz = endTz?.end_tz ?? endTz?.start_tz ?? homeTz;

  return (
    <>
      <Link href="/" className="inline-flex min-h-12 items-center font-semibold underline">
        ← All trips
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold">{trip.title}</h1>
        <Link
          href={`/trips/${trip.id}/map`}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-ink bg-paper px-4 font-bold"
        >
          <MapIcon size={18} /> Map
        </Link>
      </div>
      <p className="mb-4 text-muted">
        {trip.start_at ? formatMonthDay(trip.start_at, startTz) : "Dates not set"}
        {trip.end_at ? ` to ${formatMonthDay(trip.end_at, lastTz)}` : ""} · {segments.length}{" "}
        {segments.length === 1 ? "booking" : "bookings"}
      </p>

      {warnings.length ? (
        <div className="mb-5 space-y-1 rounded-2xl border-2 border-dashed border-ink bg-paper p-4">
          <p className="flex items-center gap-2 font-bold">
            <AlertIcon size={18} /> Passport check
          </p>
          {warnings.map((w) => (
            <p key={w.document_id}>
              {travelerName(w.traveler_id)}: passport expires {w.expires_on},{" "}
              {w.days_after_trip < 0 ? "before this trip ends" : `${Math.round(w.days_after_trip / 30)} months after the trip`}.
              Many countries require 6 months of validity.
            </p>
          ))}
          <Link href="/vault" className="font-semibold underline">
            Open passports and IDs
          </Link>
        </div>
      ) : null}

      {perDiem ? (
        <div className="mb-5 space-y-1 rounded-2xl border border-line bg-paper p-4">
          <p className="font-bold">
            GSA per diem, {perDiem.city}, {perDiem.state} (FY{perDiem.fiscal_year})
          </p>
          <p>
            Lodging ${perDiem.lodging} a night before taxes · Meals and incidentals ${perDiem.mie} a day
          </p>
          {stays.map((s) => {
            const rate = s.details.rate_per_night!;
            const usd = !s.details.currency || s.details.currency === "USD";
            const over = usd && rate > perDiem.lodging;
            return (
              <p key={s.id} className={over ? "font-semibold" : ""}>
                {over ? <AlertIcon size={16} className="mr-1 inline" /> : null}
                {s.details.property_name ?? "Stay"}: {rate} {s.details.currency ?? "USD"} a night,{" "}
                {!usd ? "different currency" : over ? `$${Math.round(rate - perDiem.lodging)} over the lodging rate` : "within the lodging rate"}
              </p>
            );
          })}
        </div>
      ) : null}
      {countries.length ? (
        <div className="mb-5 space-y-3">
          {countries.map((c) => (
            <CountryBriefCard key={c} code={c} name={countryName(c)} />
          ))}
          <p className="text-sm text-muted">
            Foreign per diem rates come from the{" "}
            <a href={FOREIGN_PER_DIEM_URL} className="underline" target="_blank" rel="noreferrer">
              State Department tables
            </a>
            .
          </p>
        </div>
      ) : null}

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
              {day.entries.map((e) => {
                const connection = e.kind === "single" ? connections.find((c) => c.from_segment_id === e.segment.id) : undefined;
                return (
                  <li key={e.key} className="space-y-3">
                    <SegmentCard
                      segment={e.segment}
                      kind={e.kind}
                      at={e.at}
                      tz={e.tz}
                      homeTz={homeTz}
                      tripId={trip.id}
                      passCount={passCounts.get(e.segment.id)}
                    />
                    {connection ? <ConnectionRow c={connection} /> : null}
                  </li>
                );
              })}
              {gaps
                .filter((g) => g.check_in === day.dateKey)
                .map((g) => (
                  <li key={`gap-${g.check_in}`} className="space-y-2 rounded-2xl border-2 border-dashed border-ink bg-paper p-4">
                    <p className="flex items-center gap-2 font-bold">
                      <BedIcon size={18} /> No place to stay booked in {g.city}
                    </p>
                    <p>
                      {g.check_in} to {g.check_out}. Forward the confirmation when you book, or add it by hand.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <a href={bookingSearchUrl(g)} className={linkBtn} target="_blank" rel="noreferrer">
                        Search Booking.com
                      </a>
                      <a href={airbnbSearchUrl(g)} className={linkBtn} target="_blank" rel="noreferrer">
                        Search Airbnb
                      </a>
                      <Link href="/add?type=hotel" className={linkBtn}>
                        Add a stay
                      </Link>
                    </div>
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

      <Link href="/add" className={`${linkBtn} mt-6`}>
        + Add a drive, stop or stay
      </Link>

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
