"use client";

// Live parts of the Today card: clocks, a countdown and the currency
// converter. They keep working from the copy saved for offline use.

import { useEffect, useState } from "react";
import { formatTime, formatUntil } from "@/lib/time";

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Clock({ tz }: { tz: string }) {
  const now = useNow();
  return <span suppressHydrationWarning>{formatTime(now, tz)}</span>;
}

export function Countdown({ at }: { at: string }) {
  const now = useNow();
  return <span suppressHydrationWarning>{formatUntil(at, now)}</span>;
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Converts between the local currency and US dollars at a rate fetched with the page. */
export function QuickConvert({ code, rate }: { code: string; rate: number }) {
  const [amount, setAmount] = useState("");
  const [fromLocal, setFromLocal] = useState(true);
  const value = Number(amount.replace(/\s/g, "").replace(",", "."));
  const result = value > 0 ? (fromLocal ? money(value / rate, "USD") : money(value * rate, code)) : null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        1 USD = {new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 }).format(rate)} {code}
      </p>
      <div className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Amount in {fromLocal ? code : "USD"}</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Amount in ${fromLocal ? code : "USD"}`}
            className="min-h-12 w-full rounded-xl border border-line bg-paper px-3"
          />
        </label>
        <button
          type="button"
          onClick={() => setFromLocal(!fromLocal)}
          className="min-h-12 shrink-0 rounded-xl border border-line bg-paper px-3 font-semibold"
          aria-label={`Converting ${fromLocal ? code : "USD"} to ${fromLocal ? "USD" : code}; tap to swap`}
        >
          {fromLocal ? `${code} → USD` : `USD → ${code}`}
        </button>
      </div>
      <p className="min-h-7 text-xl font-bold" aria-live="polite">
        {result ?? ""}
      </p>
    </div>
  );
}
