// Where to send the user after sign-in: a path on this site, never elsewhere.

const BASE = "https://atlas.invalid";

/**
 * A same-origin path from an untrusted `next` value, or "/". Resolving against a
 * fixed base and comparing origins also rejects the forms a prefix check
 * misses, such as `/\evil.com` and `/\t/evil.com`, which browsers treat as
 * `//evil.com`.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  try {
    const url = new URL(next, BASE);
    return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
