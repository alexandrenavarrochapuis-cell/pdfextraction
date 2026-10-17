// Superchargers along a route, the whole-trip map, and airport check-in and
// baggage points.

import { describe, expect, it } from "vitest";
import { corridorBox, nearRoute, parseChargers, superchargerQuery } from "@/lib/chargers";
import { tripMapData } from "@/lib/trips/map";
import { classifyPoi } from "@/lib/airport/pois";
import type { Segment } from "@/lib/types";

const sarasota = { lat: 27.336, lng: -82.531 };
const gainesville = { lat: 29.652, lng: -82.325 };

describe("Superchargers", () => {
  it("reads Overpass results, skipping destination chargers", () => {
    const chargers = parseChargers({
      elements: [
        {
          type: "node",
          id: 1,
          lat: 28.2,
          lon: -82.4,
          tags: { amenity: "charging_station", brand: "Tesla Supercharger", name: "Wesley Chapel Supercharger", capacity: "12", "socket:nacs:output": "250 kW" },
        },
        { type: "way", id: 2, center: { lat: 28.3, lon: -82.5 }, tags: { brand: "Tesla Destination", name: "Hotel Destination charger" } },
        { type: "node", id: 1, lat: 28.2, lon: -82.4, tags: { name: "duplicate" } },
      ],
    });
    expect(chargers).toEqual([{ id: "node/1", name: "Wesley Chapel Supercharger", lat: 28.2, lng: -82.4, stalls: 12, kw: 250 }]);
  });

  it("keeps chargers near the line between stops and drops far ones", () => {
    const near = { id: "a", name: "near", lat: 28.5, lng: -82.45, stalls: null, kw: null };
    const far = { id: "b", name: "far", lat: 28.5, lng: -81.2, stalls: null, kw: null };
    expect(nearRoute([near, far], [sarasota, gainesville]).map((c) => c.id)).toEqual(["a"]);
  });

  it("boxes the corridor and refuses a continent-sized one", () => {
    const box = corridorBox([sarasota, gainesville])!;
    expect(box[0]).toBeLessThan(sarasota.lat);
    expect(box[2]).toBeGreaterThan(gainesville.lat);
    expect(superchargerQuery(box)).toContain('["brand"~"Tesla Supercharger",i]');
    expect(corridorBox([sarasota, { lat: 47.6, lng: -122.3 }])).toBeNull();
  });
});

describe("trip map", () => {
  const base = { user_id: "u", trip_id: "t", status: "confirmed", confirmation_code: null, provider: null, start_tz: null, end_tz: null, end_at: null, start_at: null, source_email_id: null, confidence: 1, review_reasons: [] };
  const segments = [
    {
      ...base,
      id: "f1",
      type: "flight",
      origin: { code: "TPA", lat: 27.98, lng: -82.53 },
      destination: { code: "CDG", lat: 49.01, lng: 2.55 },
      details: { flight_number: "DL 84" },
    },
    {
      ...base,
      id: "d1",
      type: "drive",
      origin: { name: "Home", lat: 27.336, lng: -82.531 },
      destination: { code: "TPA", lat: 27.98, lng: -82.53 },
      details: { stops: [{ name: "Lunch", lat: 27.6, lng: -82.5 }], vehicle: "Tesla" },
    },
    { ...base, id: "h1", type: "hotel", origin: null, destination: { address: "1 Rue de Rivoli, Paris", lat: 48.86, lng: 2.35 }, details: { property_name: "Hotel Rivoli" } },
    { ...base, id: "x", type: "hotel", status: "cancelled", origin: null, destination: { lat: 1, lng: 1 }, details: {} },
  ] as unknown as Segment[];

  it("draws flights and drives, marks each place once, and skips cancelled", () => {
    const data = tripMapData(segments);
    expect(data.lines.map((l) => [l.kind, l.points.length, l.label])).toEqual([
      ["flight", 2, "Flight DL 84"],
      ["drive", 3, "Drive (Tesla)"],
    ]);
    expect(data.driveIds).toEqual(["d1"]);
    expect(data.markers.map((m) => [m.kind, m.label])).toEqual([
      ["airport", "TPA"],
      ["airport", "CDG"],
      ["place", "Home"],
      ["stop", "Lunch"],
      ["stay", "Hotel Rivoli"],
    ]);
    expect(data.markers.at(-1)?.href).toBe("https://www.google.com/maps/search/?api=1&query=1%20Rue%20de%20Rivoli%2C%20Paris");
  });
});

describe("airport check-in and baggage", () => {
  it("classifies counters and carousels", () => {
    expect(classifyPoi({ aeroway: "check_in" })).toBe("checkin");
    expect(classifyPoi({ name: "Delta Ticketing" })).toBe("checkin");
    expect(classifyPoi({ amenity: "baggage_claim" })).toBe("baggage");
    expect(classifyPoi({ name: "Baggage Claim 4" })).toBe("baggage");
    expect(classifyPoi({ shop: "gift", name: "Check-in Gifts" })).toBe("shop");
  });
});
