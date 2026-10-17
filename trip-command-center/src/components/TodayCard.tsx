// On-trip mode: the top of the Trips screen while a trip is under way (or
// leaves within a day). What is next and when to leave, the boarding pass,
// directions, local and home time, weather, the local currency, the
// emergency number, SOS and Atlas.

import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupAirport } from "@/lib/airports";
import { emergencyNumber, STATE_DEPARTMENT_EMERGENCY } from "@/lib/atlas/emergency";
import { leaveBy } from "@/lib/brief/build";
import { fToC } from "@/lib/brief/weather";
import { driveMinutesTo, homeAirports, userTimezone } from "@/lib/config";
import { currencyOf } from "@/lib/currency";
import { getTrip } from "@/lib/data";
import { googleDirectionsUrl, segmentAddress, segmentTitle, telUrl, zoneCity } from "@/lib/present";
import { describeOffset, formatDay, formatTimeWithZone, localDateKey } from "@/lib/time";
import { dialable, MOMENT_LABEL, todayView, type Here, type Moment } from "@/lib/today";
import { dayWeather, usdRate } from "@/lib/today-fetch";
import { airportPageUrl } from "@/lib/trips/insights";
import type { Place, Trip } from "@/lib/types";
import { CopyButton } from "./CopyButton";
import { CloudIcon, LinkIcon, MapIcon, PassIcon, PhoneIcon, PinIcon } from "./icons";
import { Clock, Countdown, QuickConvert } from "./TodayLive";

const action = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

interface PassLink {
  id: string;
  barcode_message: string | null;
}

interface Action {
  href: string;
  label: string;
  icon: "pass" | "map" | "pin" | "link" | "phone";
  external?: boolean;
}

const ICONS = { pass: PassIcon, map: MapIcon, pin: PinIcon, link: LinkIcon, phone: PhoneIcon };

function placeName(here: Here): string {
  return here.place.city ?? lookupAirport(here.place.code)?.city ?? here.place.name ?? zoneCity(here.tz);
}

function directionsTo(place: Place | null | undefined, address: string | null): string | null {
  if (place && (place.address || place.name || place.lat != null)) return googleDirectionsUrl(null, place);
  return address ? googleDirectionsUrl(null, { address }) : null;
}

function actionsFor(m: Moment, tripId: string, passes: PassLink[], now: Date): Action[] {
  const s = m.segment;
  const d = s.details ?? {};
  const out: Action[] = [];
  if (s.type === "flight" && m.kind === "depart") {
    const scannable = passes.filter((p) => p.barcode_message);
    if (scannable.length === 1 && passes.length === 1) {
      out.push({ href: `/passes/${scannable[0].id}`, label: "Boarding pass", icon: "pass" });
    } else {
      out.push({
        href: `/passes?segment=${s.id}`,
        label: passes.length ? `Boarding passes (${passes.length})` : "Add boarding pass",
        icon: "pass",
      });
    }
    if (d.check_in_url && Date.parse(m.at) - now.getTime() <= 24 * 3_600_000) {
      out.push({ href: d.check_in_url, label: "Check in", icon: "link", external: true });
    }
    const map = airportPageUrl(s.origin?.code, d.departure_gate);
    if (map) out.push({ href: map, label: `${s.origin!.code!.toUpperCase()} airport map`, icon: "map" });
    const airport = lookupAirport(s.origin?.code);
    const to = airport ? { name: `${airport.name} (${airport.code})`, lat: airport.lat, lng: airport.lng } : s.origin;
    const dir = directionsTo(to, null);
    if (dir) out.push({ href: dir, label: "Directions to the airport", icon: "pin", external: true });
    out.push({ href: `/trips/${tripId}/flight/${s.id}`, label: "Track flight", icon: "map" });
  } else if (s.type === "drive" && s.destination) {
    out.push({
      href: googleDirectionsUrl(s.origin, s.destination, d.stops ?? []),
      label: "Start GPS",
      icon: "pin",
      external: true,
    });
    out.push({ href: `/trips/${tripId}/drive/${s.id}`, label: "Route map", icon: "map" });
  } else if (m.kind === "return") {
    const dir = directionsTo(null, d.dropoff_location ?? s.destination?.address ?? segmentAddress(s));
    if (dir) out.push({ href: dir, label: "Directions to the return", icon: "pin", external: true });
  } else if (m.kind !== "check_out") {
    const place = s.type === "car" || s.type === "train" ? s.origin : (s.destination ?? s.origin);
    const dir = directionsTo(s.type === "hotel" ? null : place, segmentAddress(s));
    if (dir) out.push({ href: dir, label: "Directions", icon: "pin", external: true });
  }
  if (d.phone) out.push({ href: telUrl(d.phone), label: "Call", icon: "phone" });
  return out;
}

function leaveLine(m: Moment, now: Date): string | null {
  if (m.segment.type !== "flight" || m.kind !== "depart" || !m.segment.start_tz) return null;
  const leave = leaveBy(m.segment, { homeAirports: homeAirports(), homeTz: userTimezone(), driveMinutes: driveMinutesTo });
  if (Date.parse(leave.at) <= now.getTime()) return null;
  const time = formatTimeWithZone(leave.at, leave.tz);
  const hours = leave.buffer_minutes / 60;
  if (leave.kind === "home") {
    const drive = leave.drive_minutes ? ` + ${leave.drive_minutes} min drive` : "";
    return `Leave home by ${time} (${hours} h at the airport${drive})`;
  }
  return `Be at ${leave.airport ?? "the airport"} by ${time} (${hours} h before departure)`;
}

export async function TodayCard({ db, trip }: { db: SupabaseClient; trip: Trip }) {
  const now = new Date();
  const full = await getTrip(db, trip.id, now);
  if (!full) return null;
  const { current, next, later, here } = todayView(full.segments, now);
  const homeTz = userTimezone();
  const code = currencyOf(here?.country);
  const nextFlight = next?.segment.type === "flight" && next.kind === "depart" ? next.segment.id : null;
  const [passes, weather, rate] = await Promise.all([
    nextFlight
      ? db
          .from("boarding_passes")
          .select("id, barcode_message")
          .eq("segment_id", nextFlight)
          .then(({ data }) => (data ?? []) as PassLink[])
      : Promise.resolve([] as PassLink[]),
    here?.lat != null && here.lng != null ? dayWeather(here.lat, here.lng, here.tz, localDateKey(now, here.tz)) : null,
    code && code !== "USD" ? usdRate(code) : null,
  ]);
  const emergency = emergencyNumber(here?.country ?? null);
  const dial = dialable(emergency);
  const abroad = !!here?.country && here.country.toUpperCase() !== "US";
  const city = here ? placeName(here) : null;
  const offset = here && city ? describeOffset(city, here.tz, homeTz, now) : null;
  const nd = next?.segment.details ?? {};
  const leave = next ? leaveLine(next, now) : null;

  return (
    <section aria-labelledby="today-title" className="mb-6 overflow-hidden rounded-3xl border border-line/60 bg-paper shadow-card">
      <div className="bg-accent-soft px-5 py-4">
        <p className="text-sm font-bold uppercase tracking-wide text-accent">Today on your trip</p>
        <h2 id="today-title" className="text-2xl font-bold">
          <Link href={`/trips/${trip.id}`} className="underline-offset-4 hover:underline">
            {trip.title}
          </Link>
        </h2>
        {here ? (
          <p className="mt-1">
            <span className="font-semibold">
              <Clock tz={here.tz} /> in {city}
            </span>
            {offset ? (
              <span className="text-muted">
                {" "}
                · <Clock tz={homeTz} /> at home
              </span>
            ) : null}
          </p>
        ) : null}
        {offset ? <p className="text-sm text-muted">{offset}</p> : null}
      </div>

      <div className="space-y-5 p-5">
        {current ? (
          <div className="rounded-2xl border-2 border-ink p-4">
            <p className="text-sm font-semibold text-muted">Under way</p>
            <p className="text-lg font-bold">{segmentTitle(current.segment)}</p>
            {current.segment.end_at ? (
              <p>
                Arrives {formatTimeWithZone(current.segment.end_at, current.segment.end_tz ?? current.tz)} (
                <Countdown at={current.segment.end_at} />)
              </p>
            ) : null}
            {current.segment.type === "flight" ? (
              <Link href={`/trips/${trip.id}/flight/${current.segment.id}`} className={`${action} mt-2`}>
                <MapIcon size={18} /> Track flight
              </Link>
            ) : null}
          </div>
        ) : null}

        {next ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-muted">
              Next · {MOMENT_LABEL[next.kind]} <Countdown at={next.at} />
            </p>
            <p className="text-xl font-bold">{segmentTitle(next.segment)}</p>
            <p className="text-lg">
              <strong>{formatTimeWithZone(next.at, next.tz)}</strong> · {formatDay(next.at, next.tz)}
            </p>
            {next.segment.type === "flight" ? (
              <p>
                {[
                  nd.departure_terminal ? `Terminal ${nd.departure_terminal}` : null,
                  nd.departure_gate ? `Gate ${nd.departure_gate}` : "Gate not posted yet",
                  nd.seat ? `Seat ${nd.seat}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {leave ? <p className="font-semibold">{leave}</p> : null}
            <div className="flex flex-wrap gap-2 pt-1">
              {actionsFor(next, trip.id, passes, now).map((a) => {
                const Icon = ICONS[a.icon];
                return a.external ? (
                  <a key={a.label} href={a.href} className={action} target="_blank" rel="noreferrer">
                    <Icon size={18} /> {a.label}
                  </a>
                ) : (
                  <Link key={a.label} href={a.href} className={action}>
                    <Icon size={18} /> {a.label}
                  </Link>
                );
              })}
              {next.segment.confirmation_code ? <CopyButton value={next.segment.confirmation_code} label="Copy code" /> : null}
            </div>
          </div>
        ) : (
          <p className="text-muted">Nothing else is booked on this trip. Ask Atlas to plan what comes next.</p>
        )}

        {later.length ? (
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted">Then</h3>
            <ul className="mt-1 divide-y divide-line">
              {later.map((m) => (
                <li key={`${m.segment.id}-${m.kind}`} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="text-muted">{MOMENT_LABEL[m.kind]} · </span>
                    {segmentTitle(m.segment)}
                  </span>
                  <span className="shrink-0 font-semibold">{formatTimeWithZone(m.at, m.tz)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {weather && city ? (
            <div className="rounded-2xl border border-line p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-muted">
                <CloudIcon size={18} /> Weather in {city} today
              </p>
              <p className="mt-1 text-lg font-bold">
                {weather.high_f}°F / {fToC(weather.high_f)}°C
              </p>
              <p className="text-muted">
                Low {weather.low_f}°F / {fToC(weather.low_f)}°C
                {weather.rain_chance != null ? ` · Rain ${weather.rain_chance}%` : ""}
              </p>
            </div>
          ) : null}
          {code && rate ? (
            <div className="rounded-2xl border border-line p-4">
              <p className="text-sm font-semibold text-muted">Money · {code}</p>
              <QuickConvert code={code} rate={rate} />
            </div>
          ) : null}
          <div className="rounded-2xl border border-line p-4 sm:col-span-2">
            <p className="text-sm font-semibold text-muted">Emergency{city ? ` in ${city}` : ""}</p>
            {dial ? (
              <a href={`tel:${dial}`} className="mt-1 inline-flex min-h-12 items-center gap-2 text-2xl font-bold">
                <PhoneIcon /> {emergency}
              </a>
            ) : (
              <p className="mt-1 font-bold">{emergency}</p>
            )}
            {abroad ? <p className="mt-1 text-sm text-muted">{STATE_DEPARTMENT_EMERGENCY}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/atlas?new=1&sos=1" className="inline-flex min-h-12 items-center rounded-xl border-2 border-ink px-4 font-bold">
            SOS · Help nearby
          </Link>
          <Link href="/atlas" className="inline-flex min-h-12 items-center rounded-xl bg-accent px-4 font-bold text-white">
            Ask Atlas
          </Link>
          <Link href={`/trips/${trip.id}/map`} className={action}>
            <MapIcon size={18} /> Trip map
          </Link>
        </div>
      </div>
    </section>
  );
}
