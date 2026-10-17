// Atlas: booking links, emergency help, currency, trip items and the chat
// transcript.

import { describe, expect, it } from "vitest";
import { carLinks, flightLinks, hotelLinks } from "@/lib/atlas/links";
import { emergencyNumber, helpQuery, parseHelp } from "@/lib/atlas/emergency";
import { convertWithRates } from "@/lib/atlas/money";
import { tripItemToSegment } from "@/lib/atlas/item";
import { toChatItems } from "@/lib/atlas/transcript";
import { CreateSegmentSchema } from "@/lib/trips/create";

describe("booking links", () => {
  it("fills in flight searches and lists the airlines to book direct", () => {
    const { search, airlines } = flightLinks({ from: "tpa", to: "cdg", depart: "2026-11-03", return: "2026-11-10", adults: 2, cabin: "business" });
    const by = Object.fromEntries(search.map((l) => [l.label, l.url]));
    expect(by.Kayak).toBe("https://www.kayak.com/flights/TPA-CDG/2026-11-03/2026-11-10/business/2adults?sort=bestflight_a");
    expect(by.Skyscanner).toBe("https://www.skyscanner.com/transport/flights/tpa/cdg/261103/261110/?adultsv2=2&cabinclass=business");
    expect(decodeURIComponent(by["Google Flights"])).toContain("Flights from TPA to CDG on 2026-11-03 returning 2026-11-10 2 adults business class");
    expect(decodeURIComponent(by.Expedia)).toContain("leg2=from:CDG,to:TPA,departure:11/10/2026TANYT");
    expect(airlines[0].url).toContain("f=TPA&t=CDG&d=2026-11-03&px=2&tqp=R&r=2026-11-10");
    expect(airlines.map((a) => a.label)).toEqual(expect.arrayContaining(["Air France", "Qatar Airways", "Delta"]));
  });

  it("leads hotel searches with the Booking.com account", () => {
    const links = hotelLinks({ destination: "Paris 8e", check_in: "2026-11-03", check_out: "2026-11-06", adults: 2 });
    expect(links[0].label).toContain("Booking.com");
    expect(links[0].url).toBe("https://www.booking.com/searchresults.html?ss=Paris+8e&checkin=2026-11-03&checkout=2026-11-06&group_adults=2&no_rooms=1");
  });

  it("fills in rental car searches, one way included", () => {
    const [kayak, expedia] = carLinks({ pickup: "mco", pickup_at: "2026-11-03T09:30", dropoff_at: "2026-11-07T17:00", dropoff: "TPA" });
    expect(kayak.url).toBe("https://www.kayak.com/cars/MCO/TPA/2026-11-03-9h/2026-11-07-17h?sort=rank_a");
    expect(expedia.url).toContain("time1=0900AM&time2=0500PM&loc2=TPA");
  });
});

describe("emergency help", () => {
  it("knows the local number and falls back to 112", () => {
    expect(emergencyNumber("us")).toBe("911");
    expect(emergencyNumber("FR")).toContain("112");
    expect(emergencyNumber("ZZ")).toContain("112");
  });

  it("lists the closest places, emergency departments first", () => {
    const here = { lat: 48.8566, lng: 2.3522 };
    const help = parseHelp(
      {
        elements: [
          { lat: 48.86, lon: 2.35, tags: { amenity: "hospital", name: "Small clinic hospital" } },
          { lat: 48.9, lon: 2.4, tags: { amenity: "hospital", name: "Hôpital Lariboisière", emergency: "yes", phone: "+33 1 49 95 65 65" } },
          { lat: 48.857, lon: 2.353, tags: { amenity: "pharmacy", name: "Pharmacie" } },
          { lat: 48.858, lon: 2.354, tags: { amenity: "police" } },
        ],
      },
      here.lat,
      here.lng,
    );
    expect(help.map((p) => [p.kind, p.name])).toEqual([
      ["hospital", "Hôpital Lariboisière"],
      ["hospital", "Small clinic hospital"],
      ["pharmacy", "Pharmacie"],
      ["police", "police"],
    ]);
    expect(help[0].directions).toBe("https://www.google.com/maps/dir/?api=1&destination=48.9,2.4");
    expect(helpQuery(here.lat, here.lng)).toContain("around:15000,48.85660,2.35220");
  });
});

describe("currency", () => {
  it("converts at the reference rate", () => {
    expect(convertWithRates(100, "eur", "usd", { USD: 1.0832 }, "today")).toMatchObject({ result: 108.32, from: "EUR", to: "USD" });
    expect(convertWithRates(100, "EUR", "XXX", { USD: 1.08 }, null)).toBeNull();
  });
});

describe("trip items Atlas adds", () => {
  it("maps a flight to airport codes and passes the add schema", () => {
    const segment = tripItemToSegment({
      type: "flight",
      summary: "Delta DL 84",
      start_local: "2026-11-03T18:05",
      from: "tpa",
      to: "CDG",
      flight_number: "DL 84",
      provider: "Delta",
    });
    expect(segment.origin).toEqual({ code: "TPA" });
    expect(segment.details).toEqual({ flight_number: "DL 84" });
    expect(CreateSegmentSchema.safeParse(segment).success).toBe(true);
  });

  it("keeps a stay at its address", () => {
    const segment = tripItemToSegment({ type: "hotel", summary: "Hotel", start_local: "2026-11-03", to: "1 Rue de Rivoli, Paris", property_name: "Hotel Rivoli" });
    expect(segment.destination).toEqual({ address: "1 Rue de Rivoli, Paris", label: "Hotel Rivoli" });
  });
});

describe("chat transcript", () => {
  it("shows what was said, hides context, tool traffic and thinking", () => {
    const items = toChatItems([
      { role: "user", content: [{ type: "text", text: "<context>\nNow: ...\n</context>" }, { type: "text", text: "Add my flight" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Adding it." }, { type: "tool_use", name: "add_trip_item", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: " Done.", citations: [{ type: "web_search_result_location", url: "https://delta.com", title: "Delta" }] }],
      },
    ]);
    expect(items).toEqual([
      { role: "user", text: "Add my flight", sources: [] },
      { role: "atlas", text: "Adding it. Done.", sources: [{ title: "Delta", url: "https://delta.com" }] },
    ]);
  });
});
