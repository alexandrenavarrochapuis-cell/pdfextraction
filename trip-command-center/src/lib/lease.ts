// A short exclusive lease on a key, held in the job_leases table
// (supabase/migrations/0006). Serverless runs share no memory, and PostgREST
// does not keep a connection open across calls, so an advisory lock cannot
// span the several requests that need protecting. A row with a primary key
// can: the insert either wins or conflicts.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const POLL_MS = 400;

export class LeaseBusyError extends Error {}

async function tryAcquire(db: SupabaseClient, key: string, holder: string, ttlMs: number): Promise<boolean> {
  // A lease whose holder died is free once it expires.
  await db.from("job_leases").delete().eq("key", key).lt("expires_at", new Date().toISOString());
  const { data, error } = await db
    .from("job_leases")
    .upsert(
      { key, holder, expires_at: new Date(Date.now() + ttlMs).toISOString() },
      { onConflict: "key", ignoreDuplicates: true },
    )
    .select("holder");
  if (error) throw error;
  return data?.length === 1 && data[0].holder === holder;
}

/**
 * Claim `key` for `ttlMs` and let the claim expire on its own: a cooldown.
 * False while an earlier claim is still live.
 */
export function claimCooldown(db: SupabaseClient, key: string, ttlMs: number): Promise<boolean> {
  return tryAcquire(db, key, crypto.randomUUID(), ttlMs);
}

/**
 * Run `fn` while holding the lease on `key`, waiting up to `waitMs` for it.
 * Needs the service-role client: job_leases has no policies for users.
 */
export async function withLease<T>(
  db: SupabaseClient,
  key: string,
  fn: () => Promise<T>,
  { ttlMs = 120_000, waitMs = 90_000 }: { ttlMs?: number; waitMs?: number } = {},
): Promise<T> {
  const holder = crypto.randomUUID();
  const deadline = Date.now() + waitMs;
  while (!(await tryAcquire(db, key, holder, ttlMs))) {
    if (Date.now() > deadline) throw new LeaseBusyError(`Timed out waiting for ${key}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  try {
    return await fn();
  } finally {
    await db.from("job_leases").delete().eq("key", key).eq("holder", holder);
  }
}
