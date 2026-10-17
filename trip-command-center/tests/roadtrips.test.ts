// Road trips, stops, stays and layovers.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractSegments } from "@/lib/ingest/extract";
import { planSegmentWrites, type SegmentValues } from "@/lib/trips/apply";
import { buildManualSegment } from "@/lib/trips/create";
import { planGrouping } from "@/lib/trips/grouping";
import { airbnbSearchUrl, bookingSearchUrl, findConnections, findStayGaps } from "@/lib/trips/insights";
import { googleDirectionsUrl, stayPlatform, wazeUrl } from "@/lib/present";
import type { SavedPlace, Segment } from "@/lib/types";
import { cannedClaude, loadEml, segment, stubGeocoder, synthetic } from "./helpers";

const HOME = ["SRQ", "TPA"];

async function parisTrip(withHotel = true): Promise<Segment[]> {
  const out: Segment[] = [];
  let id = 0;
  for (const name of ["delta-paris-roundtrip.eml", ...(withHotel ? ["marriott-paris.eml"] : [])]) {
    const path = synthetic(name);
    const { email } = await loadEml(path);
    const result = await extractSegments(email, { claude: cannedClaude(path), geocode: stubGeocoder });
    for (const w of planSegmentWrites(result.segments, out, name)) {
      if (w.op === "insert") out.push(segment({ ...(w.values as SegmentValues), id: `s${++id}` }));
    }
  }
  return out;
}

describe("connections", () => {
  it("finds both Atlanta layovers on the Paris trip", async () => {
    const conns = findConnections(await parisTrip());
    expect(conns.map((c) => [c.airport, c.minutes, c.tight])).toEqual([
      ["ATL", 185, false],
      ["ATL", 130, false],
    ]);
    expect(conns[0].depart_terminal).toBe("F");
  });

  it("flags a short international connection", () => {
    const a = segment({
      id: "a",
      origin: { code: "CDG" },
      destination: { code: "ATL" },
      start_at: "2027-07-14T08:30:00Z",
      start_tz: "Europe/Paris",
      end_at: "2027-07-14T18:10:00Z",
      end_tz: "America/New_York",
    });
    const b = segment({
      id: "b",
      origin: { code: "ATL" },
      destination: { code: "TPA" },
      start_at: "2027-07-14T19:20:00Z",
      start_tz: "America/New_York",
    });
    expect(findConnections([a, b])[0]).toMatchObject({ minutes: 70, tight: true });
  });
});

describe("stay gaps", () => {
  it("finds no gap when the hotel and the overnight flight cover every night", async () => {
    expect(findStayGaps(await parisTrip(), HOME)).toEqual([]);
  });

  it("finds the uncovered Paris nights and builds Booking.com and Airbnb searches", async () => {
    const gaps = findStayGaps(await parisTrip(false), HOME);
    expect(gaps).toEqual([{ city: "Paris", check_in: "2027-06-25", check_out: "2027-07-14" }]);
    expect(bookingSearchUrl(gaps[0])).toBe(
      "https://www.booking.com/searchresults.html?ss=Paris&checkin=2027-06-25&checkout=2027-07-14&group_adults=1",
    );
    expect(airbnbSearchUrl(gaps[0])).toBe("https://www.airbnb.com/s/Paris/homes?checkin=2027-06-25&checkout=2027-07-14");
  });

  it("counts an overnight stay with family as a place to sleep", () => {
    const drive = segment({
      id: "d",
      type: "drive",
      origin: { city: "Sarasota" },
      destination: { city: "Atlanta" },
      start_at: "2027-05-01T12:00:00Z",
      start_tz: "America/New_York",
      end_at: "2027-05-01T21:00:00Z",
      end_tz: "America/New_York",
    });
    const mom = segment({
      id: "m",
      type: "stop",
      destination: { city: "Atlanta" },
      details: { stop_kind: "family" },
      start_at: "2027-05-01T22:00:00Z",
      start_tz: "America/New_York",
      end_at: "2027-05-03T14:00:00Z",
      end_tz: "America/New_York",
    });
    const back = segment({
      id: "b",
      type: "drive",
      origin: { city: "Atlanta" },
      destination: { city: "Sarasota" },
      details: { ends_at_home: true },
      start_at: "2027-05-03T14:00:00Z",
      start_tz: "America/New_York",
      end_at: "2027-05-03T23:00:00Z",
      end_tz: "America/New_York",
    });
    expect(findStayGaps([drive, mom, back], HOME, ["Sarasota"])).toEqual([]);
    expect(findStayGaps([drive, back], HOME, ["Sarasota"])).toEqual([
      { city: "Atlanta", check_in: "2027-05-01", check_out: "2027-05-03" },
    ]);
  });
});

describe("road trips", () => {
  it("ends a trip when a drive reaches home", () => {
    const out = segment({
      id: "out",
      type: "drive",
      destination: { city: "Atlanta" },
      start_at: "2027-05-01T12:00:00Z",
      start_tz: "America/New_York",
    });
    const home = segment({
      id: "home",
      type: "drive",
      destination: { city: "Sarasota" },
      details: { ends_at_home: true },
      start_at: "2027-05-02T12:00:00Z",
      start_tz: "America/New_York",
    });
    const next = segment({
      id: "next",
      type: "drive",
      destination: { city: "Miami" },
      start_at: "2027-05-03T12:00:00Z",
      start_tz: "America/New_York",
    });
    expect(planGrouping([out, home, next], [], { homeAirports: HOME }).trips.map((t) => t.segmentIds)).toEqual([
      ["out", "home"],
      ["next"],
    ]);
  });

  it("builds a Google Maps route through every stop, and Waze to a coordinate", () => {
    const url = new URL(
      googleDirectionsUrl({ address: "1 Main St, Sarasota, FL" }, { address: "Atlanta, GA" }, [
        { address: "Gainesville, FL" },
        { name: "Supercharger", city: "Valdosta" },
      ]),
    );
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("origin")).toBe("1 Main St, Sarasota, FL");
    expect(url.searchParams.get("waypoints")).toBe("Gainesville, FL|Supercharger, Valdosta");
    expect(url.searchParams.get("travelmode")).toBe("driving");
    expect(wazeUrl({ lat: 33.75, lng: -84.39 })).toBe("https://waze.com/ul?ll=33.75,-84.39&navigate=yes");
  });

  it("creates a drive from a saved home place with stops, resolving zones and marking it as ending at home", async () => {
    const homePlace: SavedPlace = {
      id: "00000000-0000-4000-8000-000000000001",
      user_id: "u",
      label: "Home",
      kind: "home",
      address: "1 Main St, Sarasota, FL",
      city: "Sarasota",
      country: "US",
      lat: 27.33,
      lng: -82.53,
      tz: "America/New_York",
    };
    const fakeDb = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: homePlace, error: null }) }) }),
      }),
    } as unknown as SupabaseClient;
    const { values, reasons } = await buildManualSegment(
      fakeDb,
      {
        type: "drive",
        start_local: "2027-05-03T09:00",
        origin: { address: "Atlanta, GA" },
        stops: [{ address: "Gainesville, FL", label: "Lunch" }],
        destination: { place_id: homePlace.id },
        vehicle: "Tesla",
      },
      {
        geocodeCity: stubGeocoder,
        timezoneAt: async () => "America/New_York",
        geocodeAddress: async (a) => ({
          lat: a.startsWith("Atlanta") ? 33.75 : 29.65,
          lng: a.startsWith("Atlanta") ? -84.39 : -82.32,
          city: a.split(",")[0],
          country: "US",
          tz: "America/New_York",
        }),
      },
    );
    expect(reasons).toEqual([]);
    expect(values.start_at).toBe("2027-05-03T13:00:00.000Z");
    expect(values.details.vehicle).toBe("Tesla");
    expect(values.details.ends_at_home).toBe(true);
    expect(values.details.stops).toEqual([
      { name: "Lunch", address: "Gainesville, FL", city: "Gainesville", country: "US", lat: 29.65, lng: -82.32 },
    ]);
    expect(values.destination?.name).toBe("Home");
  });

  it("still saves a drive whose address the map cannot find, flagged for review", async () => {
    const noDb = {} as SupabaseClient;
    const { values, reasons } = await buildManualSegment(
      noDb,
      {
        type: "drive",
        start_local: "2027-05-03T09:00",
        origin: { address: "12 Nowhere Lane" },
        destination: { address: "Gainesville, FL" },
      },
      {
        geocodeCity: stubGeocoder,
        timezoneAt: async () => "America/New_York",
        geocodeAddress: async (a) =>
          a.startsWith("Gainesville") ? { lat: 29.65, lng: -82.32, city: "Gainesville", country: "US", tz: "America/New_York" } : null,
      },
    );
    // The start falls back to the destination's zone.
    expect(values.start_at).toBe("2027-05-03T13:00:00.000Z");
    expect(values.status).toBe("needs_review");
    expect(reasons).toEqual(["12 Nowhere Lane not found on the map; check the address and the time"]);
  });
});

describe("stays", () => {
  it("recognizes the booking platform", () => {
    expect(stayPlatform({ provider: "Booking.com", details: {} })).toBe("booking");
    expect(stayPlatform({ provider: "Airbnb", details: {} })).toBe("airbnb");
    expect(stayPlatform({ provider: "Marriott", details: {} })).toBeNull();
  });
});
