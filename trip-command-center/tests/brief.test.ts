// Day-before brief timing and content (spec section 7).

import { describe, expect, it } from "vitest";
import { buildBrief } from "@/lib/brief/build";
import { alreadyBriefed, currentTimezone, dueBriefs, type TripWithSegments } from "@/lib/brief/schedule";
import type { Trip } from "@/lib/types";
import { segment } from "./helpers";

const HOME_TZ = "America/New_York";

const trip = { id: "trip-1", title: "Paris, Jun 24 to Jul 14", start_at: "2027-06-24T17:05:00Z", end_at: "2027-07-14T21:50:00Z" } as Trip;

const segments = [
  segment({
    id: "out1",
    trip_id: "trip-1",
    confirmation_code: "G7XK2P",
    provider: "Delta Air Lines",
    start_at: "2027-06-24T17:05:00Z",
    start_tz: "America/New_York",
    end_at: "2027-06-24T18:40:00Z",
    end_tz: "America/New_York",
    origin: { code: "TPA", country: "US" },
    destination: { code: "ATL", country: "US" },
    details: { flight_number: "DL 1234", departure_terminal: "E", check_in_url: "https://www.delta.com/check-in" },
  }),
  segment({
    id: "out2",
    trip_id: "trip-1",
    start_at: "2027-06-24T21:45:00Z",
    start_tz: "America/New_York",
    end_at: "2027-06-25T06:05:00Z",
    end_tz: "Europe/Paris",
    origin: { code: "ATL", country: "US" },
    destination: { code: "CDG", city: "Paris", country: "FR", lat: 49.0097, lng: 2.5479 },
    details: { flight_number: "DL 84" },
  }),
  segment({
    id: "hotel",
    trip_id: "trip-1",
    type: "hotel",
    start_at: "2027-06-25T13:00:00Z",
    start_tz: "Europe/Paris",
    end_at: "2027-07-14T09:00:00Z",
    end_tz: "Europe/Paris",
    destination: { name: "Paris Marriott", city: "Paris", country: "FR", lat: 48.87, lng: 2.3 },
    details: { property_name: "Paris Marriott", address: "70 Avenue des Champs-Elysees, Paris", phone: "+33 1 53 93 55 00" },
  }),
  segment({
    id: "back1",
    trip_id: "trip-1",
    start_at: "2027-07-14T08:30:00Z",
    start_tz: "Europe/Paris",
    end_at: "2027-07-14T18:10:00Z",
    end_tz: "America/New_York",
    origin: { code: "CDG", country: "FR" },
    destination: { code: "ATL", country: "US" },
    details: { flight_number: "DL 85" },
  }),
  segment({
    id: "back2",
    trip_id: "trip-1",
    start_at: "2027-07-14T20:20:00Z",
    start_tz: "America/New_York",
    end_at: "2027-07-14T21:50:00Z",
    end_tz: "America/New_York",
    origin: { code: "ATL", country: "US" },
    destination: { code: "TPA", country: "US" },
    details: { flight_number: "DL 2201" },
  }),
  segment({ id: "rev", trip_id: "trip-1", type: "other", status: "needs_review", review_reasons: ["missing start time"] }),
];

const trips: TripWithSegments[] = [{ trip, segments }];
const opts = { homeTz: HOME_TZ, briefHour: 19 };

describe("brief timing", () => {
  it("waits until 7:00 p.m. Florida time the evening before departure", () => {
    expect(dueBriefs(trips, new Date("2027-06-23T22:59:00Z"), opts)).toEqual([]); // 6:59 p.m. EDT
    const due = dueBriefs(trips, new Date("2027-06-23T23:00:00Z"), opts); // 7:00 p.m. EDT
    expect(due).toHaveLength(1);
    expect(due[0].forDate).toBe("2027-06-24");
    expect(due[0].currentTz).toBe(HOME_TZ);
  });

  it("uses Paris time while Alex is in Paris", () => {
    const now = new Date("2027-07-13T17:00:00Z"); // 7:00 p.m. in Paris, 1:00 p.m. in Florida
    expect(currentTimezone(trips, now, HOME_TZ)).toBe("Europe/Paris");
    const due = dueBriefs(trips, now, opts);
    expect(due.map((d) => d.forDate)).toEqual(["2027-07-14"]);
    // An hour earlier in Paris is too early, even though it is afternoon in Florida.
    expect(dueBriefs(trips, new Date("2027-07-13T16:00:00Z"), opts)).toEqual([]);
  });

  it("does nothing on evenings before days with no segments", () => {
    expect(dueBriefs(trips, new Date("2027-07-01T17:30:00Z"), opts)).toEqual([]);
  });
});

describe("brief content", () => {
  it("covers departure, leave-home time, weather, time difference and review items in order", async () => {
    const brief = await buildBrief({
      trip,
      segments,
      forDate: "2027-06-24",
      currentTz: HOME_TZ,
      homeTz: HOME_TZ,
      homeAirports: ["SRQ", "TPA"],
      driveMinutes: (code) => ({ SRQ: 30, TPA: 75 })[code] ?? null,
      now: new Date("2027-06-23T23:00:00Z"),
      weather: async (lat, lng, tz, date) => {
        expect(tz).toBe("Europe/Paris");
        expect(date).toBe("2027-06-24");
        expect(lat).toBeCloseTo(49.0, 0);
        return { high_f: 77, low_f: 59, rain_chance: 30 };
      },
    });

    expect(brief.departure?.flight_number).toBe("DL 1234");
    expect(brief.departure?.terminal).toBe("E");
    expect(brief.departure?.international).toBe(false);
    expect(brief.departure?.check_in_opens_at).toBe("2027-06-23T17:05:00.000Z");
    // TPA -> ATL is domestic: 2h before departure plus 75 min drive to TPA.
    expect(brief.leave_by).toMatchObject({ kind: "home", buffer_minutes: 120, drive_minutes: 75, airport: "TPA" });
    expect(brief.leave_by?.at).toBe("2027-06-24T13:50:00.000Z"); // 9:50 a.m. EDT
    expect(brief.weather).toEqual({ high_f: 77, low_f: 59, rain_chance: 30, place: "Paris" });
    expect(brief.time_difference).toBe("Paris is 6 hours ahead of Florida");
    expect(brief.needs_review.map((r) => r.segment_id)).toEqual(["rev"]);
    expect(brief.push.title.replace(/\s/g, " ")).toBe("Tomorrow: DL 1234 TPA → ATL 1:05 PM");
    expect(brief.push.body).toContain("Leave home 9:50");
    expect(brief.push.body).toContain("1 item to review");
    expect(brief.segment_ids).toEqual(expect.arrayContaining(["out1"]));
  });

  it("lists the hotel check-out and the trip home on the last day", async () => {
    const brief = await buildBrief({
      trip,
      segments,
      forDate: "2027-07-14",
      currentTz: "Europe/Paris",
      homeTz: HOME_TZ,
      homeAirports: ["SRQ", "TPA"],
      driveMinutes: () => 75,
      now: new Date("2027-07-13T17:00:00Z"),
      weather: async () => null,
    });
    expect(brief.departure?.flight_number).toBe("DL 85");
    expect(brief.departure?.international).toBe(true);
    // Leaving from Paris: be at CDG 3 hours early, no home drive.
    expect(brief.leave_by).toMatchObject({ kind: "airport", buffer_minutes: 180, drive_minutes: null, tz: "Europe/Paris" });
    expect(brief.stops.map((s) => s.kind)).toEqual(["hotel_check_out"]);
    expect(brief.stops[0].address).toBe("70 Avenue des Champs-Elysees, Paris");
    expect(brief.time_difference).toMatch(/^Back on Florida time/);
  });
});

describe("brief sent once per plan", () => {
  const sent = [{ trip_id: "trip-old", for_date: "2027-06-24", segment_ids: ["out1", "out2"] }];

  it("skips segments already briefed under a trip id that has since changed", () => {
    expect(alreadyBriefed("trip-merged", "2027-06-24", ["out1", "hotel"], sent)).toBe(true);
    // The trip row was deleted, so the stored trip id is null.
    expect(alreadyBriefed("trip-merged", "2027-06-24", ["out1"], [{ ...sent[0], trip_id: null }])).toBe(true);
  });

  it("still sends other days, other segments, and leaves same-trip repeats to the claim", () => {
    expect(alreadyBriefed("trip-merged", "2027-06-25", ["out1"], sent)).toBe(false);
    expect(alreadyBriefed("trip-merged", "2027-06-24", ["back1"], sent)).toBe(false);
    expect(alreadyBriefed("trip-old", "2027-06-24", ["out1"], sent)).toBe(false);
  });
});
