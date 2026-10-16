// Inbound security: Resend signature and the forwarder allowlist (spec section 10).

import { describe, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";
import {
  deliveredToInbound,
  isAllowedForwarder,
  normalizeAddress,
  SignatureError,
  verifyResendWebhook,
} from "@/lib/ingest/verify";
import { safeNextPath } from "@/lib/redirect";
import { loadEml, synthetic } from "./helpers";

const ALLOW = ["alex@sidus.group", "alexandre.navarro@theperformagroup.com"];

describe("forwarder allowlist", () => {
  it("accepts Gmail auto-forwarding, which keeps the airline in From", async () => {
    const { from, headers } = await loadEml(synthetic("delta-paris-roundtrip.eml"));
    expect(from).toContain("delta.com");
    expect(isAllowedForwarder(from, headers, ALLOW)).toBe(true);
  });

  it("accepts Gmail's rewritten envelope sender on its own", () => {
    expect(isAllowedForwarder("Delta <x@t.delta.com>", { "return-path": "<alex+caf_=trips=example.com@sidus.group>" }, ALLOW)).toBe(true);
  });

  it("accepts an Outlook inbox rule", async () => {
    const { from, headers } = await loadEml(synthetic("delta-schedule-change.eml"));
    expect(isAllowedForwarder(from, headers, ALLOW)).toBe(true);
  });

  it("accepts a manual forward", async () => {
    const { from, headers } = await loadEml(synthetic("hertz-paris.eml"));
    expect(isAllowedForwarder(from, headers, ALLOW)).toBe(true);
  });

  it("rejects mail sent straight to the inbound address", async () => {
    const { from, headers } = await loadEml(synthetic("spoofed-sender.eml"));
    expect(isAllowedForwarder(from, headers, ALLOW)).toBe(false);
  });

  it("does not trust Reply-To", () => {
    expect(isAllowedForwarder("x@evil.example", { "reply-to": "alex@sidus.group" }, ALLOW)).toBe(false);
  });

  it("normalizes case and plus tags", () => {
    expect(normalizeAddress("Alex+travel@Sidus.Group")).toBe("alex@sidus.group");
  });

  it("ignores an allowed address used as a display name", () => {
    expect(isAllowedForwarder('"alex@sidus.group" <x@evil.example>', {}, ALLOW)).toBe(false);
    expect(isAllowedForwarder("alex@sidus.group <x@evil.example>", {}, ALLOW)).toBe(false);
    expect(isAllowedForwarder("x@evil.example (alex@sidus.group)", {}, ALLOW)).toBe(false);
    expect(isAllowedForwarder("x@evil.example", { sender: '"alex@sidus.group" <x@evil.example>' }, ALLOW)).toBe(false);
  });

  it("still reads a display name with a real address", () => {
    expect(isAllowedForwarder('"Alex Navarro" <alex@sidus.group>', {}, ALLOW)).toBe(true);
  });
});

describe("inbound address", () => {
  const INBOUND = "atlas-k3f9q2xw7m@inbound.sidus.group";

  it("accepts mail delivered to the secret address", () => {
    expect(deliveredToInbound([INBOUND], INBOUND)).toBe(true);
    expect(deliveredToInbound(["Atlas-K3F9Q2XW7M@Inbound.Sidus.Group"], INBOUND)).toBe(true);
    expect(deliveredToInbound([`Atlas <${INBOUND}>`], INBOUND)).toBe(true);
  });

  it("rejects other addresses on the receiving domain", () => {
    expect(deliveredToInbound(["trips@inbound.sidus.group"], INBOUND)).toBe(false);
    expect(deliveredToInbound([], INBOUND)).toBe(false);
    expect(deliveredToInbound(null, INBOUND)).toBe(false);
  });

  it("treats a plus tag as part of the secret", () => {
    const tagged = "trips+k3f9q2xw7m@inbound.sidus.group";
    expect(deliveredToInbound(["trips@inbound.sidus.group"], tagged)).toBe(false);
    expect(deliveredToInbound([tagged], tagged)).toBe(true);
  });
});

describe("webhook signature", () => {
  const secret = `whsec_${Buffer.from("test-signing-secret-32-bytes-long!").toString("base64")}`;
  const body = JSON.stringify({ type: "email.received", data: { email_id: "abc" } });

  function signedHeaders(payload: string, id = "msg_1"): Headers {
    const ts = new Date();
    const signature = new Webhook(secret).sign(id, ts, payload);
    return new Headers({
      "svix-id": id,
      "svix-timestamp": String(Math.floor(ts.getTime() / 1000)),
      "svix-signature": signature,
    });
  }

  it("accepts a correctly signed event", () => {
    const event = verifyResendWebhook(body, signedHeaders(body), secret) as { data: { email_id: string } };
    expect(event.data.email_id).toBe("abc");
  });

  it("rejects a tampered body", () => {
    const headers = signedHeaders(body);
    expect(() => verifyResendWebhook(body.replace("abc", "xyz"), headers, secret)).toThrow(SignatureError);
  });

  it("rejects missing headers", () => {
    expect(() => verifyResendWebhook(body, new Headers(), secret)).toThrow(SignatureError);
  });
});

describe("post sign-in redirect", () => {
  it("keeps paths on this site", () => {
    expect(safeNextPath("/trips/abc?tab=passes")).toBe("/trips/abc?tab=passes");
    expect(safeNextPath("/")).toBe("/");
  });

  it("refuses anything that leaves the site", () => {
    for (const next of ["//evil.com", "/\\evil.com", "/\t/evil.com", "https://evil.com", "evil.com", "", null, 42]) {
      expect(safeNextPath(next)).toBe("/");
    }
  });
});
