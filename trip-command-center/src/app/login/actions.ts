"use server";

// Sign-in with a one-time code. A magic link opened from Mail lands in Safari,
// and on iPhone an installed web app keeps its own cookies, so the link would
// sign in Safari but not the home-screen app. Typing the 6-digit code from the
// same email signs in wherever it is typed. The link still works in a browser.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";
import { ownerEmail } from "@/lib/config";

export interface LoginState {
  step: "email" | "code";
  email: string;
  error: string | null;
}

function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

async function sendCode(email: string, next: string): Promise<LoginState> {
  if (email !== ownerEmail()) {
    return { step: "email", email, error: "This app is private to its owner." };
  }
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const db = await createSessionClient();
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error) return { step: "email", email, error: error.message };
  return { step: "code", email, error: null };
}

/** One action for both steps: a form with a code verifies it, otherwise a code is sent. */
export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = safeNext(form.get("next"));
  const code = form.get("code");
  if (code === null) return sendCode(email, next);

  const db = await createSessionClient();
  const { error } = await db.auth.verifyOtp({ email, token: String(code).replace(/\s/g, ""), type: "email" });
  if (error) return { step: "code", email, error: "That code did not work. Check the latest email and try again." };
  redirect(next);
}

export async function signOut() {
  const db = await createSessionClient();
  await db.auth.signOut();
  redirect("/login");
}
