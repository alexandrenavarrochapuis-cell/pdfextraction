// Airport map data and TSA PreCheck / Global Entry checks.

import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { classifyPoi, findGate, gateKey, overpassAreaQuery, overpassAroundQuery, parseOverpass } from "@/lib/airport/pois";
import { readPkpass } from "@/lib/passes/pkpass";
import { buildBrief } from "@/lib/brief/build";
import { airportPageUrl } from "@/lib/trips/insights";
import type { Trip } from "@/lib/types";
import { segment } from "./helpers";

describe("airport points of interest", () => {
  it("classifies OpenStreetMap tags", () => {
    expect(classifyPoi({ aeroway: "gate", ref: "F7" })).toBe("gate");
    expect(classifyPoi({ amenity: "toilets" })).toBe("restroom");
    expect(classifyPoi({ amenity: "cafe", name: "Starbucks" })).toBe("food");
    expect(classifyPoi({ name: "Delta Sky Club" })).toBe("lounge");
    expect(classifyPoi({ amenity: "bar", name: "Club Bar" })).toBe("food");
    expect(classifyPoi({ shop: "books" })).toBe("shop");
    expect(classifyPoi({ amenity: "pharmacy" })).toBe("service");
    expect(classifyPoi({ highway: "service" })).toBeNull();
  });

  it("parses nodes and way centers and keeps gate refs and levels", () => {
    const pois = parseOverpass({
      elements: [
        { type: "node", id: 1, lat: 33.64, lon: -84.43, tags: { aeroway: "gate", ref: "F07", level: "1" } },
        { type: "way", id: 2, center: { lat: 33.641, lon: -84.431 }, tags: { amenity: "toilets" } },
        { type: "node", id: 3, lat: 33.6, lon: -84.4, tags: { highway: "bus_stop" } },
      ],
    });
    expect(pois).toEqual([
      { id: "node/1", lat: 33.64, lng: -84.43, category: "gate", name: null, ref: "F07", level: "1" },
      { id: "way/2", lat: 33.641, lng: -84.431, category: "restroom", name: null, ref: null, level: null },
    ]);
  });

  it("matches gate numbers however they are written", () => {
    expect(gateKey("F 7")).toBe("F7");
    expect(gateKey("f07")).toBe("F7");
    expect(gateKey("B12A")).toBe("B12A");
    const pois = parseOverpass({ elements: [{ type: "node", id: 1, lat: 1, lon: 2, tags: { aeroway: "gate", ref: "F07" } }] });
    expect(findGate(pois, "F7")?.id).toBe("node/1");
    expect(findGate(pois, "F8")).toBeNull();
  });

  it("builds Overpass queries scoped to the airport", () => {
    expect(overpassAreaQuery("atl")).toContain('nwr["aeroway"="aerodrome"]["iata"="ATL"]->.ap;');
    expect(overpassAreaQuery("A'TL")).toContain('"iata"="ATL"');
    expect(overpassAroundQuery(33.6407, -84.4277)).toContain("(around:3000,33.64070,-84.42770)");
    expect(airportPageUrl("atl", "F7")).toBe("/airports/ATL?gate=F7");
    expect(airportPageUrl("Paris")).toBeNull();
  });
});

describe("TSA PreCheck and Global Entry", () => {
  const pass = (fields: { key: string; label: string; value: string }[]) =>
    readPkpass(zipSync({ "pass.json": strToU8(JSON.stringify({ barcodes: [{ format: "PKBarcodeFormatQR", message: "x" }], boardingPass: { auxiliaryFields: fields } })) }))!;

  it("reads the PreCheck mark from a Wallet pass", () => {
    expect(pass([{ key: "tsa", label: "", value: "TSA PRE✓" }]).tsaPrecheck).toBe(true);
    expect(pass([{ key: "seat", label: "SEAT", value: "24A" }]).tsaPrecheck).toBe(false);
  });

  it("reminds about PreCheck leaving the US and Global Entry coming back", async () => {
    const trip = { id: "t", title: "Paris" } as Trip;
    const out = segment({
      id: "o",
      start_at: "2027-06-24T21:45:00Z",
      start_tz: "America/New_York",
      end_at: "2027-06-25T06:05:00Z",
      end_tz: "Europe/Paris",
      origin: { code: "ATL" },
      destination: { code: "CDG" },
      details: { flight_number: "DL 84" },
    });
    const back = segment({
      id: "b",
      start_at: "2027-07-14T08:30:00Z",
      start_tz: "Europe/Paris",
      end_at: "2027-07-14T18:10:00Z",
      end_tz: "America/New_York",
      origin: { code: "CDG" },
      destination: { code: "ATL" },
      details: { flight_number: "DL 85" },
    });
    const common = {
      trip,
      segments: [out, back],
      homeTz: "America/New_York",
      homeAirports: ["SRQ", "TPA"],
      driveMinutes: () => 75,
      weather: async () => null,
      trustedTraveler: true,
    };
    const leaving = await buildBrief({ ...common, forDate: "2027-06-24", currentTz: "America/New_York", now: new Date("2027-06-23T23:00:00Z") });
    expect(leaving.security_tips).toEqual([
      "TSA PreCheck at ATL: use the PreCheck lane; the boarding pass should show TSA PRE.",
    ]);
    const returning = await buildBrief({ ...common, forDate: "2027-07-14", currentTz: "Europe/Paris", now: new Date("2027-07-13T17:00:00Z") });
    expect(returning.security_tips).toEqual([
      "Global Entry on arrival at ATL: use the Global Entry lane at passport control.",
    ]);
    const untrusted = await buildBrief({ ...common, trustedTraveler: false, forDate: "2027-06-24", currentTz: "America/New_York", now: new Date("2027-06-23T23:00:00Z") });
    expect(untrusted.security_tips).toEqual([]);
  });
});
