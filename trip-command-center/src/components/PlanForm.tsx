"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const input = "min-h-12 w-full rounded-xl border-2 border-line bg-paper px-3";
const BRANDS = ["Hilton", "Marriott", "Hyatt", "IHG"];

export function PlanForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const res = await fetch("/api/assistant/plan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              destination: f.get("destination"),
              purpose: f.get("purpose"),
              start_date: f.get("start_date"),
              end_date: f.get("end_date"),
              travelers: Number(f.get("travelers") || 1),
              brands: f.getAll("brands").map(String),
              within_per_diem: f.get("within_per_diem") === "on",
              notes: f.get("notes") || undefined,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
          if (!res.ok || !data.id) return setError(data.error ?? `Error ${res.status}`);
          router.push(`/plan/${data.id}`);
        });
      }}
    >
      <label className="block space-y-1">
        <span className="font-semibold">Where (meeting address, office or city)</span>
        <input name="destination" required className={input} placeholder="1800 F St NW, Washington, DC" />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="font-semibold">Arrive</span>
          <input name="start_date" type="date" required className={input} />
        </label>
        <label className="block space-y-1">
          <span className="font-semibold">Leave</span>
          <input name="end_date" type="date" required className={input} />
        </label>
        <label className="block space-y-1">
          <span className="font-semibold">Travelers</span>
          <input name="travelers" type="number" min={1} max={12} defaultValue={1} className={input} />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="font-semibold">Trip</legend>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="purpose" value="business" defaultChecked className="size-6" /> Business
        </label>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="purpose" value="personal" className="size-6" /> Personal
        </label>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-semibold">Preferred hotel brands</legend>
        <div className="flex flex-wrap gap-4">
          {BRANDS.map((b) => (
            <label key={b} className="flex min-h-12 items-center gap-2">
              <input type="checkbox" name="brands" value={b} defaultChecked={b === "Hilton" || b === "Marriott"} className="size-6" />
              {b}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" name="within_per_diem" defaultChecked className="size-6" />
        <span className="font-semibold">Stay within government per diem (GSA in the US)</span>
      </label>
      <label className="block space-y-1">
        <span className="font-semibold">Anything else</span>
        <textarea name="notes" className={`${input} min-h-24 py-2`} placeholder="Walking distance, gym, late checkout, meeting at 9 a.m. on day one…" />
      </label>
      {error ? (
        <p role="alert" className="font-semibold">
          Error: {error}
        </p>
      ) : null}
      <button className="min-h-14 w-full rounded-xl bg-accent px-4 text-lg font-bold text-white disabled:opacity-60" disabled={pending}>
        {pending ? "Starting…" : "Plan it"}
      </button>
    </form>
  );
}
