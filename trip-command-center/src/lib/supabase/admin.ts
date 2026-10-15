// Service-role client for webhooks and cron jobs. It bypasses RLS, so every
// query made with it must filter by user_id explicitly.

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials are not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
