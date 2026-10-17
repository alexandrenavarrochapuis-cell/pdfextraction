// Boarding passes, travelers and the vault.

import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { julianToDate, nameMatches, parseBcbp } from "@/lib/passes/bcbp";
import { factsFromBcbp, matchSegment, matchTraveler } from "@/lib/passes/match";
import { readPkpass } from "@/lib/passes/pkpass";
import { decryptBytes, decryptText, deriveKey, encryptBytes, encryptText, keyMatches, newSalt, VAULT_CHECK } from "@/lib/vault/crypto";
import { expiryStatus, isInternational, passportWarnings } from "@/lib/vault/expiry";
import type { TravelDocument, Traveler } from "@/lib/types";
import { segment } from "./helpers";

/** Build a one-leg BCBP string field by field. */
function bcbp(name: string, pnr: string, from: string, to: string, carrier: string, flight: string, julian: number, seat: string) {
  return (
    "M1" +
    name.padEnd(20) +
    "E" +
    pnr.padEnd(7) +
    from +
    to +
    carrier.padEnd(3) +
    flight.padStart(4, "0").padEnd(5) +
    String(julian).padStart(3, "0") +
    "Y" +
    seat.padStart(4, "0") +
    "0012 " +
    "1" +
    "00"
  );
}

describe("IATA bar coded boarding pass", () => {
  it("parses the IATA example", () => {
    const p = parseBcbp("M1DESMARAIS/LUC       EABC123 YULFRAAC 0834 326J001A0025 100")!;
    expect(p.lastName).toBe("DESMARAIS");
    expect(p.firstName).toBe("LUC");
    expect(p.legs[0]).toMatchObject({ pnr: "ABC123", from: "YUL", to: "FRA", carrier: "AC", flightNumber: "834", julianDay: 326, compartment: "J", seat: "1A" });
  });

  it("rejects strings that are not boarding passes", () => {
    expect(parseBcbp("https://example.com")).toBeNull();
  });

  it("resolves the day of year to the date nearest the reference", () => {
    expect(julianToDate(175, new Date("2027-06-20T00:00:00Z"))).toBe("2027-06-24");
    expect(julianToDate(2, new Date("2027-12-30T00:00:00Z"))).toBe("2028-01-02");
  });

  it("matches printed names to family members, ignoring titles and truncation", () => {
    expect(nameMatches("NAVARRO/ALEXANDREMR", "Alexandre Navarro")).toBe(true);
    expect(nameMatches("NAVARRO/ALEX", "Alexandre Navarro")).toBe(true);
    expect(nameMatches("NAVARRO/EMMAMISS", "Emma Navarro")).toBe(true);
    expect(nameMatches("NAVARRO/EMMAMISS", "Alexandre Navarro")).toBe(false);
    expect(nameMatches("DOE/JANE", "Alexandre Navarro")).toBe(false);
  });
});

describe("matching a pass to a flight and a traveler", () => {
  const dl84 = segment({
    id: "dl84",
    type: "flight",
    start_at: "2027-06-24T21:45:00Z",
    start_tz: "America/New_York",
    origin: { code: "ATL" },
    destination: { code: "CDG" },
    details: { flight_number: "DL 84" },
  });
  const dl85 = segment({
    id: "dl85",
    type: "flight",
    start_at: "2027-07-14T08:30:00Z",
    start_tz: "Europe/Paris",
    origin: { code: "CDG" },
    destination: { code: "ATL" },
    details: { flight_number: "DL 85" },
  });
  const travelers: Traveler[] = [
    { id: "t1", user_id: "u", name: "Alexandre Navarro", relation: "self", name_variants: [] },
    { id: "t2", user_id: "u", name: "Emma Navarro", relation: "child", name_variants: [] },
  ];

  it("finds the flight from the barcode and the child from the printed name", () => {
    const parsed = parseBcbp(bcbp("NAVARRO/EMMAMISS", "G7XK2P", "ATL", "CDG", "DL", "84", 175, "24B"))!;
    const facts = factsFromBcbp(parsed, new Date("2027-06-20T00:00:00Z"));
    expect(facts).toMatchObject({ carrier: "DL", flightNumber: "84", date: "2027-06-24", from: "ATL", seat: "24B" });
    expect(matchSegment(facts, [dl85, dl84])?.id).toBe("dl84");
    expect(matchTraveler(facts.passengerName, travelers)?.id).toBe("t2");
  });

  it("does not match a different day's flight", () => {
    expect(matchSegment({ flightNumber: "84", carrier: "DL", date: "2027-06-30" }, [dl84])).toBeNull();
  });

  it("uses a saved spelling first", () => {
    const withVariant = [{ ...travelers[0], name_variants: ["NAVARRO CHAPUIS/ALEXANDRE"] }];
    expect(matchTraveler("NAVARRO CHAPUIS/ALEXANDRE", withVariant)?.id).toBe("t1");
  });
});

describe("Apple Wallet pass", () => {
  it("reads the barcode and boarding fields from pass.json", () => {
    const message = bcbp("NAVARRO/ALEXANDREMR", "G7XK2P", "ATL", "CDG", "DL", "84", 175, "24A");
    const passJson = {
      formatVersion: 1,
      organizationName: "Delta Air Lines",
      relevantDate: "2027-06-24T17:45-04:00",
      barcodes: [{ format: "PKBarcodeFormatPDF417", message, messageEncoding: "iso-8859-1" }],
      boardingPass: {
        transitType: "PKTransitTypeAir",
        headerFields: [{ key: "gate", label: "GATE", value: "F7" }],
        primaryFields: [
          { key: "origin", label: "Atlanta", value: "ATL" },
          { key: "destination", label: "Paris", value: "CDG" },
        ],
        auxiliaryFields: [
          { key: "seat", label: "SEAT", value: "24A" },
          { key: "zone", label: "ZONE", value: "3" },
          { key: "boardingTime", label: "BOARDING", value: "5:05 PM" },
        ],
      },
    };
    const zip = zipSync({ "pass.json": strToU8(JSON.stringify(passJson)), "manifest.json": strToU8("{}") });
    const pass = readPkpass(zip)!;
    expect(pass.barcodeMessage).toBe(message);
    expect(pass.barcodeFormat).toBe("pdf417");
    expect(pass).toMatchObject({ seat: "24A", gate: "F7", boardingGroup: "3", boardingTime: "5:05 PM", organization: "Delta Air Lines" });
  });

  it("returns null for a file that is not a pass", () => {
    expect(readPkpass(strToU8("not a zip"))).toBeNull();
  });
});

describe("vault encryption", () => {
  it("round-trips text and bytes, and rejects the wrong passphrase", async () => {
    const salt = newSalt();
    const key = await deriveKey("correct horse battery staple", salt);
    const check = await encryptText(key, VAULT_CHECK);
    expect(await keyMatches(key, check.iv, check.ciphertext)).toBe(true);

    const wrong = await deriveKey("wrong passphrase!!", salt);
    expect(await keyMatches(wrong, check.iv, check.ciphertext)).toBe(false);

    const sealed = await encryptText(key, JSON.stringify({ number: "X1234567" }));
    expect(sealed.ciphertext).not.toContain("X1234567");
    expect(JSON.parse(await decryptText(key, sealed.iv, sealed.ciphertext)).number).toBe("X1234567");

    const scan = new Uint8Array([1, 2, 3, 4, 5]);
    const enc = await encryptBytes(key, scan);
    expect([...(await decryptBytes(key, enc.iv, enc.data))]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("passport expiry", () => {
  const doc = (id: string, expires: string): TravelDocument =>
    ({ id, kind: "passport", traveler_id: "t1", expires_on: expires }) as TravelDocument;
  const paris = [segment({ origin: { code: "ATL" }, destination: { code: "CDG" } })];
  const domestic = [segment({ origin: { code: "TPA" }, destination: { code: "ATL" } })];

  it("warns when a passport expires within 6 months after an international trip", () => {
    const warnings = passportWarnings([doc("a", "2027-10-01"), doc("b", "2028-06-01")], "2027-07-14T21:50:00Z", paris);
    expect(warnings.map((w) => w.document_id)).toEqual(["a"]);
    expect(passportWarnings([doc("a", "2027-10-01")], "2027-07-14T21:50:00Z", domestic)).toEqual([]);
  });

  it("classifies expiry and international trips", () => {
    const now = new Date("2027-01-01T00:00:00Z");
    expect(expiryStatus("2026-12-01", now)).toBe("expired");
    expect(expiryStatus("2027-03-01", now)).toBe("soon");
    expect(expiryStatus("2030-01-01", now)).toBe("ok");
    expect(isInternational([segment({ origin: { code: "TPA" }, destination: { code: "SJU" } })])).toBe(false);
  });
});
