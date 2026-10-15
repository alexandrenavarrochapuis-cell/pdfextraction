"use client";

// Country brief status on a trip: prepare it, wait for it, open it.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertIcon, CheckIcon, ClockIcon } from "./icons";

type Status = "missing" | "pending" | "ready" | "failed" | "loading";

const button = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

export function CountryBriefCard({ code, name }: { code: string; name: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const res = await fetch(`/api/assistant/country?code=${code}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { status?: Status; error?: string };
    setStatus(data.status ?? "missing");
    setError(data.error ?? null);
  }, [code]);

  useEffect(() => {
    const first = setTimeout(check, 0);
    return () => clearTimeout(first);
  }, [check]);

  useEffect(() => {
    if (status !== "pending") return;
    const t = setInterval(check, 8000);
    return () => clearInterval(t);
  }, [status, check]);

  const prepare = async () => {
    setStatus("pending");
    await fetch("/api/assistant/country", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
  };

  return (
    <div className="space-y-2 rounded-2xl border border-line bg-paper p-4">
      <p className="font-bold">{name}: entry, customs, embassies, emergency numbers, vaccines</p>
      {status === "ready" ? (
        <div className="flex flex-wrap gap-2">
          <Link href={`/countries/${code}`} className={button}>
            <CheckIcon size={18} /> Open country brief
          </Link>
          <button type="button" className={button} onClick={prepare}>
            Refresh
          </button>
        </div>
      ) : status === "pending" ? (
        <p className="flex items-center gap-2" role="status">
          <ClockIcon size={18} /> Researching official sources. This takes a minute or two.
        </p>
      ) : status === "failed" ? (
        <>
          <p className="flex items-center gap-2 font-semibold">
            <AlertIcon size={18} /> Research failed{error ? `: ${error}` : ""}.
          </p>
          <button type="button" className={button} onClick={prepare}>
            Try again
          </button>
        </>
      ) : status === "missing" ? (
        <button type="button" className={button} onClick={prepare}>
          Prepare country brief
        </button>
      ) : null}
    </div>
  );
}
