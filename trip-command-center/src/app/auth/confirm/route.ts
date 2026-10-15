// Magic-link landing: supports both the PKCE ?code= flow and ?token_hash=.

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSessionClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = url.searchParams.get("next") ?? "/";
  const target = new URL(next.startsWith("/") && !next.startsWith("//") ? next : "/", url.origin);
  const db = await createSessionClient();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const { error } = code
    ? await db.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await db.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing token") };

  if (error) return NextResponse.redirect(new URL("/login?error=link", url.origin));
  return NextResponse.redirect(target);
}
