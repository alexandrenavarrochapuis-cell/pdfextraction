// Runtime configuration read from environment variables (see .env.example).

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function homeAirports(): string[] {
  const codes = list(process.env.HOME_AIRPORTS).map((c) => c.toUpperCase());
  return codes.length ? codes : ["SRQ", "TPA"];
}

export function userTimezone(): string {
  return process.env.USER_TIMEZONE || "America/New_York";
}

/** Addresses allowed to forward mail into the inbound address. */
export function allowedForwarders(): string[] {
  return list(process.env.ALLOWED_FORWARDERS).map((a) => a.toLowerCase());
}

/** The single account that owns all ingested mail in Phase 1. */
export function ownerEmail(): string {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("OWNER_EMAIL is not set");
  return email;
}

/**
 * Sender for the sign-in email Atlas sends itself through Resend, e.g.
 * "Atlas <atlas@your-domain.com>" on a Resend sending domain. Unset, Supabase
 * sends its own email instead.
 */
export function authEmailFrom(): string | null {
  return process.env.AUTH_EMAIL_FROM?.trim() || null;
}

export function inboundAddress(): string | null {
  return process.env.INBOUND_ADDRESS?.trim() || null;
}

/**
 * Fixed drive-time estimates from home to each home airport, in minutes
 * (Phase 1; Phase 2 replaces this with a maps API). Override per airport with
 * DRIVE_MINUTES_<CODE>, e.g. DRIVE_MINUTES_TPA=80.
 */
const DEFAULT_DRIVE_MINUTES: Record<string, number> = { SRQ: 30, TPA: 75 };

export function driveMinutesTo(airportCode: string): number | null {
  const code = airportCode.toUpperCase();
  const override = Number(process.env[`DRIVE_MINUTES_${code}`]);
  if (Number.isFinite(override) && override > 0) return override;
  return DEFAULT_DRIVE_MINUTES[code] ?? null;
}

export const EXTRACTION_MODEL = "claude-sonnet-5-5";

/** Research-heavy assistant work (country briefs, trip planning). */
export const ASSISTANT_MODEL = "claude-opus-5-5";

/** Citizenships the country brief covers (embassies, visas), e.g. "US,FR". */
export function citizenships(): string[] {
  const list = (process.env.CITIZENSHIPS ?? "US")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return list.length ? list : ["US"];
}

/** Below this confidence an extracted segment is flagged needs_review. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.7;

export const RAW_EMAIL_RETENTION_DAYS = 90;
