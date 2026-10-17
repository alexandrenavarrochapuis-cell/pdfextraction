// Acceptance criteria from spec section 11 that live in pure logic:
// hotel and car for the same city join the flights' trip, a changed flight
// updates in place, a cancellation marks the segment cancelled, and the trip
// gets the "Paris, Jun 24 to Jul 14" title.

import { describe, expect, it } from "vitest";
import { extractSegments } from "@/lib/ingest/extract";
import { planSegmentWrites, type SegmentValues } from "@/lib/trips/apply";
import { planGrouping, summarizeTrip } from "@/lib/trips/grouping";
import { buildTimeline } from "@/lib/timeline";
import type { Segment, Trip } from "@/lib/types";
import { cannedClaude, loadEml, segment, stubGeocoder, synthetic } from "./helpers";

const HOME = { homeAirports: ["SRQ", "TPA"] };

/** In-memory stand-in for the segments table. */
class Store {
  segments: Segment[] = [];
  private id = 0;
  apply(writes: ReturnType<typeof planSegmentWrites>) {
    for (const w of writes) {
      if (w.op === "insert") {
        this.segments.push(segment({ ...(w.values as SegmentValues), id: `db-${++this.id}` }));
      } else {
        Object.assign(this.segments.find((s) => s.id === w.id)!, w.values);
      }
    }
  }
  async ingest(name: string) {
    const path = synthetic(name);
    const { email } = await loadEml(path);
    const result = await extractSegments(email, { claude: cannedClaude(path), geocode: stubGeocoder });
    const writes = planSegmentWrites(result.segments, this.segments, `email-${name}`);
    this.apply(writes);
    return writes;
  }
}

function groupedTrips(store: Store, trips: Trip[] = []) {
  const plan = planGrouping(store.segments, trips, HOME);
  return plan.trips.map((t) => t.segmentIds.map((id) => store.segments.find((s) => s.id === id)!));
}

describe("ingest, dedupe and grouping across a Paris round trip", () => {
  it("puts the flights, hotel and car for Paris in one trip with a Paris title", async () => {
    const store = new Store();
    await store.ingest("delta-paris-roundtrip.eml");
    await store.ingest("marriott-paris.eml");
    await store.ingest("hertz-paris.eml");
    expect(store.segments).toHaveLength(6);

    const trips = groupedTrips(store);
    expect(trips).toHaveLength(1);
    const summary = summarizeTrip(trips[0], { ...HOME, fallbackTz: "America/New_York", now: new Date("2027-05-01T00:00:00Z") });
    expect(summary.primary_city).toBe("Paris");
    expect(summary.title).toBe("Paris, Jun 24 to Jul 14");
    expect(summary.status).toBe("upcoming");
  });

  it("updates the changed flight in place instead of adding a duplicate", async () => {
    const store = new Store();
    await store.ingest("delta-paris-roundtrip.eml");
    const before = store.segments.find((s) => s.details.flight_number === "DL 84")!;
    const writes = await store.ingest("delta-schedule-change.eml");

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ op: "update", id: before.id });
    expect(store.segments).toHaveLength(4);
    const after = store.segments.find((s) => s.id === before.id)!;
    expect(after.start_at).toBe("2027-06-24T22:30:00.000Z");
    expect(after.status).toBe("confirmed");
    // Fields the change email did not mention survive.
    expect(after.details.seat).toBe("24A");
  });

  it("marks a cancelled rental as cancelled, and it no longer stretches the trip", async () => {
    const store = new Store();
    await store.ingest("delta-paris-roundtrip.eml");
    await store.ingest("marriott-paris.eml");
    await store.ingest("hertz-paris.eml");
    await store.ingest("hertz-paris-cancel.eml");
    const car = store.segments.find((s) => s.type === "car")!;
    expect(car.status).toBe("cancelled");
    expect(store.segments).toHaveLength(6);
    expect(groupedTrips(store)).toHaveLength(1);
  });

  it("is idempotent when the same email arrives twice", async () => {
    const store = new Store();
    await store.ingest("marriott-paris.eml");
    const writes = await store.ingest("marriott-paris.eml");
    expect(writes.every((w) => w.op === "update")).toBe(true);
    expect(store.segments).toHaveLength(1);
  });

  it("lays the timeline out by local day, with hotel check-in and check-out entries", async () => {
    const store = new Store();
    await store.ingest("delta-paris-roundtrip.eml");
    await store.ingest("marriott-paris.eml");
    const { days } = buildTimeline(store.segments);
    expect(days.map((d) => d.dateKey)).toEqual(["2027-06-24", "2027-06-25", "2027-07-14"]);
    expect(days[1].entries.map((e) => e.kind)).toEqual(["check_in"]);
    // The 10:30 departure comes before the hotel's default 11:00 check-out.
    expect(days[2].entries.map((e) => e.kind)).toEqual(["single", "check_out", "single"]);
  });
});

describe("grouping rules", () => {
  const flight = (id: string, from: string, to: string, start: string, end: string, extra: Partial<Segment> = {}) =>
    segment({
      id,
      type: "flight",
      origin: { code: from },
      destination: { code: to },
      start_at: start,
      end_at: end,
      start_tz: "America/New_York",
      end_tz: "America/New_York",
      ...extra,
    });

  it("ends a trip when a flight lands at a home airport, even if the next one leaves the next day", () => {
    const segs = [
      flight("a", "TPA", "BOS", "2027-03-01T13:00:00Z", "2027-03-01T16:00:00Z"),
      flight("b", "BOS", "TPA", "2027-03-03T13:00:00Z", "2027-03-03T16:00:00Z"),
      flight("c", "SRQ", "ATL", "2027-03-04T13:00:00Z", "2027-03-04T15:00:00Z"),
    ];
    const plan = planGrouping(segs, [], HOME);
    expect(plan.trips.map((t) => t.segmentIds)).toEqual([["a", "b"], ["c"]]);
  });

  it("splits segments more than 48 hours apart in different cities", () => {
    const segs = [
      flight("a", "TPA", "BOS", "2027-03-01T13:00:00Z", "2027-03-01T16:00:00Z"),
      flight("b", "BOS", "ORD", "2027-03-05T13:00:00Z", "2027-03-05T16:00:00Z"),
    ];
    expect(planGrouping(segs, [], HOME).trips).toHaveLength(2);
  });

  it("joins a later booking in a city the trip already visits", () => {
    const segs = [
      flight("a", "TPA", "CDG", "2027-06-24T21:00:00Z", "2027-06-25T06:00:00Z"),
      segment({
        id: "e",
        type: "event",
        destination: { city: "Paris" },
        start_at: "2027-07-01T18:00:00Z",
        start_tz: "Europe/Paris",
      }),
    ];
    expect(planGrouping(segs, [], HOME).trips).toHaveLength(1);
  });

  it("keeps a locked (manually merged) trip together and reuses existing trip ids", () => {
    const segs = [
      flight("a", "TPA", "BOS", "2027-03-01T13:00:00Z", "2027-03-01T16:00:00Z", { trip_id: "t-locked" }),
      flight("b", "BOS", "ORD", "2027-03-09T13:00:00Z", "2027-03-09T16:00:00Z", { trip_id: "t-locked" }),
      flight("c", "TPA", "DEN", "2027-05-01T13:00:00Z", "2027-05-01T16:00:00Z", { trip_id: "t-auto" }),
    ];
    const trips = [
      { id: "t-locked", grouping_locked: true } as Trip,
      { id: "t-auto", grouping_locked: false } as Trip,
      { id: "t-empty", grouping_locked: false } as Trip,
    ];
    const plan = planGrouping(segs, trips, HOME);
    expect(plan.trips).toEqual([
      { tripId: "t-locked", segmentIds: ["a", "b"] },
      { tripId: "t-auto", segmentIds: ["c"] },
    ]);
    expect(plan.deleteTripIds).toEqual(["t-empty"]);
  });

  it("leaves segments without a start time out of trips", () => {
    const plan = planGrouping([segment({ id: "x", status: "needs_review" })], [], HOME);
    expect(plan.trips).toEqual([]);
    expect(plan.unassignedSegmentIds).toEqual(["x"]);
  });
});
