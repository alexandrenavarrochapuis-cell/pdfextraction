// Flight map geometry and the tracker view.

import { describe, expect, it } from "vitest";
import { bearing, greatCirclePath, interpolateGreatCircle, scheduleEstimate, trackingLinks } from "@/lib/flight/track";
import { buildTrackView } from "@/lib/flight/view";
import type { LiveTrack } from "@/lib/flight/aeroapi";
import { segment } from "./helpers";

const JFK = { lat: 40.6413, lng: -73.7781 };
const LHR = { lat: 51.47, lng: -0.4543 };

describe("geometry", () => {
  it("keeps endpoints and bends north on a transatlantic great circle", () => {
    expect(interpolateGreatCircle(JFK, LHR, 0).lat).toBeCloseTo(JFK.lat, 6);
    expect(interpolateGreatCircle(JFK, LHR, 1).lng).toBeCloseTo(LHR.lng, 6);
    expect(interpolateGreatCircle(JFK, LHR, 0.5).lat).toBeGreaterThan(51.5);
    expect(bearing(JFK, LHR)).toBeGreaterThan(40);
    expect(bearing(JFK, LHR)).toBeLessThan(60);
  });

  it("draws a route over the antimeridian without jumping across the map", () => {
    const path = greatCirclePath({ lat: 35.55, lng: 139.78 }, { lat: 21.32, lng: -157.92 });
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i].lng - path[i - 1].lng)).toBeLessThan(10);
  });

  it("estimates phase and progress from the schedule", () => {
    const dep = Date.parse("2027-06-24T21:45:00Z");
    const arr = Date.parse("2027-06-25T06:05:00Z");
    expect(scheduleEstimate(dep, arr, dep - 3 * 3600_000).phase).toBe("scheduled");
    expect(scheduleEstimate(dep, arr, dep - 30 * 60_000).phase).toBe("boarding");
    const mid = scheduleEstimate(dep, arr, (dep + arr) / 2);
    expect(mid.phase).toBe("en_route");
    expect(mid.progress).toBeCloseTo(0.5, 5);
    expect(scheduleEstimate(dep, arr, arr + 1).phase).toBe("landed");
  });

  it("builds tracking links from the flight number", () => {
    expect(trackingLinks("DL 84")).toEqual({
      flightaware: "https://www.flightaware.com/live/flight/DL84",
      flightradar24: "https://www.flightradar24.com/data/flights/dl84",
    });
  });
});

describe("tracker view", () => {
  const flight = segment({
    id: "dl84",
    type: "flight",
    start_at: "2027-06-24T21:45:00Z",
    start_tz: "America/New_York",
    end_at: "2027-06-25T06:05:00Z",
    end_tz: "Europe/Paris",
    origin: { code: "ATL" },
    destination: { code: "CDG" },
    details: { flight_number: "DL 84" },
  });

  it("places an estimated plane mid-route without a live feed", () => {
    const view = buildTrackView(flight, null, new Date("2027-06-25T01:55:00Z"), false)!;
    expect(view.phase).toBe("en_route");
    expect(view.plane?.source).toBe("estimate");
    expect(view.progress).toBeCloseTo(0.5, 2);
    expect(view.plane!.lat).toBeGreaterThan(45);
    expect(view.inbound).toBeNull();
    expect(view.title).toBe("DL 84 · ATL → CDG");
  });

  it("shows no plane before departure without a live feed", () => {
    const view = buildTrackView(flight, null, new Date("2027-06-24T18:00:00Z"), false)!;
    expect(view.phase).toBe("scheduled");
    expect(view.plane).toBeNull();
  });

  const times = (scheduled: string | null, estimated: string | null = null, actual: string | null = null) => ({
    scheduled,
    estimated,
    actual,
  });
  const live = (over: Partial<LiveTrack["flight"]>): LiveTrack["flight"] => ({
    fa_flight_id: "x",
    ident: "DL84",
    status: null,
    cancelled: false,
    diverted: false,
    progress_percent: null,
    origin: { code: "ATL", name: null },
    destination: { code: "CDG", name: null },
    departure: times("2027-06-24T21:45:00Z"),
    arrival: times("2027-06-25T06:05:00Z"),
    gate_origin: null,
    terminal_origin: null,
    gate_destination: null,
    terminal_destination: null,
    baggage_claim: null,
    aircraft_type: null,
    registration: null,
    inbound_fa_flight_id: null,
    position: null,
    ...over,
  });

  it("follows the inbound aircraft before boarding", () => {
    const track: LiveTrack = {
      flight: live({ status: "Scheduled", gate_origin: "F7" }),
      inbound: live({
        ident: "DL83",
        origin: { code: "CDG", name: "Paris" },
        departure: times("2027-06-24T09:00:00Z", null, "2027-06-24T09:10:00Z"),
        arrival: times("2027-06-24T19:00:00Z", "2027-06-24T19:20:00Z"),
        position: { lat: 40, lng: -60, altitude_ft: 37000, groundspeed_kt: 480, heading: 250, at: "2027-06-24T17:00:00Z" },
      }),
    };
    const view = buildTrackView(flight, track, new Date("2027-06-24T17:00:00Z"), true)!;
    expect(view.phase).toBe("scheduled");
    expect(view.inbound?.ident).toBe("DL83");
    expect(view.inbound?.plane?.source).toBe("live");
    expect(view.inbound?.origin?.code).toBe("CDG");
    expect(view.live?.gate_origin).toBe("F7");
  });

  it("uses the live position in the air and drops the inbound leg", () => {
    const track: LiveTrack = {
      flight: live({
        departure: times("2027-06-24T21:45:00Z", null, "2027-06-24T22:05:00Z"),
        progress_percent: 40,
        position: { lat: 45, lng: -45, altitude_ft: 36000, groundspeed_kt: 500, heading: 60, at: null },
      }),
      inbound: live({ ident: "DL83" }),
    };
    const view = buildTrackView(flight, track, new Date("2027-06-25T01:00:00Z"), true)!;
    expect(view.phase).toBe("en_route");
    expect(view.progress).toBeCloseTo(0.4);
    expect(view.plane).toMatchObject({ lat: 45, lng: -45, source: "live", heading: 60 });
    expect(view.inbound).toBeNull();
  });

  it("reports landed once the live feed has an actual arrival", () => {
    const track: LiveTrack = {
      flight: live({ arrival: times("2027-06-25T06:05:00Z", null, "2027-06-25T05:58:00Z"), baggage_claim: "21" }),
      inbound: null,
    };
    const view = buildTrackView(flight, track, new Date("2027-06-25T06:30:00Z"), true)!;
    expect(view.phase).toBe("landed");
    expect(view.live?.baggage_claim).toBe("21");
    expect(view.plane?.lat).toBeCloseTo(49.0097, 3);
  });
});
