// The sign-in email Atlas sends itself through Resend.

import { describe, expect, it } from "vitest";
import { signInEmail, signInLink } from "@/lib/signin-email";

describe("sign-in email", () => {
  it("links to the app's own confirm route with the hashed token", () => {
    const link = new URL(signInLink("https://atlas.example", "abc123", "/trips/1"));
    expect(link.origin).toBe("https://atlas.example");
    expect(link.pathname).toBe("/auth/confirm");
    expect(link.searchParams.get("token_hash")).toBe("abc123");
    expect(link.searchParams.get("type")).toBe("email");
    expect(link.searchParams.get("next")).toBe("/trips/1");
  });

  it("puts the code in the subject, text and HTML", () => {
    const mail = signInEmail("482913", "https://atlas.example/auth/confirm?token_hash=x");
    expect(mail.subject).toBe("Your Atlas code: 482913");
    expect(mail.text).toContain("482913");
    expect(mail.html).toContain("482913");
  });

  it("escapes the link in the HTML", () => {
    const mail = signInEmail("1", "https://atlas.example/auth/confirm?token_hash=x&type=email&next=%2F");
    expect(mail.html).toContain('href="https://atlas.example/auth/confirm?token_hash=x&amp;type=email&amp;next=%2F"');
  });
});
