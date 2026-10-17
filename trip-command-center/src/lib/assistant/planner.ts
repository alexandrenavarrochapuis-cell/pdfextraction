// AI trip planner: from a destination, dates and preferences, research
// hotels (preferred brands, review scores, distance, rate against the GSA
// lodging per diem) and how to get there from home.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod/v4";
import { homeAirports } from "../config";
import { geocodeAddress } from "../geo";
import { fetchPerDiem, stateCode, type PerDiem } from "./perdiem";
import { research, structure } from "./research";

export const PlanRequestSchema = z.object({
  destination: z.string().trim().min(3).max(300),
  purpose: z.enum(["business", "personal"]),
  start_date: z.iso.date(),
  end_date: z.iso.date(),
  travelers: z.number().int().min(1).max(12),
  brands: z.array(z.string().trim().max(40)).max(8),
  within_per_diem: z.boolean(),
  notes: z.string().trim().max(1000).optional(),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const PlanResultSchema = z.object({
  summary: z.string(),
  hotels: z.array(
    z.object({
      name: z.string(),
      brand: z.string().nullable(),
      address: z.string().nullable(),
      distance: z.string().nullable().describe("Distance or travel time to the destination"),
      review_score: z.string().nullable().describe("Score with its scale and source, e.g. 4.5/5 Google"),
      nightly_rate: z.number().nullable().describe("Typical nightly rate found for these dates, before taxes"),
      currency: z.string().nullable(),
      within_per_diem: z.boolean().nullable(),
      why: z.string(),
      url: z.string().nullable().describe("Official hotel or brand page"),
    }),
  ),
  getting_there: z.array(
    z.object({
      mode: z.enum(["fly", "drive", "train", "other"]),
      summary: z.string(),
      duration: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  advice: z.array(z.string()).describe("How to sequence the trip, timing, local transport, savings"),
  checklist: z.array(z.string()),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});
export type PlanResult = z.infer<typeof PlanResultSchema> & { per_diem: PerDiem | null };

export async function generatePlan(client: Anthropic, req: PlanRequest): Promise<PlanResult> {
  const place = await geocodeAddress(req.destination);
  const state = place?.country === "US" ? stateCode(place.region) : null;
  const perDiem =
    req.within_per_diem && place?.city && state ? await fetchPerDiem(place.city, state, new Date(`${req.start_date}T12:00:00Z`)) : null;

  const notes = await research(client, {
    maxSearches: 15,
    system:
      "You are a travel planner for a busy professional. Recommend specific, currently operating options, give real addresses, and say where each fact comes from. Do not invent prices: report rates only when a source shows them, and say they are indicative.",
    prompt: [
      `Plan a ${req.purpose} trip to: ${req.destination}${place ? ` (${[place.city, place.region, place.country].filter(Boolean).join(", ")})` : ""}.`,
      `Dates: ${req.start_date} to ${req.end_date}. Travelers: ${req.travelers}.`,
      `Home: Sarasota/Tampa, Florida. Home airports: ${homeAirports().join(", ")}. Own cars: Tesla and Porsche.`,
      req.brands.length ? `Hotel brand preference, in order: ${req.brands.join(", ")}. Include other brands only if clearly better or closer.` : "",
      perDiem
        ? `Government per diem applies: lodging cap $${perDiem.lodging} per night before taxes (GSA FY${perDiem.fiscal_year}), meals and incidentals $${perDiem.mie} per day. Prefer hotels at or under the lodging cap.`
        : req.within_per_diem
          ? "The trip should stay within government per diem; if the destination is abroad, the State Department foreign per diem applies."
          : "",
      req.notes ? `Other wishes: ${req.notes}` : "",
      "Find 3 to 6 hotels as close as practical to the destination with strong recent reviews; for each give address, distance or travel time to the destination, review score with source, an indicative nightly rate for these dates if a source shows one, and why it fits.",
      "Compare ways to get there from home: flights from the home airports (typical carriers, nonstop or connection, duration), driving (distance, time, charging notes for the Tesla), and train where it makes sense.",
      "Then advise how to sequence the trip and save time or money, and list things to prepare.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  const result = await structure(client, PlanResultSchema, "Fill the trip plan.", notes);
  if (perDiem) {
    for (const h of result.hotels) {
      if (h.nightly_rate != null && (!h.currency || h.currency === "USD")) h.within_per_diem = h.nightly_rate <= perDiem.lodging;
    }
  }
  return { ...result, per_diem: perDiem };
}

export async function runPlan(db: SupabaseClient, planId: string, req: PlanRequest, client = new Anthropic()) {
  try {
    const result = await generatePlan(client, req);
    await db.from("trip_plans").update({ status: "ready", result, completed_at: new Date().toISOString() }).eq("id", planId);
  } catch (err) {
    await db
      .from("trip_plans")
      .update({ status: "failed", error: err instanceof Error ? err.message : String(err), completed_at: new Date().toISOString() })
      .eq("id", planId);
  }
}
