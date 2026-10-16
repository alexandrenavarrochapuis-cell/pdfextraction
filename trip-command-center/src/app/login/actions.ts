"use server";

// Sign-in with a one-time code. A magic link opened from Mail lands in Safari,
// and on iPhone an installed web app keeps its own cookies, so the link would
// sign in Safari but not the home-screen app. Typing the 6-digit code from the
// same email signs in wherever it is typed. The link still works in a browser.
//
// With AUTH_EMAIL_FROM set, Atlas generates the code with the admin API and
// mails it through Resend. Supabase's built-in mailer sends 2 emails an hour,
// and its email template and link target live in dashboard settings
// (Auth > Email templates, Auth > URL configuration); this path needs neither.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createResend } from "@/lib/ingest/deps";
import { claimCooldown } from "@/lib/lease";
import { authEmailFrom, ownerEmail } from "@/lib/config";
import { safeNextPath } from "@/lib/redirect";
import { signInEmail, signInLink } from "@/lib/signin-email";

export interface LoginState {
  step: "email" | "code";
  email: string;
  error: string | null;
}

const RESEND_COOLDOWN_MS = 60_000;

async function sendOwnCode(email: string, next: string, origin: string, from: string): Promise<LoginState> {
  const admin = createAdminClient();
  const key = `signin-email:${email}`;
  if (!(await claimCooldown(admin, key, RESEND_COOLDOWN_MS))) {
    return { step: "code", email, error: "A code was sent less than a minute ago. Use that one, or wait a minute." };
  }
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const sent = error
    ? { error }
    : await createResend().emails.send({
        from,
        to: email,
        ...signInEmail(data.properties.email_otp, signInLink(origin, data.properties.hashed_token, next)),
      });
  if (sent.error) {
    // Let the next try through at once instead of making it wait out the cooldown.
    await admin.from("job_leases").delete().eq("key", key);
    return { step: "email", email, error: `The sign-in email could not be sent: ${sent.error.message}` };
  }
  return { step: "code", email, error: null };
}

async function sendCode(email: string, next: string): Promise<LoginState> {
  if (email !== ownerEmail()) {
    return { step: "email", email, error: "This app is private to its owner." };
  }
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const from = authEmailFrom();
  if (from && process.env.SUPABASE_SERVICE_ROLE_KEY) return sendOwnCode(email, next, origin, from);

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
  const next = safeNextPath(form.get("next"));
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
