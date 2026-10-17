// Per-request client bound to the signed-in user's session; RLS applies.

import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function createSessionClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
          } catch {
            // Called from a Server Component; proxy.ts refreshes the session instead.
          }
        },
      },
    },
  );
}

/** The signed-in user and a client scoped to them, or null when signed out. */
export async function getSessionUser(): Promise<{ db: SupabaseClient; user: User } | null> {
  const db = await createSessionClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;
  return { db, user: data.user };
}
