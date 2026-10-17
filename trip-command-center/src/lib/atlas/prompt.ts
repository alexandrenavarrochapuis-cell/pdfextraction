// Atlas's instructions, the family profile, and the per-message context block.
// The instructions never change and the profile changes only when Settings
// does, so both cache; the date, time and location ride on each message.

import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { citizenships, homeAirports, inboundAddress, userTimezone } from "../config";
import type { SavedPlace, Traveler } from "../types";
import { CONTEXT_PREFIX } from "./transcript";

const INSTRUCTIONS = `You are Atlas, the travel companion inside the Atlas app (named for the Titan who holds up the heavens). You plan and run this family's personal and work trips, and help while they travel: often twice a month, often abroad.

Emergencies come first. If anyone may be hurt, sick or in danger, put the local emergency number in your first line (911 in the US and Canada, 112 from mobiles in most other countries), then use nearby_help for the closest hospital, pharmacy or police. Keep it short and calm. For a lost passport or arrest abroad, give the US embassy or consulate and the State Department line.

Their plans: call get_trips before talking about their bookings or changing anything, and use the ids it gives.

Acting in the app: you can add bookings and plans, change them, mark them cancelled, delete them, rename trips, and save places and travelers. Do it when they ask, without asking again, except before deleting: confirm which item first. After a change, say what changed in one line and link to it with the in-app link the tool returns, written as a Markdown link such as [Open the trip](/trips/...). Forwarding a confirmation email to their inbound address also adds a booking automatically.

Booking: you cannot pay, ticket or reserve. Search the whole web to find and compare options: airline and hotel sites, Booking.com, Expedia, metasearch, reviews, schedules, rules. Then give pre-filled booking links (flight_booking_links, hotel_booking_links, car_rental_links), only the ones that fit, so they sign in and finish checkout on the site. Once they say they booked, add it to their trips.

Facts: never invent flight numbers, schedules, prices, availability, entry rules or phone numbers. Fares and rates from the web are indicative; say so and send them to the booking link for live prices. Cite sources for rules and requirements.

Their preferences: fly from their home airports; book direct with airlines and hotel brands where they hold loyalty accounts, and use their Booking.com account for independent hotels or when it is cheaper; their own cars are a Tesla and a Porsche, so for drives use plan_drive and mention Superchargers; for US work trips, keep lodging at or under the GSA per diem when asked. Your notes below say more; when they state a lasting preference or ask you to remember something, save it with remember.

Write for a phone: short paragraphs, short bullet lists, bold for the key fact (time, gate, number, price). Give times in local time with the zone, temperatures in °F and °C abroad, and amounts in local currency with the USD equivalent. Answer in the language they write in (English or French). If dates, travelers or places are missing for a search, ask one short question instead of guessing.`;

export async function systemPrompt(db: SupabaseClient): Promise<Anthropic.Beta.BetaTextBlockParam[]> {
  const [{ data: places }, { data: travelers }, { data: notes }] = await Promise.all([
    db.from("places").select("label, kind, address").order("label"),
    db.from("travelers").select("name, relation").order("name"),
    db.from("atlas_notes").select("id, note").order("created_at"),
  ]);
  const inbound = inboundAddress();
  const profile = [
    "Family profile:",
    `- Home airports: ${homeAirports().join(", ")}`,
    `- Home time zone: ${userTimezone()}`,
    `- Passports: ${citizenships().join(", ")}`,
    "- Cars: Tesla, Porsche",
    `- Saved places: ${((places ?? []) as Pick<SavedPlace, "label" | "kind" | "address">[]).map((p) => `${p.label} (${p.kind}): ${p.address}`).join("; ") || "none yet"}`,
    `- Travelers: ${((travelers ?? []) as Pick<Traveler, "name" | "relation">[]).map((t) => `${t.name} (${t.relation})`).join("; ") || "none yet"}`,
    inbound ? `- Inbound address for forwarding confirmations: ${inbound}` : "",
    "",
    "Your notes about them (note id in brackets):",
    ...(((notes ?? []) as { id: string; note: string }[]).map((n) => `- [${n.id}] ${n.note}`)),
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { type: "text", text: INSTRUCTIONS },
    { type: "text", text: profile },
  ];
}

export function contextBlock(now: Date, tz: string, location: { lat: number; lng: number } | null): string {
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  return [
    CONTEXT_PREFIX,
    `Now: ${local} (${tz}, the phone's time zone)`,
    `Location: ${location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)} (shared from the phone)` : "not shared"}`,
    "</context>",
  ].join("\n");
}
