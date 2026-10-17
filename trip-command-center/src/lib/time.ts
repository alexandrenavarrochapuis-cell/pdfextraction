// Time zone helpers built on Intl only (Node and every modern browser ship full ICU).
// All instants are stored as UTC ISO strings with the IANA zone of the place alongside.

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = partsFormatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatterCache.set(tz, fmt);
  }
  return fmt;
}

/** Wall-clock fields of an instant in a zone. */
export function wallClock(date: Date, tz: string): WallClock {
  const parts = partsFormatter(tz).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `tz` from UTC at `date`, in minutes (Paris in summer = +120). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const w = wallClock(date, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Convert a local wall-clock time ("2026-06-24T18:05" or "2026-06-24") in `tz`
 * to a UTC Date. Times skipped by a DST jump resolve forward; repeated times
 * resolve to the first occurrence.
 */
export function zonedLocalToUtc(local: string, tz: string): Date | null {
  const m = LOCAL_RE.exec(local.trim());
  if (!m || !isValidTimeZone(tz)) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const offset1 = tzOffsetMinutes(new Date(guess), tz);
  const utc1 = guess - offset1 * 60000;
  const offset2 = tzOffsetMinutes(new Date(utc1), tz);
  if (offset2 === offset1) return new Date(utc1);
  const utc2 = guess - offset2 * 60000;
  if (tzOffsetMinutes(new Date(utc2), tz) === offset2) return new Date(utc2);
  // The wall-clock time does not exist (spring-forward gap): move forward.
  return new Date(Math.max(utc1, utc2));
}

/**
 * Resolve a timestamp from an email to UTC. Strings that carry an offset are
 * exact; strings without one are read as wall-clock time in `tz`.
 */
export function resolveInstant(value: string | null | undefined, tz: string | null): Date | null {
  if (!value) return null;
  const v = value.trim();
  if (OFFSET_RE.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (!tz) return null;
  return zonedLocalToUtc(v.slice(0, 19), tz);
}

/** "2026-06-24" for an instant, in a zone. */
export function localDateKey(date: Date | string, tz: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const w = wallClock(d, tz);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Add whole days to a "YYYY-MM-DD" key. */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function formatTime(date: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(typeof date === "string" ? new Date(date) : date);
}

export function formatTimeWithZone(date: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(typeof date === "string" ? new Date(date) : date);
}

/** "Wed, Jun 24" */
export function formatDay(date: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(typeof date === "string" ? new Date(date) : date);
}

/** "Jun 24" */
export function formatMonthDay(date: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  }).format(typeof date === "string" ? new Date(date) : date);
}

/** "Wednesday, June 24" from a "YYYY-MM-DD" key. */
export function formatDateKeyLong(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Hours `tz` is ahead of `baseTz` at `date` (negative when behind). */
export function hoursAhead(tz: string, baseTz: string, date: Date): number {
  return (tzOffsetMinutes(date, tz) - tzOffsetMinutes(date, baseTz)) / 60;
}

export function describeOffset(placeLabel: string, tz: string, homeTz: string, date: Date): string | null {
  const diff = hoursAhead(tz, homeTz, date);
  if (diff === 0) return null;
  const abs = Math.abs(diff);
  const unit = abs === 1 ? "hour" : "hours";
  const amount = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return `${placeLabel} is ${amount} ${unit} ${diff > 0 ? "ahead of" : "behind"} Florida`;
}

/** "2026-06-24T18:05" wall-clock string for <input type="datetime-local">. */
export function toLocalInput(date: Date | string | null, tz: string | null): string {
  if (!date || !tz || !isValidTimeZone(tz)) return "";
  const w = wallClock(typeof date === "string" ? new Date(date) : date, tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${p(w.month)}-${p(w.day)}T${p(w.hour)}:${p(w.minute)}`;
}

/** "in 2 h 5 min" until an instant; "now" once it has passed. */
export function formatUntil(target: Date | string, now: Date): string {
  const ms = (typeof target === "string" ? Date.parse(target) : target.getTime()) - now.getTime();
  if (ms <= 30_000) return "now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  const days = Math.floor(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}${hours % 24 ? ` ${hours % 24} h` : ""}`;
}
