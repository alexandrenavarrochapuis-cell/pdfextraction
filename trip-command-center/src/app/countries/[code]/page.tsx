// Country brief: an AI summary of official government pages, with links.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import type { CountryBrief } from "@/lib/assistant/country";
import { countryName } from "@/lib/assistant/countries";
import { telUrl } from "@/lib/present";
import { Loading } from "@/components/Loading";
import { AlertIcon, LinkIcon, PhoneIcon, PinIcon } from "@/components/icons";

const card = "rounded-2xl border border-line bg-paper p-4 space-y-2";

function List({ items, empty = "Nothing noted." }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-6">
      {items.map((i, n) => (
        <li key={n}>{i}</li>
      ))}
    </ul>
  );
}

async function Brief({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { db } = await requireUser();
  const { data } = await db.from("country_briefs").select("payload, generated_at").eq("country_code", code.toUpperCase()).maybeSingle();
  const brief = data?.payload as CountryBrief | null;
  if (!brief) notFound();
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">{countryName(code.toUpperCase())}</h1>
      <p className="flex items-start gap-2 rounded-2xl border-2 border-dashed border-ink bg-paper p-3">
        <AlertIcon size={20} className="mt-0.5 shrink-0" />
        <span>
          AI summary of official sources from {new Date(brief.generated_at).toLocaleDateString("en-US")}. Rules change:
          check the linked pages before you travel.
        </span>
      </p>
      {brief.advisory ? (
        <section className={card}>
          <h2 className="text-lg font-bold">US travel advisory</h2>
          <p>{brief.advisory}</p>
        </section>
      ) : null}
      <section className={card}>
        <h2 className="text-lg font-bold">Emergency numbers</h2>
        <ul className="flex flex-wrap gap-2">
          {brief.emergency_numbers.map((e) => (
            <li key={e.service}>
              <a href={telUrl(e.number)} className="inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-ink px-4 font-bold">
                <PhoneIcon size={18} /> {e.service}: {e.number}
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section className={card}>
        <h2 className="text-lg font-bold">Embassies</h2>
        {brief.embassies.map((e) => (
          <div key={e.name} className="space-y-1 border-t border-line pt-2 first:border-0 first:pt-0">
            <p className="font-semibold">
              {e.name} <span className="font-normal text-muted">({e.for_citizens} citizens)</span>
            </p>
            {e.address ? (
              <a href={`https://maps.apple.com/?q=${encodeURIComponent(e.address)}`} className="flex items-center gap-2 underline" target="_blank" rel="noreferrer">
                <PinIcon size={16} /> {e.address}
              </a>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {e.phone ? (
                <a href={telUrl(e.phone)} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line px-3 font-semibold">
                  <PhoneIcon size={16} /> {e.phone}
                </a>
              ) : null}
              {e.emergency_phone ? (
                <a href={telUrl(e.emergency_phone)} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line px-3 font-semibold">
                  <PhoneIcon size={16} /> After hours {e.emergency_phone}
                </a>
              ) : null}
              {e.website ? (
                <a href={e.website} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line px-3 font-semibold" target="_blank" rel="noreferrer">
                  <LinkIcon size={16} /> Website
                </a>
              ) : null}
            </div>
          </div>
        ))}
      </section>
      <section className={card}>
        <h2 className="text-lg font-bold">Entry requirements</h2>
        {brief.entry.map((e) => (
          <div key={e.citizenship} className="space-y-1">
            <p className="font-semibold">{e.citizenship} passport</p>
            <List items={[e.passport_validity, e.visa, ...e.other].filter((x): x is string => !!x)} />
          </div>
        ))}
      </section>
      <section className={card}>
        <h2 className="text-lg font-bold">What you can bring in</h2>
        <h3 className="font-semibold">Allowed duty-free</h3>
        <List items={brief.customs_allowed} />
        <h3 className="font-semibold">Restricted</h3>
        <List items={brief.customs_restricted} />
        <h3 className="font-semibold">Prohibited</h3>
        <List items={brief.customs_prohibited} />
        {brief.currency_declaration ? <p>Cash: {brief.currency_declaration}</p> : null}
      </section>
      <section className={card}>
        <h2 className="text-lg font-bold">Coming back to the US</h2>
        <List items={brief.returning_to_us} />
      </section>
      <section className={card}>
        <h2 className="text-lg font-bold">Health and vaccines</h2>
        <h3 className="font-semibold">Required</h3>
        <List items={brief.vaccines_required} empty="None required." />
        <h3 className="font-semibold">Recommended</h3>
        <List items={brief.vaccines_recommended} />
        <List items={brief.health_notes} empty="" />
      </section>
      <section className={card}>
        <h2 className="text-lg font-bold">Practical</h2>
        <List items={brief.practical} />
      </section>
      <section className={card}>
        <h2 className="text-lg font-bold">Sources</h2>
        <ul className="space-y-1">
          {brief.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} className="underline" target="_blank" rel="noreferrer">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </section>
      <Link href="/" className="inline-flex min-h-12 items-center font-semibold underline">
        ← Trips
      </Link>
    </div>
  );
}

export default function CountryPage({ params }: PageProps<"/countries/[code]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Brief params={params} />
    </Suspense>
  );
}
