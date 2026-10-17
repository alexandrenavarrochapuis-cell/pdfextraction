// On-trip mode: which trip the Today card shows, what is next, where the
// traveler is, and the offline list.

import { describe, expect, it } from "vitest";
import { leaveBy } from "@/lib/brief/build";
import { currencyOf } from "@/lib/currency";
import { offlineUrlList } from "@/lib/offline";
import { formatUntil } from "@/lib/time";
import { dialable, pickTodayTrip, todayView, tripMoments, whereNow } from "@/lib/today";
import { segment } from "./helpers";

const outbound = segment({
  id: "out",
  start_at: "2027-06-24T21:45:00Z",
  start_tz: "America/New_York",
  end_at: "2027-06-25T06:05:00Z",
  end_tz: "Europe/Paris",
  origin: { code: "TPA", country: "US" },
  destination: { code: "CDG", city: "Paris", country: "FR" },
  details: { flight_number: "DL 84", departure_gate: "E7" },
});
const hotel = segment({
  id: "hotel",
  type: "hotel",
  start_at: "2027-06-25T13:00:00Z",
  start_tz: "Europe/Paris",
  end_at: "2027-06-28T09:00:00Z",
  end_tz: "Europe/Paris",
  destination: { name: "Hotel Rivoli", city: "Paris", country: "FR", lat: 48.86, lng: 2.34 },
  details: { property_name: "Hotel Rivoli", phone: "+33 1 23 45 67 89" },
});
const car = segment({
  id: "car",
  type: "car",
  start_at: "2027-06-28T10:00:00Z",
  start_tz: "Europe/Paris",
  end_at: "2027-06-30T10:00:00Z",
  end_tz: "Europe/Paris",
  origin: { name: "Gare de Lyon", city: "Paris", country: "FR" },
});
const cancelled = segment({ id: "x", type: "event", status: "cancelled", start_at: "2027-06-26T18:00:00Z", start_tz: "Europe/Paris" });
const trip = [outbound, hotel, car, cancelled];

describe("pickTodayTrip", () => {
  const now = new Date("2027-06-24T12:00:00Z");
  it("prefers a trip under way", () => {
    const trips = [
      { id: "soon", status: "upcoming" as const, start_at: "2027-06-24T20:00:00Z" },
      { id: "now", status: "active" as const, start_at: "2027-06-20T10:00:00Z" },
    ];
    expect(pickTodayTrip(trips, now)?.id).toBe("now");
  });
  it("shows a trip leaving within a day, not one leaving later", () => {
    expect(pickTodayTrip([{ id: "soon", status: "upcoming" as const, start_at: "2027-06-25T08:00:00Z" }], now)?.id).toBe("soon");
    expect(pickTodayTrip([{ id: "later", status: "upcoming" as const, start_at: "2027-06-26T08:00:00Z" }], now)).toBeNull();
    expect(pickTodayTrip([{ id: "past", status: "past" as const, start_at: "2027-06-01T08:00:00Z" }], now)).toBeNull();
  });
});

describe("todayView", () => {
  it("lists departures, check-ins, check-outs, pickups and returns, skipping cancelled items", () => {
    expect(tripMoments(trip).map((m) => `${m.segment.id}:${m.kind}`)).toEqual([
      "out:depart",
      "hotel:check_in",
      "hotel:check_out",
      "car:pickup",
      "car:return",
    ]);
  });

  it("before leaving: the flight is next and the traveler is at the departure airport", () => {
    const view = todayView(trip, new Date("2027-06-24T15:00:00Z"));
    expect(view.current).toBeNull();
    expect(view.next?.segment.id).toBe("out");
    expect(view.here?.place.code).toBe("TPA");
    expect(view.here?.country).toBe("US");
    expect(view.here?.lat).toBeCloseTo(27.9755, 3);
    expect(view.later.map((m) => m.kind)).toEqual(["check_in"]);
  });

  it("in the air: the flight is under way, Paris is where it lands, and check-in follows", () => {
    const view = todayView(trip, new Date("2027-06-25T02:00:00Z"));
    expect(view.current?.segment.id).toBe("out");
    expect(view.next?.kind).toBe("check_in");
    expect(view.here).toMatchObject({ tz: "Europe/Paris", country: "FR" });
  });

  it("at the hotel: check-out is next, then the car pickup within the day", () => {
    const view = todayView(trip, new Date("2027-06-27T20:00:00Z"));
    expect(view.next?.kind).toBe("check_out");
    expect(view.later.map((m) => m.kind)).toEqual(["pickup"]);
    expect(whereNow(trip, new Date("2027-06-27T20:00:00Z"))?.place.name).toBe("Hotel Rivoli");
  });

  it("after the last item: nothing is next", () => {
    expect(todayView(trip, new Date("2027-07-01T00:00:00Z")).next).toBeNull();
  });
});

describe("Today card helpers", () => {
  it("counts down in minutes, hours and days", () => {
    const now = new Date("2027-06-24T12:00:00Z");
    expect(formatUntil("2027-06-24T12:00:10Z", now)).toBe("now");
    expect(formatUntil("2027-06-24T12:45:00Z", now)).toBe("in 45 min");
    expect(formatUntil("2027-06-24T14:05:00Z", now)).toBe("in 2 h 5 min");
    expect(formatUntil("2027-06-24T15:00:00Z", now)).toBe("in 3 h");
    expect(formatUntil("2027-06-26T15:00:00Z", now)).toBe("in 2 days 3 h");
  });

  it("knows the local currency", () => {
    expect(currencyOf("fr")).toBe("EUR");
    expect(currencyOf("QA")).toBe("QAR");
    expect(currencyOf("GB")).toBe("GBP");
    expect(currencyOf("PR")).toBe("USD");
    expect(currencyOf(null)).toBeNull();
    expect(currencyOf("ZZ")).toBeNull();
  });

  it("dials the first emergency number", () => {
    expect(dialable("112 (ambulance 15, police 17, fire 18)")).toBe("112");
    expect(dialable("999 or 112")).toBe("999");
    expect(dialable("000 (112 from mobiles)")).toBe("000");
  });

  it("leaves home with the drive and buffer for a home-airport flight, and arrives early abroad", () => {
    const home = leaveBy(outbound, { homeAirports: ["TPA", "SRQ"], homeTz: "America/New_York", driveMinutes: () => 60 });
    // International: 3 h buffer plus a 1 h drive before 21:45Z.
    expect(home).toMatchObject({ kind: "home", at: "2027-06-24T17:45:00.000Z", drive_minutes: 60 });
    const away = leaveBy(
      segment({ start_at: "2027-06-30T12:00:00Z", start_tz: "Europe/Paris", origin: { code: "CDG", country: "FR" }, destination: { code: "NCE", country: "FR" } }),
      { homeAirports: ["TPA"], homeTz: "America/New_York", driveMinutes: () => null },
    );
    expect(away).toMatchObject({ kind: "airport", at: "2027-06-30T10:00:00.000Z", airport: "CDG" });
  });
});

describe("offlineUrlList", () => {
  it("keeps the trips ahead and their passes, not past trips", () => {
    const urls = offlineUrlList(
      [
        { id: "t1", status: "active" },
        { id: "t2", status: "upcoming" },
        { id: "t0", status: "past" },
      ],
      [
        { id: "p1", storage_path: "u/p1.pkpass", barcode_message: "M1DOE/JOHN" },
        { id: "p2", storage_path: null, barcode_message: "M1DOE/JANE" },
      ],
    );
    expect(urls).toEqual(["/", "/passes", "/trips/t1", "/trips/t2", "/passes/p1", "/api/passes/p1/file", "/passes/p2"]);
  });
});
