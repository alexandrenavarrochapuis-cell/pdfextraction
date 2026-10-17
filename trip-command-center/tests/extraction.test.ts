// Fixture emails through the real extraction path (markup parser, draft
// finalization, review rules). Claude and the geocoder are stubbed.

import { describe, expect, it } from "vitest";
import { extractSegments } from "@/lib/ingest/extract";
import { parseJsonLdReservations } from "@/lib/ingest/jsonld";
import { emailBodyText, htmlToText } from "@/lib/ingest/html";
import { parseClock } from "@/lib/ingest/draft";
import { cannedClaude, loadEml, stubGeocoder, synthetic } from "./helpers";

async function run(name: string) {
  const path = synthetic(name);
  const { email } = await loadEml(path);
  const claude = cannedClaude(path);
  const result = await extractSegments(email, { claude, geocode: stubGeocoder });
  return { result, claude };
}

describe("schema.org markup", () => {
  it("reads four Delta legs with zones from the airport table, without calling Claude", async () => {
    const { result, claude } = await run("delta-paris-roundtrip.eml");
    expect(claude.calls).toBe(0);
    expect(result.method).toBe("jsonld");
    expect(result.segments).toHaveLength(4);
    const [out1, out2, back1, back2] = result.segments;
    expect(out1.details.flight_number).toBe("DL 1234");
    expect(out1.origin?.code).toBe("TPA");
    expect(out1.start_tz).toBe("America/New_York");
    expect(out1.start_at).toBe("2027-06-24T17:05:00.000Z");
    expect(out2.details.flight_number).toBe("DL 84");
    expect(out2.end_tz).toBe("Europe/Paris");
    expect(out2.end_at).toBe("2027-06-25T06:05:00.000Z");
    expect(out2.details.departure_terminal).toBe("F");
    expect(out2.details.seat).toBe("24A");
    expect(out2.destination?.city).toBe("Paris");
    expect(back1.start_tz).toBe("Europe/Paris");
    expect(back2.destination?.code).toBe("TPA");
    for (const s of result.segments) {
      expect(s.confirmation_code).toBe("G7XK2P");
      expect(s.review_reasons).toEqual([]);
    }
  });

  it("gives a date-only hotel stay customary check-in and check-out hours in the hotel's zone", async () => {
    const { result } = await run("marriott-paris.eml");
    expect(result.method).toBe("jsonld");
    const [hotel] = result.segments;
    expect(hotel.type).toBe("hotel");
    expect(hotel.start_tz).toBe("Europe/Paris");
    expect(hotel.start_at).toBe("2027-06-25T13:00:00.000Z"); // 15:00 Paris
    expect(hotel.end_at).toBe("2027-07-14T09:00:00.000Z"); // 11:00 Paris
    expect(hotel.details.property_name).toBe("Paris Marriott Champs Elysees Hotel");
    expect(hotel.details.address).toContain("70 Avenue des Champs-Elysees");
    expect(hotel.details.phone).toBe("+33 1 53 93 55 00");
    expect(hotel.destination?.lat).toBeCloseTo(48.86, 1);
  });

  it("reads a rental car and its cancellation", async () => {
    const { result } = await run("hertz-paris.eml");
    const [car] = result.segments;
    expect(car.type).toBe("car");
    expect(car.action).toBe("confirmed");
    expect(car.details.company).toBe("Hertz");
    expect(car.details.vehicle_class).toBe("Compact (Peugeot 208)");
    expect(car.start_at).toBe("2027-07-02T07:30:00.000Z");
    expect(car.origin?.city).toBe("Paris");

    const cancel = await run("hertz-paris-cancel.eml");
    expect(cancel.result.segments[0].action).toBe("cancelled");
    expect(cancel.result.segments[0].confirmation_code).toBe("H7790122");
  });

  it("merges one reservation object per passenger into one leg", () => {
    const html = `<script type="application/ld+json">[
      {"@type":"FlightReservation","reservationNumber":"X1","underName":{"name":"A"},"airplaneSeat":"1A",
       "reservationFor":{"@type":"Flight","flightNumber":"91","airline":{"iataCode":"AF"},
       "departureAirport":{"iataCode":"CDG"},"departureTime":"2027-06-24T10:25:00+02:00",
       "arrivalAirport":{"iataCode":"MIA"},"arrivalTime":"2027-06-24T14:10:00-04:00"}},
      {"@type":"FlightReservation","reservationNumber":"X1","underName":{"name":"B"},"airplaneSeat":"1B",
       "reservationFor":{"@type":"Flight","flightNumber":"91","airline":{"iataCode":"AF"},
       "departureAirport":{"iataCode":"CDG"},"departureTime":"2027-06-24T10:25:00+02:00",
       "arrivalAirport":{"iataCode":"MIA"},"arrivalTime":"2027-06-24T14:10:00-04:00"}}
    ]</script>`;
    const drafts = parseJsonLdReservations(html);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].details.passenger_names).toEqual(["A", "B"]);
    expect(drafts[0].details.seat).toBe("1A, 1B");
    expect(drafts[0].details.flight_number).toBe("AF 91");
  });

  it("ignores malformed markup", () => {
    expect(parseJsonLdReservations('<script type="application/ld+json">{not json</script>')).toEqual([]);
  });
});

describe("Claude path", () => {
  it("uses Claude for free text and resolves zones from the airport table", async () => {
    const { result, claude } = await run("delta-schedule-change.eml");
    expect(claude.calls).toBe(1);
    expect(result.method).toBe("claude");
    const [leg] = result.segments;
    expect(leg.start_at).toBe("2027-06-24T22:30:00.000Z"); // 6:30 PM in Atlanta
    expect(leg.end_at).toBe("2027-06-25T06:50:00.000Z"); // 8:50 AM in Paris
    expect(leg.review_reasons).toEqual([]);
  });

  it("returns nothing for marketing mail", async () => {
    const { result } = await run("airline-newsletter.eml");
    expect(result.isTravel).toBe(false);
    expect(result.segments).toEqual([]);
  });

  it("flags low confidence and missing fields for review", async () => {
    const { email } = await loadEml(synthetic("delta-schedule-change.eml"));
    const result = await extractSegments(email, {
      geocode: stubGeocoder,
      claude: async () => ({
        is_travel_confirmation: true,
        email_kind: "new_booking",
        segments: [
          {
            type: "flight",
            action: "confirmed",
            confirmation_code: "ZZ1",
            provider: null,
            start_local: "2027-06-24",
            start_tz: null,
            end_local: null,
            end_tz: null,
            origin: null,
            destination: { name: null, code: "CDG", city: null, country: null, address: null },
            details: {} as never,
            confidence: 0.4,
          },
        ],
        boarding_passes: [],
      }),
    });
    const reasons = result.segments[0].review_reasons;
    expect(reasons).toContain("missing departure airport");
    expect(reasons).toContain("missing start time");
    expect(reasons).toContain("low extraction confidence");
  });
});

describe("text helpers", () => {
  it("keeps link targets and table cells when flattening HTML", () => {
    const text = htmlToText(
      '<table><tr><td>Flight</td><td>AF 91</td></tr></table><a href="https://example.com/checkin">Check in</a>&nbsp;now',
    );
    expect(text).toContain("Flight AF 91");
    expect(text).toContain("Check in (https://example.com/checkin)");
  });
  it("prefers HTML when the text part is a stub", () => {
    expect(emailBodyText("View in browser", "<p>Confirmation ABC123 for your stay at the Hotel du Louvre in Paris</p>")).toContain(
      "ABC123",
    );
  });
  it("parses printed clock times", () => {
    expect(parseClock("3:00 PM")).toBe("15:00");
    expect(parseClock("11 a.m.")).toBe("11:00");
    expect(parseClock("12:00 AM")).toBe("00:00");
    expect(parseClock("14h30")).toBe("14:30");
    expect(parseClock("after noon")).toBeNull();
  });
});
