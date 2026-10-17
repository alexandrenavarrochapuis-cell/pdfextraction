"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login, type LoginState } from "./actions";

const INITIAL: LoginState = { step: "email", email: "", error: null };

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const linkFailed = params.get("error") === "link";
  const [state, action, pending] = useActionState(login, INITIAL);

  const input = "min-h-14 w-full rounded-xl border-2 border-line bg-paper px-4 text-lg";
  const button = "min-h-14 w-full rounded-xl bg-accent px-4 text-lg font-bold text-white disabled:opacity-60";
  const error = state.error ?? (linkFailed && state.step === "email" ? "That sign-in link expired. Request a new code." : null);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state.step === "code" ? (
        <>
          <input type="hidden" name="email" value={state.email} />
          <p>
            We emailed a sign-in code to <strong>{state.email}</strong>. Type it here, or open the link in the email if
            you are in a browser.
          </p>
          <label className="block space-y-1">
            <span className="font-semibold">Sign-in code</span>
            <input
              className={`${input} tracking-[0.3em]`}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </label>
        </>
      ) : (
        <label className="block space-y-1">
          <span className="font-semibold">Email</span>
          <input className={input} type="email" name="email" autoComplete="email" required defaultValue={state.email} />
        </label>
      )}
      {error ? (
        <p role="alert" className="font-semibold">
          Error: {error}
        </p>
      ) : null}
      <button className={button} disabled={pending}>
        {pending ? "One moment…" : state.step === "code" ? "Sign in" : "Email me a sign-in code"}
      </button>
    </form>
  );
}
