// Lay a trip's segments out day by day. Hotels and rentals appear twice:
// check-in and check-out, pick-up and return. Days follow the local date of
// the place where each entry happens.

import type { Segment } from "./types";
import { formatDay, localDateKey } from "./time";

export type EntryKind = "single" | "check_in" | "check_out" | "pickup" | "return";

export interface TimelineEntry {
  key: string;
  segment: Segment;
  kind: EntryKind;
  at: string;
  tz: string;
}

export interface TimelineDay {
  dateKey: string;
  label: string;
  entries: TimelineEntry[];
}

export const ENTRY_LABEL: Record<EntryKind, string | null> = {
  single: null,
  check_in: "Check-in",
  check_out: "Check-out",
  pickup: "Pick-up",
  return: "Return",
};

export function buildTimeline(segments: Segment[]): { days: TimelineDay[]; unscheduled: Segment[] } {
  const entries: TimelineEntry[] = [];
  const unscheduled: Segment[] = [];
  for (const s of segments) {
    if (!s.start_at || !s.start_tz) {
      unscheduled.push(s);
      continue;
    }
    const twoPart = s.type === "hotel" || s.type === "car";
    entries.push({
      key: `${s.id}:start`,
      segment: s,
      kind: s.type === "hotel" ? "check_in" : s.type === "car" ? "pickup" : "single",
      at: s.start_at,
      tz: s.start_tz,
    });
    if (twoPart && s.end_at) {
      entries.push({
        key: `${s.id}:end`,
        segment: s,
        kind: s.type === "hotel" ? "check_out" : "return",
        at: s.end_at,
        tz: s.end_tz ?? s.start_tz,
      });
    }
  }
  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const days: TimelineDay[] = [];
  for (const e of entries) {
    const dateKey = localDateKey(e.at, e.tz);
    let day = days.find((d) => d.dateKey === dateKey);
    if (!day) {
      day = { dateKey, label: formatDay(e.at, e.tz), entries: [] };
      days.push(day);
    }
    day.entries.push(e);
  }
  days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return { days, unscheduled };
}
