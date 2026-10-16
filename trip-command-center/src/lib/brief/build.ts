// Day-before brief content (spec section 7), in the spec's order:
// 1 first departure, 2 leave-home time, 3 hotel and car, 4 weather,
// 5 time difference, 6 segments needing review.
// Pure apart from the injected weather lookup, so it is unit tested.

import type { Place, Segment, Trip } from "../types";
import { lookupAirport } from "../airports";
import { describeOffset, formatTime, localDateKey, tzOffsetMinutes } from "../time";
import { placeLong, route, segmentAddress, segmentTitle, zoneCity } from "../present";
import { segmentsStartingOn } from "./schedule";
import type { DayWeather } from "./weather";

const MINUTE = 60_000;
const DOMESTIC_BUFFER_MIN = 120;
const INTERNATIONAL_BUFFER_MIN = 180;

export interface BriefDeparture {
  segment_id: string;
  title: string;
  depart_at: string;
  depart_tz: string;
  arrive_at: string | null;
  arrive_tz: string | null;
  origin: string | null;
  destination: string | null;
  terminal: string | null;
  gate: string | null;
  flight_number: string | null;
  check_in_url: string | null;
  check_in_opens_at: string | null;
  international: boolean;
}

export interface BriefLeaveBy {
  kind: "home" | "airport";
  at: string;
  tz: string;
  buffer_minutes: number;
  drive_minutes: number | null;
  airport: string | null;
}

export interface BriefStop {
  segment_id: string;
  kind: "hotel_check_in" | "hotel_check_out" | "car_pickup" | "car_return";
  title: string;
  at: string;
  tz: string;
  address: string | null;
  phone: string | null;
  confirmation_code: string | null;
}

export interface BriefPayload {
  trip_id: string;
  trip_title: string;
  for_date: string;
  generated_at: string;
  home_tz: string;
  departure: BriefDeparture | null;
  leave_by: BriefLeaveBy | null;
  stops: BriefStop[];
  weather: (DayWeather & { place: string }) | null;
  time_difference: string | null;
  /** TSA PreCheck and Global Entry reminders for the day's flights. */
  security_tips: string[];
  needs_review: { segment_id: string; title: string; reasons: string[] }[];
  push: { title: string; body: string };
  /** Segments this brief covers, so a later trip merge or split cannot send them again. */
  segment_ids: string[];
}

export interface BuildBriefInput {
  trip: Trip;
  segments: Segment[];
  forDate: string;
  currentTz: string;
  homeTz: string;
  homeAirports: string[];
  driveMinutes: (airport: string) => number | null;
  now: Date;
  weather: (lat: number, lng: number, tz: string, dateKey: string) => Promise<DayWeather | null>;
  /** Someone on the account has TSA PreCheck or Global Entry (a trusted traveler document in the vault). */
  trustedTraveler?: boolean;
}

function securityTips(day: Segment[], trusted: boolean): string[] {
  if (!trusted) return [];
  const tips: string[] = [];
  const flights = day.filter((s) => s.type === "flight");
  const usDeparture = flights.find((s) => countryOf(s.origin) === "US");
  if (usDeparture) {
    tips.push(
      `TSA PreCheck at ${usDeparture.origin?.code ?? "the airport"}: use the PreCheck lane; the boarding pass should show TSA PRE.`,
    );
  }
  const intoUs = flights.find((s) => countryOf(s.destination) === "US" && countryOf(s.origin) !== null && countryOf(s.origin) !== "US");
  if (intoUs) {
    tips.push(`Global Entry on arrival at ${intoUs.destination?.code ?? "the US airport"}: use the Global Entry lane at passport control.`);
  }
  return tips;
}

function countryOf(place: Place | null): string | null {
  return place?.country ?? lookupAirport(place?.code)?.country ?? null;
}

/** Unknown countries count as international so the buffer errs long. */
function isInternational(seg: Segment): boolean {
  const from = countryOf(seg.origin);
  const to = countryOf(seg.destination);
  return !(from && to && from === to);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function departureFrom(seg: Segment): BriefDeparture {
  const departMs = Date.parse(seg.start_at!);
  const d = seg.details ?? {};
  return {
    segment_id: seg.id,
    title: segmentTitle(seg),
    depart_at: seg.start_at!,
    depart_tz: seg.start_tz!,
    arrive_at: seg.end_at,
    arrive_tz: seg.end_tz,
    origin: placeLong(seg.origin),
    destination: placeLong(seg.destination),
    terminal: d.departure_terminal ?? null,
    gate: d.departure_gate ?? null,
    flight_number: d.flight_number ?? null,
    check_in_url: d.check_in_url ?? null,
    // Most carriers open online check-in 24 hours before departure.
    check_in_opens_at: seg.type === "flight" ? iso(departMs - 24 * 60 * MINUTE) : null,
    international: isInternational(seg),
  };
}

function leaveBy(seg: Segment, input: BuildBriefInput): BriefLeaveBy {
  const departMs = Date.parse(seg.start_at!);
  const buffer = isInternational(seg) ? INTERNATIONAL_BUFFER_MIN : DOMESTIC_BUFFER_MIN;
  const code = seg.origin?.code?.toUpperCase() ?? null;
  const fromHome = !!code && input.homeAirports.includes(code);
  const drive = fromHome ? input.driveMinutes(code!) : null;
  return {
    kind: fromHome ? "home" : "airport",
    at: iso(departMs - (buffer + (drive ?? 0)) * MINUTE),
    tz: fromHome ? input.homeTz : seg.start_tz!,
    buffer_minutes: buffer,
    drive_minutes: drive,
    airport: code,
  };
}

function stopsFor(segments: Segment[], dateKey: string): BriefStop[] {
  const stops: BriefStop[] = [];
  const starting = segmentsStartingOn(segments, dateKey);
  for (const s of starting) {
    if (s.type !== "hotel" && s.type !== "car") continue;
    stops.push({
      segment_id: s.id,
      kind: s.type === "hotel" ? "hotel_check_in" : "car_pickup",
      title: segmentTitle(s),
      at: s.start_at!,
      tz: s.start_tz!,
      address: segmentAddress(s),
      phone: s.details?.phone ?? null,
      confirmation_code: s.confirmation_code,
    });
  }
  // Check-outs and returns that same day.
  const ending = segments.filter(
    (s) =>
      (s.type === "hotel" || s.type === "car") &&
      s.status !== "cancelled" &&
      s.end_at &&
      s.end_tz &&
      localDateKey(s.end_at, s.end_tz) === dateKey,
  );
  for (const s of ending) {
    stops.push({
      segment_id: s.id,
      kind: s.type === "hotel" ? "hotel_check_out" : "car_return",
      title: segmentTitle(s),
      at: s.end_at!,
      tz: s.end_tz!,
      address:
        s.type === "car"
          ? s.details?.dropoff_location ?? s.destination?.address ?? segmentAddress(s)
          : segmentAddress(s),
      phone: s.details?.phone ?? null,
      confirmation_code: s.confirmation_code,
    });
  }
  return stops.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Where Alex ends up tomorrow: the last place among the day's segments. */
function endPlace(day: Segment[]): { place: Place; tz: string } | null {
  for (let i = day.length - 1; i >= 0; i--) {
    const s = day[i];
    const place = s.type === "car" ? s.origin : s.destination ?? s.origin;
    const tz = s.type === "flight" || s.type === "train" ? s.end_tz ?? s.start_tz : s.start_tz;
    if (place && tz) return { place, tz };
  }
  return null;
}

export async function buildBrief(input: BuildBriefInput): Promise<BriefPayload> {
  const { trip, segments, forDate } = input;
  const day = segmentsStartingOn(segments, forDate);
  const firstTransport = day.find((s) => s.type === "flight" || s.type === "train") ?? null;
  const departure = firstTransport ? departureFrom(firstTransport) : null;
  const leave = firstTransport ? leaveBy(firstTransport, input) : null;
  const stops = stopsFor(segments, forDate);

  const end = endPlace(day);
  let weather: BriefPayload["weather"] = null;
  if (end) {
    const lat = end.place.lat ?? lookupAirport(end.place.code)?.lat;
    const lng = end.place.lng ?? lookupAirport(end.place.code)?.lng;
    if (lat != null && lng != null) {
      const w = await input.weather(lat, lng, end.tz, forDate);
      const place = end.place.city ?? lookupAirport(end.place.code)?.city ?? zoneCity(end.tz);
      if (w) weather = { ...w, place };
    }
  }

  let timeDifference: string | null = null;
  if (end) {
    const at = new Date(day[day.length - 1]?.end_at ?? day[day.length - 1]?.start_at ?? input.now);
    if (tzOffsetMinutes(at, end.tz) !== tzOffsetMinutes(at, input.currentTz)) {
      const placeName = end.place.city ?? zoneCity(end.tz);
      timeDifference =
        tzOffsetMinutes(at, end.tz) === tzOffsetMinutes(at, input.homeTz)
          ? `Back on Florida time. ${describeOffset(zoneCity(input.currentTz), input.currentTz, input.homeTz, at) ?? ""}`.trim()
          : describeOffset(placeName, end.tz, input.homeTz, at);
    }
  }

  const needsReview = segments
    .filter((s) => s.status === "needs_review")
    .map((s) => ({ segment_id: s.id, title: segmentTitle(s), reasons: s.review_reasons ?? [] }));

  // Push text: short enough for a lock screen.
  let pushTitle: string;
  if (departure && firstTransport) {
    const label = departure.flight_number ?? firstTransport.provider ?? "Departure";
    pushTitle = `Tomorrow: ${label} ${route(firstTransport) ?? ""} ${formatTime(departure.depart_at, departure.depart_tz)}`
      .replace(/\s+/g, " ")
      .trim();
  } else if (stops[0]) {
    pushTitle = `Tomorrow: ${stops[0].title} ${formatTime(stops[0].at, stops[0].tz)}`;
  } else {
    pushTitle = `Tomorrow: ${trip.title}`;
  }
  const bodyParts: string[] = [];
  if (leave) {
    bodyParts.push(`${leave.kind === "home" ? "Leave home" : "At the airport by"} ${formatTime(leave.at, leave.tz)}`);
  }
  if (weather) {
    const rain = weather.rain_chance != null ? `, ${weather.rain_chance}% rain` : "";
    bodyParts.push(`${weather.place} ${weather.high_f}°/${weather.low_f}°F${rain}`);
  }
  if (timeDifference) bodyParts.push(timeDifference);
  if (needsReview.length) {
    bodyParts.push(`${needsReview.length} item${needsReview.length === 1 ? "" : "s"} to review`);
  }

  return {
    trip_id: trip.id,
    trip_title: trip.title,
    for_date: forDate,
    generated_at: input.now.toISOString(),
    home_tz: input.homeTz,
    departure,
    leave_by: leave,
    stops,
    weather,
    time_difference: timeDifference,
    security_tips: securityTips(day, input.trustedTraveler ?? false),
    needs_review: needsReview,
    push: { title: pushTitle, body: bodyParts.join(" · ") || "Open the brief for tomorrow's plan." },
    segment_ids: [...new Set([...day.map((s) => s.id), ...stops.map((s) => s.segment_id)])],
  };
}
