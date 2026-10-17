// iCalendar feed of every booking, for Outlook, Google Calendar and Apple
// Calendar to subscribe to (RFC 5545). Confirmation codes are left out on
// purpose: a subscribed calendar is easy to share or sync to a work account.

import type { Segment } from "../types";
import { placeLong, segmentAddress, segmentTitle, TYPE_LABEL } from "../present";

function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold lines longer than 75 octets, as the spec requires. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildIcs(segments: Segment[], appUrl: string, now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Atlas//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Trips",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const s of segments) {
    if (!s.start_at) continue;
    const end = s.end_at && Date.parse(s.end_at) > Date.parse(s.start_at) ? s.end_at : new Date(Date.parse(s.start_at) + 3600_000).toISOString();
    const where = s.type === "flight" || s.type === "train" ? placeLong(s.origin) : segmentAddress(s);
    const description = [
      TYPE_LABEL[s.type],
      s.type === "flight" || s.type === "train" ? `${placeLong(s.origin) ?? ""} to ${placeLong(s.destination) ?? ""}` : null,
      s.status === "needs_review" ? "Needs review in the app" : null,
      s.trip_id ? `${appUrl}/trips/${s.trip_id}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@atlas`,
      `DTSTAMP:${stamp(now.toISOString())}`,
      `DTSTART:${stamp(s.start_at)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${escape(`${s.status === "cancelled" ? "Cancelled: " : ""}${segmentTitle(s)}`)}`,
      ...(where ? [`LOCATION:${escape(where)}`] : []),
      `DESCRIPTION:${escape(description)}`,
      `STATUS:${s.status === "cancelled" ? "CANCELLED" : s.status === "needs_review" ? "TENTATIVE" : "CONFIRMED"}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
