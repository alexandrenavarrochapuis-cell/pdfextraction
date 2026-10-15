// Inbound security: Resend signature and the forwarder allowlist (spec section 10).

import { describe, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";
import { isAllowedForwarder, normalizeAddress, SignatureError, verifyResendWebhook } from "@/lib/ingest/verify";
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
