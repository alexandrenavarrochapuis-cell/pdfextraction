// The sign-in email Atlas sends itself (app/login/actions.ts): the code
// first, for the home-screen app, and a link for a browser.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A link to /auth/confirm, which verifies the hashed token on the app's own domain. */
export function signInLink(origin: string, hashedToken: string, next: string): string {
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", "email");
  url.searchParams.set("next", next);
  return url.toString();
}

export function signInEmail(code: string, link: string): { subject: string; text: string; html: string } {
  return {
    // The code in the subject shows in the iPhone notification.
    subject: `Your Atlas code: ${code}`,
    text: [
      `Your Atlas sign-in code is ${code}.`,
      "",
      "In a browser, you can open this link instead:",
      link,
      "",
      "The code works once and expires in an hour. If you did not ask for it, ignore this email.",
    ].join("\n"),
    html: [
      '<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#1c1b19">',
      "<h2>Sign in to Atlas</h2>",
      `<p>Your code:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">${escapeHtml(code)}</p>`,
      `<p>In a browser, you can <a href="${escapeHtml(link)}">sign in with this link</a> instead.</p>`,
      "<p>The code works once and expires in an hour. If you did not ask for it, ignore this email.</p>",
      "</div>",
    ].join(""),
  };
}
