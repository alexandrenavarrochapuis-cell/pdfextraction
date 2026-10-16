// Inbound security (spec sections 3 and 10): the webhook must be signed by
// Resend, the email must have been delivered to the secret inbound address,
// and it must have come through one of Alex's forwarding rules.

import { Resend } from "resend";

export class SignatureError extends Error {}

/** Verify a Resend webhook (Svix / Standard Webhooks signature). Returns the parsed event. */
export function verifyResendWebhook(rawBody: string, headers: Headers, secret: string): unknown {
  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  const timestamp = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const signature = headers.get("svix-signature") ?? headers.get("webhook-signature");
  if (!id || !timestamp || !signature) throw new SignatureError("Missing signature headers");
  try {
    // verify() is local crypto; the API key is not used for it.
    return new Resend(process.env.RESEND_API_KEY || "re_verify_only").webhooks.verify({
      payload: rawBody,
      headers: { id, timestamp, signature },
      webhookSecret: secret,
    });
  } catch (err) {
    throw new SignatureError(err instanceof Error ? err.message : "Invalid signature");
  }
}

const ADDRESS_RE = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[a-z]{2,}/gi;

/** Lowercase and drop a "+tag" (Gmail rewrites the envelope sender to alex+caf_=...@). */
export function normalizeAddress(address: string): string {
  const [local, domain] = address.trim().toLowerCase().split("@");
  if (!domain) return address.trim().toLowerCase();
  return `${local.split("+")[0]}@${domain}`;
}

/**
 * The mailbox addresses in a header value. When angle brackets are present only
 * the bracketed addresses count, so a display name such as
 * `"alex@sidus.group" <x@evil.example>` yields x@evil.example. Quoted strings
 * and (comments) are dropped before bare addresses are read.
 */
function addressesIn(value: string | null | undefined): string[] {
  const text = value ?? "";
  const bracketed = [...text.matchAll(/<([^<>]*)>/g)].map((m) => m[1]);
  const source = bracketed.length ? bracketed.join(" ") : text.replace(/"(?:[^"\\]|\\.)*"/g, " ").replace(/\([^()]*\)/g, " ");
  return source.match(ADDRESS_RE)?.map(normalizeAddress) ?? [];
}

/**
 * The inbound address is the real gate: it is random and appears only in Alex's
 * forwarding rules, and Resend reports the SMTP envelope recipients in
 * `received_for`, which a sender cannot fake for mail that never reached it.
 * Compared whole and case-insensitively: a "+tag" here is part of the secret.
 */
export function deliveredToInbound(receivedFor: string[] | null | undefined, inbound: string): boolean {
  const want = inbound.trim().toLowerCase();
  return (receivedFor ?? []).some((entry) => {
    const bracketed = entry.match(/<([^<>]+)>/);
    return (bracketed ? bracketed[1] : entry).trim().toLowerCase() === want;
  });
}

/**
 * Headers that identify who forwarded the message:
 * - From / Sender: manual forwards and Outlook "forward" rules
 * - X-Forwarded-For: Gmail auto-forwarding ("alex@sidus.group trips@...")
 * - Return-Path: Gmail rewrites the envelope sender to the forwarding account
 * - Resent-From / Resent-Sender: redirect-style forwarding
 * - X-MS-Exchange-Inbox-Rules-Loop: set by an Outlook/Exchange inbox rule
 */
const FORWARDER_HEADERS = [
  "sender",
  "x-forwarded-for",
  "return-path",
  "resent-from",
  "resent-sender",
  "x-ms-exchange-inbox-rules-loop",
];

export function forwarderCandidates(from: string | null, headers: Record<string, string> | null): string[] {
  const lower = new Map(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const found = new Set(addressesIn(from));
  for (const h of FORWARDER_HEADERS) for (const a of addressesIn(lower.get(h))) found.add(a);
  return [...found];
}

/**
 * Header checks are a sender allowlist, not authentication: Sender,
 * X-Forwarded-For and the rest can be forged. The signature check proves the
 * request came from Resend and deliveredToInbound() proves the mail reached the
 * secret address; this is a second layer if that address ever leaks.
 */
export function isAllowedForwarder(
  from: string | null,
  headers: Record<string, string> | null,
  allowlist: string[],
): boolean {
  const allowed = new Set(allowlist.map(normalizeAddress));
  return forwarderCandidates(from, headers).some((a) => allowed.has(a));
}
