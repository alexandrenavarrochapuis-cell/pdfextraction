// Boarding passes for the whole family, soonest flight first.

import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { userTimezone } from "@/lib/config";
import { listPasses, sortPasses } from "@/lib/passes/data";
import { segmentTitle } from "@/lib/present";
import { formatDay } from "@/lib/time";
import type { Segment, Traveler } from "@/lib/types";
import { PassCard } from "@/components/PassCard";
import { PassUpload } from "@/components/PassUpload";
import { Loading } from "@/components/Loading";
import { LockIcon } from "@/components/icons";

async function Passes({ searchParams }: { searchParams: Promise<{ segment?: string }> }) {
  const { segment: segmentParam } = await searchParams;
  const { db } = await requireUser();
  const now = new Date();
  const homeTz = userTimezone();
  const [views, { data: flights }, { data: travelers }] = await Promise.all([
    listPasses(db),
    db
      .from("segments")
      .select("*")
      .eq("type", "flight")
      .neq("status", "cancelled")
      .gte("start_at", new Date(now.getTime() - 86_400_000).toISOString())
      .order("start_at"),
    db.from("travelers").select("*").order("name"),
  ]);
  const shown = segmentParam ? views.filter((v) => v.pass.segment_id === segmentParam) : views;
  const { upcoming, unmatched, past } = sortPasses(shown, now);
  const flightOptions = ((flights ?? []) as Segment[]).map((s) => ({
    id: s.id,
    label: `${formatDay(s.start_at!, s.start_tz ?? homeTz)} · ${segmentTitle(s)}`,
  }));

  return (
    <div className="space-y-6">
      {!(travelers ?? []).length ? (
        <p className="rounded-2xl border border-line bg-paper p-4">
          Add your family in{" "}
          <Link href="/settings" className="font-semibold underline">
            Settings
          </Link>{" "}
          so passes land under the right name.
        </p>
      ) : null}
      {upcoming.length ? (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Upcoming</h2>
          {upcoming.map((v) => (
            <PassCard key={v.pass.id} view={v} homeTz={homeTz} />
          ))}
        </section>
      ) : (
        <p className="rounded-2xl border border-line bg-paper p-4">
          No upcoming boarding passes. Forward the airline&apos;s boarding pass email to your inbound address, or add one
          below.
        </p>
      )}
      {unmatched.length ? (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Not matched to a flight</h2>
          {unmatched.map((v) => (
            <PassCard key={v.pass.id} view={v} homeTz={homeTz} />
          ))}
        </section>
      ) : null}
      <section className="space-y-3 rounded-2xl border border-line bg-paper p-4">
        <h2 className="text-xl font-bold">Add a boarding pass</h2>
        <p className="text-muted">
          From Apple Wallet: open the pass, tap Share, then Mail it to your inbound address. Or save the PDF or a
          screenshot and choose it here.
        </p>
        <PassUpload
          flights={flightOptions}
          travelers={((travelers ?? []) as Traveler[]).map((t) => ({ id: t.id, name: t.name }))}
          defaultSegmentId={segmentParam}
        />
      </section>
      <Link href="/vault" className="flex min-h-14 items-center gap-2 rounded-2xl border border-line bg-paper px-4 font-semibold">
        <LockIcon /> Passports and IDs
      </Link>
      {past.length ? (
        <details className="rounded-2xl border border-line bg-paper">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">Past passes ({past.length})</summary>
          <div className="space-y-3 p-4">
            {past.map((v) => (
              <PassCard key={v.pass.id} view={v} homeTz={homeTz} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default function PassesPage({ searchParams }: PageProps<"/passes">) {
  return (
    <>
      <h1 className="mb-4 text-3xl font-bold">Boarding passes</h1>
      <Suspense fallback={<Loading label="Loading passes…" />}>
        <Passes searchParams={searchParams as Promise<{ segment?: string }>} />
      </Suspense>
    </>
  );
}
