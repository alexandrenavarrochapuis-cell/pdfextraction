"use client";

// Add a boarding pass: a Wallet pass (.pkpass), the airline PDF, or a
// screenshot. On iPhone, share a pass from Wallet with Mail to the inbound
// address, or save it to Files and pick it here.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const input = "min-h-12 w-full rounded-xl border-2 border-line bg-paper px-3";

export function PassUpload({
  flights,
  travelers,
  defaultSegmentId,
}: {
  flights: { id: string; label: string }[];
  travelers: { id: string; name: string }[];
  defaultSegmentId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        start(async () => {
          const res = await fetch("/api/passes", { method: "POST", body: new FormData(form) });
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) return setMessage(`Error: ${data.error ?? res.status}`);
          setMessage("Pass saved.");
          form.reset();
          router.refresh();
        });
      }}
    >
      <label className="block space-y-1">
        <span className="font-semibold">Pass file (Wallet pass, PDF or screenshot)</span>
        <input
          name="file"
          type="file"
          required
          accept=".pkpass,application/vnd.apple.pkpass,application/pdf,image/*"
          className="block min-h-12 w-full"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="font-semibold">Flight</span>
          <select name="segment_id" className={input} defaultValue={defaultSegmentId ?? ""}>
            <option value="">Work it out from the pass</option>
            {flights.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="font-semibold">Traveler</span>
          <select name="traveler_id" className={input} defaultValue="">
            <option value="">Work it out from the name</option>
            {travelers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message ? (
        <p role="status" className="font-semibold">
          {message}
        </p>
      ) : null}
      <button className="min-h-12 rounded-xl bg-accent px-5 font-bold text-white disabled:opacity-60" disabled={pending}>
        {pending ? "Saving…" : "Add pass"}
      </button>
    </form>
  );
}
