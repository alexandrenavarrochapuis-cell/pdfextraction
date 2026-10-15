// Per diem parsing, calendar feed, stop optimizer, trip countries.

import { describe, expect, it } from "vitest";
import { fiscalYear, parsePerDiem, stateCode } from "@/lib/assistant/perdiem";
import { buildIcs } from "@/lib/calendar/ics";
import { suggestStopOrder } from "@/lib/trips/optimize";
import { tripCountries } from "@/lib/assistant/countries";
import { segment } from "./helpers";

describe("GSA per diem", () => {
  const sample = {
    rates: [
      {
        rate: [
          {
            city: "Tampa / St. Petersburg",
            county: "Pinellas / Hillsborough",
            meals: 74,
            standardRate: "false",
            months: { month: [{ number: 1, value: 170 }, { number: 6, value: 135 }, { number: 10, value: 140 }] },
          },
          { city: "Standard Rate", meals: 68, standardRate: "true", months: { month: [{ number: 6, value: 110 }] } },
        ],
        state: "FL",
        year: 2027,
      },
    ],
  };

  it("reads the month's lodging rate and the M&IE rate for the city", () => {
    expect(parsePerDiem(sample, "Tampa", "FL", 2027, 6)).toMatchObject({ lodging: 135, mie: 74, standard_rate: false });
    expect(parsePerDiem(sample, "Tampa", "FL", 2027, 1)?.lodging).toBe(170);
    expect(parsePerDiem({ rates: [] }, "Tampa", "FL", 2027, 6)).toBeNull();
  });

  it("uses the federal fiscal year and state codes", () => {
    expect(fiscalYear(new Date("2027-09-30T12:00:00Z"))).toBe(2027);
    expect(fiscalYear(new Date("2027-10-01T12:00:00Z"))).toBe(2028);
    expect(stateCode("Florida")).toBe("FL");
    expect(stateCode("dc")).toBe("DC");
    expect(stateCode("District of Columbia")).toBe("DC");
    expect(stateCode("Île-de-France")).toBeNull();
  });
});

describe("calendar feed", () => {
  it("writes valid events without confirmation codes", () => {
    const ics = buildIcs(
      [
        segment({
          id: "seg-a",
          trip_id: "trip-1",
          confirmation_code: "SECRET1",
          start_at: "2027-06-24T21:45:00Z",
          start_tz: "America/New_York",
          end_at: "2027-06-25T06:05:00Z",
          end_tz: "Europe/Paris",
          origin: { code: "ATL", name: "Hartsfield-Jackson Atlanta International" },
          destination: { code: "CDG", name: "Paris Charles de Gaulle" },
          details: { flight_number: "DL 84" },
        }),
        segment({ id: "seg-b", status: "cancelled", type: "hotel", start_at: "2027-06-25T13:00:00Z", details: { property_name: "Hotel; Paris, Center" } }),
      ],
      "https://trips.example.com",
      new Date("2027-01-01T00:00:00Z"),
    );
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART:20270624T214500Z");
    expect(ics).toContain("DTEND:20270625T060500Z");
    expect(ics).toContain("SUMMARY:DL 84 · ATL → CDG");
    expect(ics).toContain("SUMMARY:Cancelled: Hotel\; Paris\\, Center");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).not.toContain("SECRET1");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("stop order", () => {
  const start = { name: "Sarasota", lat: 27.34, lng: -82.53 };
  const end = { name: "Atlanta", lat: 33.75, lng: -84.39 };
  const tallahassee = { name: "Tallahassee", lat: 30.44, lng: -84.28 };
  const gainesville = { name: "Gainesville", lat: 29.65, lng: -82.32 };

  it("suggests visiting Gainesville before Tallahassee on the way north", () => {
    const s = suggestStopOrder(start, [tallahassee, gainesville], end)!;
    expect(s.order).toEqual([1, 0]);
    expect(s.suggestedKm).toBeLessThan(s.currentKm);
  });

  it("stays quiet when the order is already good", () => {
    expect(suggestStopOrder(start, [gainesville, tallahassee], end)).toBeNull();
  });
});

describe("trip countries", () => {
  it("lists foreign countries from airports and places", () => {
    expect(tripCountries([segment({ origin: { code: "ATL" }, destination: { code: "CDG" } }), segment({ destination: { country: "IT" } })])).toEqual(["FR", "IT"]);
  });
});
