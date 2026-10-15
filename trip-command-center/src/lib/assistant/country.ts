// Country brief: what to know before entering a country, researched by
// Claude on official government sites only, then cached per country.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod/v4";
import { citizenships } from "../config";
import { research, structure } from "./research";
import { countryName } from "./countries";

export { countryName, tripCountries } from "./countries";

export const OFFICIAL_DOMAINS = [
  "travel.state.gov",
  "state.gov",
  "usembassy.gov",
  "cdc.gov",
  "cbp.gov",
  "tsa.gov",
  "diplomatie.gouv.fr",
  "ambafrance.org",
  "france-visas.gouv.fr",
  "douane.gouv.fr",
  "europa.eu",
  "who.int",
];

export const CountryBriefSchema = z.object({
  country: z.string(),
  advisory: z.string().nullable().describe("US State Department advisory level and one-line reason"),
  entry: z.array(
    z.object({
      citizenship: z.string().describe("Passport country name"),
      passport_validity: z.string().nullable(),
      visa: z.string().nullable().describe("Visa, ETIAS, eTA or none, with stay limits"),
      other: z.array(z.string()),
    }),
  ),
  customs_allowed: z.array(z.string()).describe("Duty-free allowances: alcohol, tobacco, gifts"),
  customs_restricted: z.array(z.string()),
  customs_prohibited: z.array(z.string()),
  currency_declaration: z.string().nullable(),
  returning_to_us: z.array(z.string()).describe("What to know when bringing things back into the US"),
  vaccines_required: z.array(z.string()),
  vaccines_recommended: z.array(z.string()),
  health_notes: z.array(z.string()),
  emergency_numbers: z.array(z.object({ service: z.string(), number: z.string() })),
  embassies: z.array(
    z.object({
      for_citizens: z.string(),
      name: z.string(),
      address: z.string().nullable(),
      phone: z.string().nullable(),
      emergency_phone: z.string().nullable(),
      website: z.string().nullable(),
    }),
  ),
  practical: z.array(z.string()).describe("Plugs and voltage, currency, driving side, tipping"),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});
export type CountryBrief = z.infer<typeof CountryBriefSchema> & { generated_at: string };

export async function generateCountryBrief(client: Anthropic, code: string): Promise<CountryBrief> {
  const country = countryName(code);
  const passports = citizenships().map(countryName);
  const ownCountry = citizenships().includes(code);
  const notes = await research(client, {
    allowedDomains: OFFICIAL_DOMAINS,
    maxSearches: 15,
    system:
      "You research official government travel information for a traveler's personal travel assistant. Prefer the most recent official pages, say when a rule recently changed or is about to, and include each page's URL.",
    prompt: [
      `Prepare a travel brief for ${country} (${code}) for a traveler living in Florida, United States, who holds ${passports.join(" and ")} passport${passports.length > 1 ? "s" : ""}.`,
      ownCountry ? `${country} is one of the traveler's own citizenships, so entry for that passport is a citizen's return.` : "",
      "Cover, with figures where they exist:",
      "1. Entry requirements for each passport: passport validity, visa or travel authorization (such as ETIAS or eTA) and stay limits, other documents.",
      "2. Customs on arrival: duty-free allowances, restricted and prohibited items, currency declaration threshold.",
      "3. Returning to the US: what CBP restricts or prohibits from this country (food, plants, medicines) and duty-free allowance.",
      "4. Health: required and recommended vaccines per CDC, other health notes.",
      "5. Emergency numbers (police, ambulance, fire, general).",
      `6. Embassies in ${country} for each passport held${ownCountry ? ` (skip ${country}'s own)` : ""}: name, street address, phone, after-hours emergency phone, website.`,
      "7. US State Department advisory level.",
      "8. Practical: plug type and voltage, currency, driving side, tipping.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  const brief = await structure(
    client,
    CountryBriefSchema,
    `Fill the country brief for ${country}.`,
    notes,
  );
  return { ...brief, generated_at: new Date().toISOString() };
}

/** Research a country and store the result; failures are recorded on the row. */
export async function runCountryBrief(db: SupabaseClient, userId: string, code: string, client = new Anthropic()) {
  try {
    const payload = await generateCountryBrief(client, code);
    await db
      .from("country_briefs")
      .update({ status: "ready", payload, error: null, generated_at: payload.generated_at })
      .eq("user_id", userId)
      .eq("country_code", code);
  } catch (err) {
    await db
      .from("country_briefs")
      .update({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .eq("user_id", userId)
      .eq("country_code", code);
  }
}
