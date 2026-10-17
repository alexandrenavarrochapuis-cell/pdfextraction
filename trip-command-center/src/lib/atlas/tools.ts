// The tools Atlas can call. Reading: the traveler's trips, weather, currency,
// drive planning with Tesla Superchargers, emergency help nearby, pre-filled
// booking pages. Acting, when the traveler asks: add, edit, cancel or delete
// bookings, rename trips, save places and travelers. Every write goes through
// the signed-in session, so row level security limits it to their own data.
// Web search and web fetch run on Anthropic's side.

import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import { cachedGeocoder, geocodeAddress, openMeteoGeocoder, timezoneAt } from "../geo";
import { superchargersAlong } from "../chargers-fetch";
import { googleDirectionsUrl } from "../present";
import { PLACE_KINDS, type Place, type SavedPlace, type Segment } from "../types";
import { buildManualSegment, CreateSegmentSchema } from "../trips/create";
import { applySegmentEdit, SegmentEditSchema } from "../trips/edit";
import { regroupUser } from "../trips/regroup";
import { countryAt, emergencyNumber, nearbyHelp, STATE_DEPARTMENT_EMERGENCY } from "./emergency";
import { TripItemSchema, tripItemToSegment, type TripItem } from "./item";
import { carLinks, flightLinks, hotelLinks } from "./links";
import { convertCurrency, weekForecast } from "./money";

export interface AtlasAction {
  label: string;
  href: string | null;
}

export interface ToolContext {
  db: SupabaseClient;
  userId: string;
  location: { lat: number; lng: number } | null;
  /** Called after each change to the app, so the chat can show it. */
  onAction: (action: AtlasAction) => void;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const IATA = /^[A-Za-z]{3}$/;
const id = z.uuid();

const ItemEdit = z.object({
  segment_id: id,
  start_local: z.string().regex(LOCAL).optional(),
  end_local: z.string().regex(LOCAL).optional(),
  from: z.string().trim().max(300).optional(),
  to: z.string().trim().max(300).optional(),
  provider: z.string().trim().max(120).optional(),
  confirmation_code: z.string().trim().max(40).optional(),
  flight_number: z.string().trim().max(12).optional(),
  property_name: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

const Inputs = {
  get_trips: z.object({}),
  weather: z.object({ place: z.string().trim().min(2).max(300) }),
  convert_currency: z.object({
    amount: z.number().positive().max(1e9),
    from: z.string().regex(/^[A-Za-z]{3}$/),
    to: z.string().regex(/^[A-Za-z]{3}$/),
  }),
  plan_drive: z.object({
    from: z.string().trim().min(2).max(300),
    to: z.string().trim().min(2).max(300),
    stops: z.array(z.string().trim().min(2).max(300)).max(9).optional(),
  }),
  nearby_help: z.object({ near: z.string().trim().max(300).optional() }),
  flight_booking_links: z.object({
    from: z.string().regex(IATA),
    to: z.string().regex(IATA),
    depart: z.string().regex(DATE),
    return: z.string().regex(DATE).optional(),
    adults: z.number().int().min(1).max(9),
    cabin: z.enum(["economy", "premium", "business", "first"]).optional(),
  }),
  hotel_booking_links: z.object({
    destination: z.string().trim().min(2).max(200),
    check_in: z.string().regex(DATE),
    check_out: z.string().regex(DATE),
    adults: z.number().int().min(1).max(16),
    rooms: z.number().int().min(1).max(8).optional(),
  }),
  car_rental_links: z.object({
    pickup: z.string().trim().min(2).max(120),
    pickup_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    dropoff_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    dropoff: z.string().trim().min(2).max(120).optional(),
  }),
  add_trip_item: TripItemSchema,
  update_trip_item: ItemEdit,
  cancel_trip_item: z.object({ segment_id: id }),
  delete_trip_item: z.object({ segment_id: id }),
  rename_trip: z.object({ trip_id: id, title: z.string().trim().min(1).max(120) }),
  add_saved_place: z.object({
    label: z.string().trim().min(1).max(120),
    kind: z.enum(PLACE_KINDS),
    address: z.string().trim().min(3).max(300),
  }),
  remember: z.object({ note: z.string().trim().min(3).max(500) }),
  forget: z.object({ note_id: id }),
  add_traveler: z.object({
    name: z.string().trim().min(1).max(120),
    relation: z.enum(["self", "spouse", "child", "parent", "other"]),
    name_variants: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  }),
} as const;

type ToolName = keyof typeof Inputs;

const STATUS: Record<ToolName, string> = {
  get_trips: "Looking at your trips…",
  weather: "Checking the weather…",
  convert_currency: "Converting…",
  plan_drive: "Planning the drive and finding Superchargers…",
  nearby_help: "Finding help nearby…",
  flight_booking_links: "Preparing the flight search…",
  hotel_booking_links: "Preparing the hotel search…",
  car_rental_links: "Preparing the rental car search…",
  add_trip_item: "Adding it to your trips…",
  update_trip_item: "Updating your trip…",
  cancel_trip_item: "Marking it cancelled…",
  delete_trip_item: "Removing it…",
  rename_trip: "Renaming the trip…",
  add_saved_place: "Saving the place…",
  add_traveler: "Adding the traveler…",
  remember: "Noting that…",
  forget: "Forgetting that…",
};

export function toolStatus(name: string): string {
  return STATUS[name as ToolName] ?? (name === "web_fetch" ? "Reading a page…" : "Searching the web…");
}

const text = (description: string) => ({ type: "string", description });
const placeText = text("An address, a place or business name with its city, or a saved place such as Home");
const segmentId = text("The segment id from get_trips");

function tool(name: ToolName, description: string, properties: Record<string, unknown>, required: string[] = []): Anthropic.Beta.BetaTool {
  return {
    name,
    description,
    input_schema: { type: "object", properties, required, additionalProperties: false },
    eager_input_streaming: true,
  };
}

const itemProperties = {
  type: { type: "string", enum: ["flight", "hotel", "drive", "train", "car", "event", "stop"] },
  summary: text("One line describing it, e.g. Delta DL 84 TPA to CDG"),
  start_local: text("YYYY-MM-DDTHH:MM local time where it starts (check-in for a stay)"),
  end_local: text("YYYY-MM-DDTHH:MM local time where it ends (check-out for a stay)"),
  from: text("Departure airport code, station city, or start address"),
  to: text("Arrival airport code, station city, or the address of the stay, stop or event"),
  provider: text("Airline, hotel brand, rental company or operator"),
  confirmation_code: text("Booking reference"),
  flight_number: text("e.g. DL 84"),
  property_name: text("Hotel or rental name"),
  note: text("Anything else worth keeping"),
};

export const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  tool(
    "get_trips",
    "The traveler's current and upcoming bookings grouped by trip: flights, stays, rental cars, trains, drives and stops, with local times, confirmation codes, and the trip and segment ids the other tools need. Call it before answering about their plans or changing anything.",
    {},
  ),
  tool("weather", "Seven-day forecast for a place: daily high and low in °F and °C and the chance of rain.", { place: placeText }, ["place"]),
  tool(
    "convert_currency",
    "Convert an amount between currencies at today's reference rate (ISO codes such as USD, EUR, GBP, MXN, JPY).",
    { amount: { type: "number" }, from: text("ISO currency code"), to: text("ISO currency code") },
    ["amount", "from", "to"],
  ),
  tool(
    "plan_drive",
    "Plan a road trip in the family's own car: finds each place on the map, the straight-line distance, a Google Maps turn-by-turn link through every stop, and the Tesla Superchargers within 25 km of the route (stalls, power, directions). Google Maps gives the road distance and time.",
    { from: placeText, to: placeText, stops: { type: "array", items: placeText, maxItems: 9, description: "Stops in order" } },
    ["from", "to"],
  ),
  tool(
    "nearby_help",
    "Emergency help near the traveler: the local emergency number and the closest hospitals (emergency departments first), clinics, pharmacies and police with distance, phone and directions. Uses the phone's shared location unless `near` names a place.",
    { near: text("A place to search around when the location is not shared") },
  ),
  tool(
    "flight_booking_links",
    "Flight searches with the route, dates, travelers and cabin filled in on Google Flights, Kayak, Skyscanner, Expedia and United, plus the booking pages of American, Delta, Southwest, JetBlue, Alaska, Qatar Airways and Air France, where the traveler signs in to earn miles. Give the ones that fly the route. Atlas cannot pay or ticket.",
    {
      from: text("Departure airport IATA code"),
      to: text("Arrival airport IATA code"),
      depart: text("YYYY-MM-DD"),
      return: text("YYYY-MM-DD; omit for one way"),
      adults: { type: "integer", minimum: 1, maximum: 9 },
      cabin: { type: "string", enum: ["economy", "premium", "business", "first"] },
    },
    ["from", "to", "depart", "adults"],
  ),
  tool(
    "hotel_booking_links",
    "Hotel searches with the destination, dates and guests filled in on Booking.com (the family's account), Hilton, Marriott, Expedia and Airbnb, for the traveler to pick a room and pay on the site. Atlas cannot pay or reserve.",
    {
      destination: text("City, neighborhood, address or hotel name"),
      check_in: text("YYYY-MM-DD"),
      check_out: text("YYYY-MM-DD"),
      adults: { type: "integer", minimum: 1, maximum: 16 },
      rooms: { type: "integer", minimum: 1, maximum: 8 },
    },
    ["destination", "check_in", "check_out", "adults"],
  ),
  tool(
    "car_rental_links",
    "Rental car searches with the pickup place and times filled in on Kayak and Expedia, plus the National, Hertz, Avis, Enterprise and Sixt sites for booking with a loyalty account. Atlas cannot reserve.",
    {
      pickup: text("Airport code (preferred) or city"),
      pickup_at: text("YYYY-MM-DDTHH:MM local pickup time"),
      dropoff_at: text("YYYY-MM-DDTHH:MM local return time"),
      dropoff: text("Return airport code or city when different from pickup"),
    },
    ["pickup", "pickup_at", "dropoff_at"],
  ),
  tool(
    "add_trip_item",
    "Add a booking or plan to the traveler's trips (it joins the right trip automatically). Use when they ask to add something or confirm they booked it.",
    itemProperties,
    ["type", "summary", "start_local"],
  ),
  tool(
    "update_trip_item",
    "Change a booking on the timeline: times, places, airline or hotel, confirmation code, flight number, note. Only the fields given change.",
    { segment_id: segmentId, ...Object.fromEntries(Object.entries(itemProperties).filter(([k]) => !["type", "summary"].includes(k))) },
    ["segment_id"],
  ),
  tool("cancel_trip_item", "Mark a booking cancelled; it stays on the timeline struck through.", { segment_id: segmentId }, ["segment_id"]),
  tool(
    "delete_trip_item",
    "Remove a booking from the app entirely. Only after the traveler confirmed which one and that they want it deleted.",
    { segment_id: segmentId },
    ["segment_id"],
  ),
  tool("rename_trip", "Rename a trip; the new name is kept from then on.", { trip_id: text("The trip id from get_trips"), title: text("New name") }, [
    "trip_id",
    "title",
  ]),
  tool(
    "add_saved_place",
    "Save a place for drives and stops: home, family, friend, office or other.",
    { label: text("e.g. Mom's house"), kind: { type: "string", enum: [...PLACE_KINDS] }, address: text("Street address") },
    ["label", "kind", "address"],
  ),
  tool(
    "remember",
    "Keep a short note about the family for future chats: loyalty programs and status, preferences (seats, hotels, airlines, diet), habits. Use when they ask you to remember something or state a lasting preference.",
    { note: text("One fact, in a sentence") },
    ["note"],
  ),
  tool("forget", "Delete a note you keep, by the id shown in your notes.", { note_id: text("The note id") }, ["note_id"]),
  tool(
    "add_traveler",
    "Add a family member or colleague so boarding passes and documents can be matched to them.",
    {
      name: text("Full name as on the passport"),
      relation: { type: "string", enum: ["self", "spouse", "child", "parent", "other"] },
      name_variants: { type: "array", items: { type: "string" }, description: "Other spellings airlines print, e.g. NAVARRO/ALEX" },
    },
    ["name", "relation"],
  ),
  { type: "web_search_20260209", name: "web_search", max_uses: 8 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 },
];

// Reading ------------------------------------------------------------------------

function localTime(at: string | null, tz: string | null): string {
  if (!at) return "time not set";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz ?? "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(at));
  } catch {
    return at;
  }
}

function where(p: Place | null): string {
  if (!p) return "?";
  return p.code ?? p.name ?? p.city ?? p.address ?? "?";
}

async function getTrips(db: SupabaseClient): Promise<string> {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const [{ data: segs }, { data: trips }] = await Promise.all([
    db.from("segments").select("*").or(`end_at.gte.${since},start_at.gte.${since}`).order("start_at").limit(100),
    db.from("trips").select("id, title"),
  ]);
  const titles = new Map((trips ?? []).map((t) => [t.id as string, t.title as string]));
  const lines: string[] = [];
  let lastTrip: string | null | undefined;
  for (const s of (segs ?? []) as Segment[]) {
    if (s.trip_id !== lastTrip) {
      lastTrip = s.trip_id;
      lines.push(s.trip_id ? `Trip "${titles.get(s.trip_id) ?? "Untitled"}" (trip_id ${s.trip_id})` : "Not in a trip yet");
    }
    const d = s.details ?? {};
    const what = [s.type, s.provider, d.flight_number, d.property_name].filter(Boolean).join(" ");
    const route =
      s.origin && s.destination && where(s.origin) !== where(s.destination) ? `${where(s.origin)} to ${where(s.destination)}` : where(s.destination ?? s.origin);
    const status = s.status === "cancelled" ? "; CANCELLED" : s.status === "needs_review" ? `; needs review (${s.review_reasons.join(", ")})` : "";
    lines.push(
      `- ${what}: ${route}; ${localTime(s.start_at, s.start_tz)}${s.end_at ? ` until ${localTime(s.end_at, s.end_tz ?? s.start_tz)}` : ""}${s.confirmation_code ? `; confirmation ${s.confirmation_code}` : ""}${status} (segment_id ${s.id})`,
    );
  }
  return lines.length ? lines.join("\n") : "No current or upcoming bookings.";
}

async function resolvePlaceText(db: SupabaseClient, query: string): Promise<(Place & { lat: number; lng: number }) | null> {
  const { data } = await db.from("places").select("*").ilike("label", query).limit(1).maybeSingle();
  const saved = data as SavedPlace | null;
  if (saved?.lat != null && saved.lng != null) {
    return { name: saved.label, address: saved.address, city: saved.city, lat: saved.lat, lng: saved.lng };
  }
  const geo = await geocodeAddress(query);
  return geo ? { name: null, address: query, city: geo.city, lat: geo.lat, lng: geo.lng } : null;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function planDrive(db: SupabaseClient, input: z.infer<typeof Inputs.plan_drive>): Promise<string> {
  const names = [input.from, ...(input.stops ?? []), input.to];
  const found = await Promise.all(names.map((n) => resolvePlaceText(db, n)));
  const missing = names.filter((_, i) => !found[i]);
  if (missing.length) return JSON.stringify({ error: `Not found on the map: ${missing.join("; ")}. Ask for a fuller address.` });
  const points = found as (Place & { lat: number; lng: number })[];
  const km = points.slice(1).reduce((sum, p, i) => sum + haversineKm(points[i], p), 0);
  const chargers = await superchargersAlong(points).catch(() => null);
  return JSON.stringify({
    places: points.map((p, i) => ({ asked: names[i], found: p.address ?? p.name, city: p.city })),
    straight_line_km: Math.round(km),
    straight_line_miles: Math.round(km / 1.609),
    google_maps_directions: googleDirectionsUrl(points[0], points.at(-1)!, points.slice(1, -1)),
    superchargers:
      chargers === null
        ? "The charger map did not answer; suggest the Tesla app's trip planner."
        : chargers.slice(0, 25).map((c) => ({
            name: c.name,
            stalls: c.stalls,
            max_kw: c.kw,
            navigate: `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}&travelmode=driving`,
          })),
    note: "Superchargers come from OpenStreetMap and may miss new sites; the Tesla app's trip planner adds live stall availability.",
  });
}

async function help(ctx: ToolContext, input: z.infer<typeof Inputs.nearby_help>): Promise<string> {
  let at = ctx.location;
  if (input.near) {
    const p = await resolvePlaceText(ctx.db, input.near);
    if (p) at = { lat: p.lat, lng: p.lng };
  }
  if (!at) {
    return JSON.stringify({
      error: "No location. Ask the traveler to tap Share location, or to say where they are.",
      if_life_threatening: "911 in the US and Canada; 112 from any mobile phone in most other countries.",
    });
  }
  const [country, places] = await Promise.all([countryAt(at.lat, at.lng), nearbyHelp(at.lat, at.lng).catch(() => null)]);
  return JSON.stringify({
    country,
    emergency_number: emergencyNumber(country),
    us_citizens_abroad: country && country !== "US" ? STATE_DEPARTMENT_EMERGENCY : undefined,
    places: places ?? "The map service did not answer; use web search for the nearest hospital.",
  });
}

async function weather(db: SupabaseClient, input: z.infer<typeof Inputs.weather>): Promise<string> {
  const p = await resolvePlaceText(db, input.place);
  if (!p) return JSON.stringify({ error: `Not found on the map: ${input.place}` });
  const forecast = await weekForecast(p.lat, p.lng);
  return JSON.stringify(forecast ? { place: p.address ?? p.name, ...forecast } : { error: "The weather service did not answer" });
}

// Acting -------------------------------------------------------------------------

const geocodeCity = cachedGeocoder(openMeteoGeocoder);

async function addTripItem(ctx: ToolContext, item: TripItem): Promise<string> {
  const input = CreateSegmentSchema.safeParse(tripItemToSegment(item));
  if (!input.success) return JSON.stringify({ error: `That item is not complete: ${input.error.message}` });
  const { values, reasons } = await buildManualSegment(ctx.db, input.data, { geocodeAddress, geocodeCity, timezoneAt });
  if (!values.start_at) return JSON.stringify({ error: "Could not work out the start time; check the place and the date." });
  const { data, error } = await ctx.db.from("segments").insert({ ...values, user_id: ctx.userId }).select("id").single();
  if (error) {
    return JSON.stringify({ error: error.code === "23505" ? "This booking is already in the app." : error.message });
  }
  await regroupUser(ctx.db, ctx.userId);
  const { data: placed } = await ctx.db.from("segments").select("trip_id").eq("id", data.id).single();
  const href = placed?.trip_id ? `/trips/${placed.trip_id}` : "/review";
  ctx.onAction({ label: `Added: ${item.summary}`, href });
  return JSON.stringify({ segment_id: data.id, trip_id: placed?.trip_id ?? null, needs_review: reasons, open_in_app: href });
}

async function loadSegment(db: SupabaseClient, segmentId: string): Promise<Segment | null> {
  const { data } = await db.from("segments").select("*").eq("id", segmentId).maybeSingle();
  return (data as Segment | null) ?? null;
}

async function updateTripItem(ctx: ToolContext, input: z.infer<typeof ItemEdit>): Promise<string> {
  const seg = await loadSegment(ctx.db, input.segment_id);
  if (!seg) return JSON.stringify({ error: "No such booking; call get_trips for the ids." });
  const placeEdit = (v: string | undefined) => {
    if (v === undefined) return undefined;
    if (seg.type === "flight" && IATA.test(v)) return { code: v.toUpperCase(), name: null, city: null, address: null };
    if (seg.type === "train") return { city: v, name: null, code: null, address: null };
    return { address: v, name: null, code: null, city: null };
  };
  const details: Record<string, string> = {};
  for (const key of ["flight_number", "property_name", "note"] as const) if (input[key] !== undefined) details[key] = input[key]!;
  const edit = SegmentEditSchema.parse({
    action: "save",
    provider: input.provider,
    confirmation_code: input.confirmation_code,
    start_local: input.start_local,
    end_local: input.end_local,
    origin: placeEdit(input.from),
    destination: placeEdit(input.to),
    details,
  });
  const { values, reasons } = await applySegmentEdit(seg, edit, geocodeCity);
  const { error } = await ctx.db.from("segments").update(values).eq("id", seg.id);
  if (error) return JSON.stringify({ error: error.code === "23505" ? "Another booking already has this code and start time." : error.message });
  await regroupUser(ctx.db, ctx.userId);
  ctx.onAction({ label: "Updated a booking", href: seg.trip_id ? `/trips/${seg.trip_id}` : "/review" });
  return JSON.stringify({ updated: seg.id, review_reasons: reasons });
}

async function cancelTripItem(ctx: ToolContext, segmentId: string): Promise<string> {
  const seg = await loadSegment(ctx.db, segmentId);
  if (!seg) return JSON.stringify({ error: "No such booking; call get_trips for the ids." });
  const { error } = await ctx.db.from("segments").update({ status: "cancelled" }).eq("id", seg.id);
  if (error) return JSON.stringify({ error: error.message });
  ctx.onAction({ label: "Marked a booking cancelled", href: seg.trip_id ? `/trips/${seg.trip_id}` : null });
  return JSON.stringify({ cancelled: seg.id });
}

async function deleteTripItem(ctx: ToolContext, segmentId: string): Promise<string> {
  const seg = await loadSegment(ctx.db, segmentId);
  if (!seg) return JSON.stringify({ error: "No such booking; call get_trips for the ids." });
  const { error } = await ctx.db.from("segments").delete().eq("id", seg.id);
  if (error) return JSON.stringify({ error: error.message });
  await regroupUser(ctx.db, ctx.userId);
  ctx.onAction({ label: "Removed a booking", href: null });
  return JSON.stringify({ deleted: seg.id });
}

async function renameTrip(ctx: ToolContext, input: z.infer<typeof Inputs.rename_trip>): Promise<string> {
  const { data, error } = await ctx.db
    .from("trips")
    .update({ title: input.title, title_locked: true })
    .eq("id", input.trip_id)
    .select("id")
    .maybeSingle();
  if (error) return JSON.stringify({ error: error.message });
  if (!data) return JSON.stringify({ error: "No such trip; call get_trips for the ids." });
  ctx.onAction({ label: `Renamed the trip: ${input.title}`, href: `/trips/${input.trip_id}` });
  return JSON.stringify({ renamed: input.trip_id });
}

async function addSavedPlace(ctx: ToolContext, input: z.infer<typeof Inputs.add_saved_place>): Promise<string> {
  const geo = await geocodeAddress(input.address);
  const { error } = await ctx.db.from("places").insert({
    user_id: ctx.userId,
    label: input.label,
    address: input.address,
    kind: input.kind,
    city: geo?.city ?? null,
    country: geo?.country ?? null,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    tz: geo?.tz ?? null,
  });
  if (error) return JSON.stringify({ error: error.message });
  ctx.onAction({ label: `Saved place: ${input.label}`, href: "/settings" });
  return JSON.stringify({ saved: input.label, found_on_map: !!geo });
}

async function addTraveler(ctx: ToolContext, input: z.infer<typeof Inputs.add_traveler>): Promise<string> {
  const { error } = await ctx.db.from("travelers").insert({
    user_id: ctx.userId,
    name: input.name,
    relation: input.relation,
    name_variants: (input.name_variants ?? []).map((v) => v.toUpperCase()),
  });
  if (error) return JSON.stringify({ error: error.message });
  ctx.onAction({ label: `Added traveler: ${input.name}`, href: "/settings" });
  return JSON.stringify({ added: input.name });
}

async function remember(ctx: ToolContext, note: string): Promise<string> {
  const { data, error } = await ctx.db.from("atlas_notes").insert({ user_id: ctx.userId, note }).select("id").single();
  if (error) return JSON.stringify({ error: error.message });
  ctx.onAction({ label: `Remembered: ${note.length > 60 ? `${note.slice(0, 57)}…` : note}`, href: null });
  return JSON.stringify({ saved: data.id });
}

async function forget(ctx: ToolContext, noteId: string): Promise<string> {
  const { data, error } = await ctx.db.from("atlas_notes").delete().eq("id", noteId).select("id");
  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ error: "No such note" });
  ctx.onAction({ label: "Forgot a note", href: null });
  return JSON.stringify({ deleted: noteId });
}

// Dispatch -----------------------------------------------------------------------

export async function runTool(block: Anthropic.Beta.BetaToolUseBlock, ctx: ToolContext): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const result = (content: string, isError = false): Anthropic.Beta.BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    content,
    ...(isError ? { is_error: true } : {}),
  });
  const name = block.name as ToolName;
  if (!(name in Inputs)) return result(`Unknown tool ${block.name}`, true);
  // Tool inputs stream without server-side validation, so check them here.
  const parsed = Inputs[name].safeParse(block.input);
  if (!parsed.success) return result(`Invalid input: ${parsed.error.message}`, true);
  const input = parsed.data as never;
  try {
    switch (name) {
      case "get_trips":
        return result(await getTrips(ctx.db));
      case "weather":
        return result(await weather(ctx.db, input));
      case "convert_currency": {
        const { amount, from, to } = input as z.infer<typeof Inputs.convert_currency>;
        const conversion = await convertCurrency(amount, from, to);
        return conversion ? result(JSON.stringify(conversion)) : result("No rate for that currency pair", true);
      }
      case "plan_drive":
        return result(await planDrive(ctx.db, input));
      case "nearby_help":
        return result(await help(ctx, input));
      case "flight_booking_links":
        return result(JSON.stringify(flightLinks(input)));
      case "hotel_booking_links":
        return result(JSON.stringify(hotelLinks(input)));
      case "car_rental_links":
        return result(JSON.stringify(carLinks(input)));
      case "add_trip_item":
        return result(await addTripItem(ctx, input));
      case "update_trip_item":
        return result(await updateTripItem(ctx, input));
      case "cancel_trip_item":
        return result(await cancelTripItem(ctx, (input as { segment_id: string }).segment_id));
      case "delete_trip_item":
        return result(await deleteTripItem(ctx, (input as { segment_id: string }).segment_id));
      case "rename_trip":
        return result(await renameTrip(ctx, input));
      case "add_saved_place":
        return result(await addSavedPlace(ctx, input));
      case "add_traveler":
        return result(await addTraveler(ctx, input));
      case "remember":
        return result(await remember(ctx, (input as { note: string }).note));
      case "forget":
        return result(await forget(ctx, (input as { note_id: string }).note_id));
    }
  } catch (err) {
    return result(err instanceof Error ? err.message : "The tool failed", true);
  }
}
