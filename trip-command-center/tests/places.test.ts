// Address search parsing (Google Places, Photon) and calendar subscribe links.

import { describe, expect, it } from "vitest";
import { parseGooglePlace, parseGoogleSuggestions, parsePhoton } from "@/lib/place-search";
import { subscribeLinks } from "@/lib/calendar/links";

describe("Google Places", () => {
  it("reads autocomplete suggestions", () => {
    const out = parseGoogleSuggestions({
      suggestions: [
        {
          placePrediction: {
            placeId: "ChIJabc-123",
            text: { text: "The Ritz-Carlton, Sarasota, 1111 Ritz-Carlton Dr, Sarasota, FL, USA" },
            structuredFormat: {
              mainText: { text: "The Ritz-Carlton, Sarasota" },
              secondaryText: { text: "1111 Ritz-Carlton Dr, Sarasota, FL, USA" },
            },
          },
        },
        {},
      ],
    });
    expect(out).toEqual([
      {
        id: "google:ChIJabc-123",
        primary: "The Ritz-Carlton, Sarasota",
        secondary: "1111 Ritz-Carlton Dr, Sarasota, FL, USA",
        place: null,
      },
    ]);
  });

  it("reads place details, keeping a business name and dropping a bare address", () => {
    const components = [
      { longText: "Sarasota", shortText: "Sarasota", types: ["locality", "political"] },
      { longText: "Florida", shortText: "FL", types: ["administrative_area_level_1", "political"] },
      { longText: "United States", shortText: "US", types: ["country", "political"] },
    ];
    const hotel = parseGooglePlace({
      displayName: { text: "The Ritz-Carlton, Sarasota" },
      formattedAddress: "1111 Ritz-Carlton Dr, Sarasota, FL 34236, USA",
      location: { latitude: 27.3336, longitude: -82.5466 },
      addressComponents: components,
    });
    expect(hotel).toEqual({
      name: "The Ritz-Carlton, Sarasota",
      address: "1111 Ritz-Carlton Dr, Sarasota, FL 34236, USA",
      city: "Sarasota",
      region: "Florida",
      country: "US",
      lat: 27.3336,
      lng: -82.5466,
    });
    const street = parseGooglePlace({
      displayName: { text: "1 Main St" },
      formattedAddress: "1 Main St, Sarasota, FL 34236, USA",
      location: { latitude: 27.3, longitude: -82.5 },
      addressComponents: components,
    });
    expect(street?.name).toBeNull();
    expect(parseGooglePlace({ displayName: { text: "x" } })).toBeNull();
  });
});

describe("Photon", () => {
  it("builds an address and keeps the coordinates", () => {
    const [hit] = parsePhoton({
      features: [
        {
          geometry: { coordinates: [-82.5466, 27.3336] },
          properties: {
            name: "The Ritz-Carlton",
            housenumber: "1111",
            street: "Ritz-Carlton Drive",
            postcode: "34236",
            city: "Sarasota",
            state: "Florida",
            country: "United States",
            countrycode: "us",
            osm_type: "W",
            osm_id: 42,
          },
        },
      ],
    });
    expect(hit.primary).toBe("The Ritz-Carlton");
    expect(hit.secondary).toBe("1111 Ritz-Carlton Drive, Sarasota, Florida 34236, United States");
    expect(hit.place).toEqual({
      name: "The Ritz-Carlton",
      address: "1111 Ritz-Carlton Drive, Sarasota, Florida 34236, United States",
      city: "Sarasota",
      region: "Florida",
      country: "US",
      lat: 27.3336,
      lng: -82.5466,
    });
  });

  it("names a city by itself", () => {
    const [hit] = parsePhoton({
      features: [{ geometry: { coordinates: [2.35, 48.86] }, properties: { name: "Paris", state: "Ile-de-France", country: "France", countrycode: "fr" } }],
    });
    expect(hit.primary).toBe("Paris");
    expect(hit.place?.address).toBe("Paris, Ile-de-France, France");
    expect(hit.place?.name).toBeNull();
  });
});

describe("calendar subscribe links", () => {
  it("gives each calendar app the feed in its own form", () => {
    const links = Object.fromEntries(subscribeLinks("https://atlas.example/api/calendar/abc.ics").map((l) => [l.label, l.href]));
    expect(links["Google Calendar"]).toBe(
      "https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fatlas.example%2Fapi%2Fcalendar%2Fabc.ics",
    );
    expect(links["Outlook (work)"]).toBe(
      "https://outlook.office.com/calendar/0/addfromweb?url=https%3A%2F%2Fatlas.example%2Fapi%2Fcalendar%2Fabc.ics&name=Atlas",
    );
    expect(links["Apple Calendar"]).toBe("webcal://atlas.example/api/calendar/abc.ics");
  });
});
