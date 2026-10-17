// IATA Bar Coded Boarding Pass (BCBP, Resolution 792) parser. Every airline
// boarding pass barcode (QR, PDF417 or Aztec) carries this string, so one
// parser matches passes from Wallet files, PDFs and manual entry.

export interface BcbpLeg {
  pnr: string;
  from: string;
  to: string;
  carrier: string;
  flightNumber: string;
  julianDay: number;
  compartment: string;
  seat: string;
  sequence: string;
}

export interface Bcbp {
  passengerName: string; // "NAVARRO/ALEXANDRE MR"
  lastName: string;
  firstName: string;
  legs: BcbpLeg[];
}

export function parseBcbp(raw: string): Bcbp | null {
  const s = raw.replace(/\r?\n/g, "");
  if (s.length < 60 || s[0] !== "M") return null;
  const legCount = Number(s[1]);
  if (!Number.isInteger(legCount) || legCount < 1 || legCount > 4) return null;
  const passengerName = s.slice(2, 22).trim();
  const [last = "", first = ""] = passengerName.split("/");
  const legs: BcbpLeg[] = [];
  let pos = 23;
  for (let i = 0; i < legCount; i++) {
    if (s.length < pos + 37) break;
    const leg = s.slice(pos, pos + 35);
    legs.push({
      pnr: leg.slice(0, 7).trim(),
      from: leg.slice(7, 10).trim(),
      to: leg.slice(10, 13).trim(),
      carrier: leg.slice(13, 16).trim(),
      flightNumber: leg.slice(16, 21).trim().replace(/^0+(?=\d)/, ""),
      julianDay: Number(leg.slice(21, 24)),
      compartment: leg.slice(24, 25).trim(),
      seat: leg.slice(25, 29).trim().replace(/^0+(?=\d)/, ""),
      sequence: leg.slice(29, 34).trim(),
    });
    const conditionalSize = parseInt(s.slice(pos + 35, pos + 37), 16);
    pos += 37 + (Number.isFinite(conditionalSize) ? conditionalSize : 0);
  }
  if (!legs.length) return null;
  return { passengerName, lastName: last.trim(), firstName: first.trim(), legs };
}

/** Day of year (1-366) to the date nearest the reference date. */
export function julianToDate(day: number, reference: Date): string | null {
  if (!Number.isInteger(day) || day < 1 || day > 366) return null;
  const year = reference.getUTCFullYear();
  let best: Date | null = null;
  for (const y of [year - 1, year, year + 1]) {
    const d = new Date(Date.UTC(y, 0, day));
    if (d.getUTCFullYear() !== y) continue; // day 366 in a non-leap year
    if (!best || Math.abs(d.getTime() - reference.getTime()) < Math.abs(best.getTime() - reference.getTime())) best = d;
  }
  return best ? best.toISOString().slice(0, 10) : null;
}

const TITLES = /(MSTR|MISS|MRS|MR|MS|DR|PROF)$/;

function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z/ ]/g, " ")
    .split(/[\s/]+/)
    .filter(Boolean);
}

/**
 * Does a printed passenger name ("NAVARRO/ALEXANDREMR") belong to this
 * traveler ("Alexandre Navarro")? Surname must match; the given name may be
 * truncated or carry a title suffix.
 */
export function nameMatches(printed: string, travelerName: string): boolean {
  const [lastRaw, firstRaw = ""] = printed.toUpperCase().split("/");
  const last = nameTokens(lastRaw).join("");
  const first = nameTokens(firstRaw).join("").replace(TITLES, "");
  const tokens = nameTokens(travelerName);
  if (!last || tokens.length === 0) return false;
  const surnameOk = tokens.some((t, i) => tokens.slice(i).join("") === last || t === last);
  if (!surnameOk) return false;
  if (!first) return true;
  return tokens.some((t) => t.startsWith(first) || first.startsWith(t));
}
