// Airport maps: pick an airport by code, or one from upcoming flights and home.

import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { lookupAirport } from "@/lib/airports";
import { homeAirports } from "@/lib/config";
import { airportPageUrl } from "@/lib/trips/insights";
import { Loading } from "@/components/Loading";
import { MapIcon } from "@/components/icons";

const chip = "inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-ink bg-paper px-4 font-semibold";

async function open(form: FormData) {
  "use server";
  const url = airportPageUrl(String(form.get("code") ?? "").trim());
  redirect(url ?? "/airports");
}

async function Airports() {
  const { db } = await requireUser();
  const { data } = await db
    .from("segments")
    .select("origin, destination")
    .eq("type", "flight")
    .neq("status", "cancelled")
    .gte("end_at", new Date().toISOString())
    .order("start_at")
    .limit(20);
  const codes = [
    ...(data ?? []).flatMap((s) => [s.origin?.code, s.destination?.code]),
    ...homeAirports(),
  ].filter((c): c is string => typeof c === "string" && /^[A-Za-z]{3}$/.test(c));
  const unique = [...new Set(codes.map((c) => c.toUpperCase()))];
  return (
    <div className="flex flex-wrap gap-2">
      {unique.map((code) => (
        <Link key={code} href={airportPageUrl(code)!} className={chip}>
          <MapIcon size={18} /> {code}
          {lookupAirport(code) ? <span className="font-normal text-muted">{lookupAirport(code)!.city}</span> : null}
        </Link>
      ))}
    </div>
  );
}

export default function AirportsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Airport maps</h1>
      <p className="text-muted">
        Gates, check-in, baggage claim, restrooms, food, lounges and security, with your position on the map.
      </p>
      <form action={open} className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">Airport code</span>
          <input
            name="code"
            required
            maxLength={3}
            placeholder="Airport code, e.g. ATL"
            autoCapitalize="characters"
            className="min-h-12 w-full rounded-xl border-2 border-line bg-paper px-3 uppercase"
          />
        </label>
        <button className="min-h-12 rounded-xl bg-accent px-5 font-bold text-white">Open</button>
      </form>
      <h2 className="text-lg font-bold">Your flights and home airports</h2>
      <Suspense fallback={<Loading label="Loading airports…" />}>
        <Airports />
      </Suspense>
    </div>
  );
}
