// Page guard: the signed-in user and an RLS-scoped client, or a redirect to /login.

import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser } from "./supabase/server";

export async function requireUser() {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  return session;
}
