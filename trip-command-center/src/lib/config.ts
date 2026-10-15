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

/** Below this confidence an extracted segment is flagged needs_review. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.7;

export const RAW_EMAIL_RETENTION_DAYS = 90;
