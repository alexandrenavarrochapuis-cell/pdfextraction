// The day-before brief as a page (spec section 7). Shows the brief that was
// sent when there is one; otherwise builds it now from the current itinerary.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getTrip } from "@/lib/data";
import { driveMinutesTo, homeAirports, userTimezone } from "@/lib/config";
import { buildBrief, type BriefPayload, type BriefStop } from "@/lib/brief/build";
import { currentTimezone } from "@/lib/brief/schedule";
import { fToC, fetchDayWeather } from "@/lib/brief/weather";
import { formatDateKeyLong, formatTime } from "@/lib/time";
import { mapsUrl, telUrl } from "@/lib/present";
import { TimePair } from "@/components/TimePair";
import { CopyButton } from "@/components/CopyButton";
import { Loading } from "@/components/Loading";
import { AlertIcon, BedIcon, CarIcon, ClockIcon, CloudIcon, LinkIcon, MapIcon, PhoneIcon, PinIcon, PlaneIcon } from "@/components/icons";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const card = "rounded-2xl border border-line bg-paper p-4";
const action = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

const STOP_LABEL: Record<BriefStop["kind"], string> = {
  hotel_check_in: "Hotel check-in",
  hotel_check_out: "Hotel check-out",
  car_pickup: "Car pick-up",
  car_return: "Car return",
};

function Section({ n, title, icon, children }: { n: number; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={card}>
      <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
        {icon}
        <span>
          {n}. {title}
        </span>
      </h2>
      {children}
    </section>
  );
}

function BriefView({ brief, tripId }: { brief: BriefPayload; tripId: string }) {
  const homeTz = brief.home_tz;
  const dep = brief.departure;
  return (
    <div className="space-y-4">
      <Section n={1} title="First departure" icon={<PlaneIcon />}>
        {dep ? (
          <div className="space-y-2">
            <p className="text-xl font-bold">{dep.title}</p>
            <TimePair at={dep.depart_at} tz={dep.depart_tz} homeTz={homeTz} />
            <p>
              From {dep.origin}
              {dep.terminal ? `, terminal ${dep.terminal}` : ""}
              {dep.gate ? `, gate ${dep.gate}` : ""}
            </p>
            {dep.arrive_at && dep.arrive_tz ? (
              <p>
                Arrives {dep.destination} at {formatTime(dep.arrive_at, dep.arrive_tz)} local
              </p>
            ) : null}
            {dep.check_in_opens_at ? (
              <p className="text-muted">
                Online check-in usually opens 24 hours before: {formatTime(dep.check_in_opens_at, homeTz)} Florida time
                today.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {dep.check_in_url ? (
                <a href={dep.check_in_url} className={action} target="_blank" rel="noreferrer">
                  <LinkIcon size={18} /> Check in
                </a>
              ) : null}
              <Link href={`/trips/${tripId}/flight/${dep.segment_id}`} className={action}>
                <MapIcon size={18} /> Track flight
              </Link>
            </div>
          </div>
        ) : (
          <p>No flight or train tomorrow.</p>
        )}
      </Section>

      <Section n={2} title="When to leave" icon={<ClockIcon />}>
        {brief.leave_by ? (
          <div className="space-y-1">
            <p className="font-semibold">{brief.leave_by.kind === "home" ? "Leave home by" : "Be at the airport by"}</p>
            <TimePair at={brief.leave_by.at} tz={brief.leave_by.tz} homeTz={homeTz} />
            <p className="text-muted">
              {brief.leave_by.buffer_minutes / 60} hours before departure ({dep?.international ? "international" : "domestic"})
              {brief.leave_by.drive_minutes
                ? `, plus about ${brief.leave_by.drive_minutes} minutes to drive to ${brief.leave_by.airport}`
                : ""}
              .
            </p>
          </div>
        ) : (
          <p>No departure to plan around.</p>
        )}
      </Section>

      <Section n={3} title="Hotel and car" icon={<BedIcon />}>
        {brief.stops.length ? (
          <ul className="space-y-4">
            {brief.stops.map((s) => (
              <li key={`${s.segment_id}-${s.kind}`} className="space-y-1">
                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
                  {s.kind.startsWith("hotel") ? <BedIcon size={18} /> : <CarIcon size={18} />}
                  {STOP_LABEL[s.kind]}
                </p>
                <p className="text-lg font-bold">{s.title}</p>
                <TimePair at={s.at} tz={s.tz} homeTz={homeTz} size="md" />
                {s.address ? <p>{s.address}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {s.address ? (
                    <a href={mapsUrl(s.address)} className={action} target="_blank" rel="noreferrer">
                      <PinIcon size={18} /> Open in Maps
                    </a>
                  ) : null}
                  {s.phone ? (
                    <a href={telUrl(s.phone)} className={action}>
                      <PhoneIcon size={18} /> Call
                    </a>
                  ) : null}
                  {s.confirmation_code ? <CopyButton value={s.confirmation_code} label="Copy code" /> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>No hotel or car changes tomorrow.</p>
        )}
      </Section>

      <Section n={4} title="Weather" icon={<CloudIcon />}>
        {brief.weather ? (
          <p className="text-lg">
            <strong>{brief.weather.place}</strong>: high {brief.weather.high_f}°F ({fToC(brief.weather.high_f)}°C), low{" "}
            {brief.weather.low_f}°F ({fToC(brief.weather.low_f)}°C)
            {brief.weather.rain_chance != null ? `, ${brief.weather.rain_chance}% chance of rain` : ""}.
          </p>
        ) : (
          <p>Forecast not available yet.</p>
        )}
      </Section>

      <Section n={5} title="Time difference" icon={<ClockIcon />}>
        <p>{brief.time_difference ?? "No time zone change tomorrow."}</p>
      </Section>

      <Section n={6} title="Needs review" icon={<AlertIcon />}>
        {brief.needs_review.length ? (
          <ul className="space-y-2">
            {brief.needs_review.map((r) => (
              <li key={r.segment_id} className="rounded-xl border-2 border-dashed border-ink p-3">
                <p className="font-semibold">{r.title}</p>
                {r.reasons.length ? <p className="text-sm">{r.reasons.join(", ")}</p> : null}
              </li>
            ))}
            <li>
              <Link href="/review" className="font-semibold underline">
                Open the review queue
              </Link>
            </li>
          </ul>
        ) : (
          <p>Nothing on this trip needs review.</p>
        )}
      </Section>
    </div>
  );
}

async function Brief({ params }: { params: Promise<{ id: string; date: string }> }) {
  const { id, date } = await params;
  if (!DATE_RE.test(date)) notFound();
  const { db } = await requireUser();
  const result = await getTrip(db, id);
  if (!result) notFound();

  const { data: stored } = await db.from("briefs").select("sent_at").eq("trip_id", id).eq("for_date", date).maybeSingle();
  const now = new Date();
  // Always rebuilt, so a gate or time change since the push still shows here.
  const brief = await buildBrief({
      trip: result.trip,
      segments: result.segments,
      forDate: date,
      currentTz: currentTimezone([result], now, userTimezone()),
      homeTz: userTimezone(),
      homeAirports: homeAirports(),
      driveMinutes: driveMinutesTo,
      now,
      weather: fetchDayWeather,
    });

  return (
    <>
      <Link href={`/trips/${id}`} className="inline-flex min-h-12 items-center font-semibold underline">
        ← {result.trip.title}
      </Link>
      <h1 className="text-3xl font-bold">{formatDateKeyLong(date)}</h1>
      <p className="mb-4 text-muted">
        {stored?.sent_at
          ? `Notification sent ${new Date(stored.sent_at).toLocaleString("en-US", { timeZone: userTimezone() })} Florida time. Showing the latest itinerary.`
          : "Built from the current itinerary."}
      </p>
      <BriefView brief={brief} tripId={id} />
    </>
  );
}

export default function BriefPage({ params }: PageProps<"/trips/[id]/brief/[date]">) {
  return (
    <Suspense fallback={<Loading label="Building the brief…" />}>
      <Brief params={params} />
    </Suspense>
  );
}
