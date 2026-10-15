// A finished (or running) AI trip plan.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import type { PlanRequest, PlanResult } from "@/lib/assistant/planner";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Loading } from "@/components/Loading";
import { AlertIcon, BedIcon, CheckIcon, LinkIcon } from "@/components/icons";

const card = "rounded-2xl border border-line bg-paper p-4 space-y-2";
const action = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

function bookingUrl(name: string, city: string, req: PlanRequest): string {
  const p = new URLSearchParams({ ss: `${name} ${city}`.trim(), checkin: req.start_date, checkout: req.end_date, group_adults: String(req.travelers) });
  return `https://www.booking.com/searchresults.html?${p}`;
}

function addUrl(h: PlanResult["hotels"][number], req: PlanRequest): string {
  const p = new URLSearchParams({
    type: "hotel",
    name: h.name,
    provider: h.brand ?? "",
    address: h.address ?? "",
    checkin: `${req.start_date}T15:00`,
    checkout: `${req.end_date}T11:00`,
  });
  return `/add?${p}`;
}

async function Plan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requireUser();
  const { data } = await db.from("trip_plans").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const req = data.request as PlanRequest;
  const result = data.result as PlanResult | null;
  const city = req.destination.split(",").slice(-2, -1)[0]?.trim() ?? "";

  return (
    <div className="space-y-4">
      <Link href="/plan" className="inline-flex min-h-12 items-center font-semibold underline">
        ← Plans
      </Link>
      <h1 className="text-2xl font-bold">{req.destination}</h1>
      <p className="text-muted">
        {req.start_date} to {req.end_date} · {req.travelers} traveler{req.travelers > 1 ? "s" : ""} · {req.purpose}
      </p>
      {data.status === "pending" ? (
        <p className="rounded-2xl border border-line bg-paper p-4" role="status">
          Researching hotels and routes. This usually takes one to three minutes; the page updates by itself.
          <AutoRefresh />
        </p>
      ) : null}
      {data.status === "failed" ? (
        <p className="rounded-2xl border-2 border-dashed border-ink bg-paper p-4 font-semibold">Planning failed: {data.error}</p>
      ) : null}
      {result ? (
        <>
          <p className="flex items-start gap-2 rounded-2xl border-2 border-dashed border-ink bg-paper p-3">
            <AlertIcon size={20} className="mt-0.5 shrink-0" /> AI suggestions with indicative prices. Check rates and
            availability before you book.
          </p>
          <section className={card}>
            <h2 className="text-lg font-bold">Summary</h2>
            <p>{result.summary}</p>
            {result.per_diem ? (
              <p className="font-semibold">
                GSA per diem {result.per_diem.city}, {result.per_diem.state}: lodging ${result.per_diem.lodging} a night,
                meals ${result.per_diem.mie} a day.
              </p>
            ) : null}
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-bold">Where to stay</h2>
            {result.hotels.map((h) => (
              <article key={h.name} className={card}>
                <p className="flex items-center gap-2 text-lg font-bold">
                  <BedIcon size={20} /> {h.name}
                </p>
                <p className="text-muted">{[h.brand, h.distance, h.review_score].filter(Boolean).join(" · ")}</p>
                {h.address ? <p>{h.address}</p> : null}
                {h.nightly_rate != null ? (
                  <p className="font-semibold">
                    {h.within_per_diem === true ? <CheckIcon size={16} className="mr-1 inline" /> : null}
                    {h.within_per_diem === false ? <AlertIcon size={16} className="mr-1 inline" /> : null}
                    About {h.nightly_rate} {h.currency ?? "USD"} a night
                    {h.within_per_diem === true ? ", within per diem" : h.within_per_diem === false ? ", over per diem" : ""}
                  </p>
                ) : null}
                <p>{h.why}</p>
                <div className="flex flex-wrap gap-2">
                  <a href={bookingUrl(h.name, city, req)} className={action} target="_blank" rel="noreferrer">
                    Search on Booking.com
                  </a>
                  {h.url ? (
                    <a href={h.url} className={action} target="_blank" rel="noreferrer">
                      <LinkIcon size={18} /> Hotel site
                    </a>
                  ) : null}
                  <Link href={addUrl(h, req)} className={action}>
                    Add to my trips
                  </Link>
                </div>
              </article>
            ))}
          </section>
          <section className={card}>
            <h2 className="text-lg font-bold">Getting there</h2>
            {result.getting_there.map((g, i) => (
              <div key={i}>
                <p className="font-semibold">
                  {g.mode === "fly" ? "Fly" : g.mode === "drive" ? "Drive" : g.mode === "train" ? "Train" : "Other"}
                  {g.duration ? ` · ${g.duration}` : ""}
                </p>
                <p>{g.summary}</p>
                {g.notes ? <p className="text-muted">{g.notes}</p> : null}
              </div>
            ))}
          </section>
          <section className={card}>
            <h2 className="text-lg font-bold">Advice</h2>
            <ul className="list-disc space-y-1 pl-6">
              {result.advice.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </section>
          <section className={card}>
            <h2 className="text-lg font-bold">Checklist</h2>
            <ul className="list-disc space-y-1 pl-6">
              {result.checklist.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </section>
          <section className={card}>
            <h2 className="text-lg font-bold">Sources</h2>
            <ul className="space-y-1">
              {result.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} className="underline" target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}

export default function PlanResultPage({ params }: PageProps<"/plan/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Plan params={params} />
    </Suspense>
  );
}
