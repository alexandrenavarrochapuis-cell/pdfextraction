// One boarding pass: who, which flight, seat and group, the barcode, and
// buttons for Apple Wallet, the original file and full screen.

import Link from "next/link";
import type { PassView } from "@/lib/passes/data";
import { barcodeSvg } from "@/lib/passes/barcode";
import { segmentTitle } from "@/lib/present";
import { airportPageUrl } from "@/lib/trips/insights";
import { lookupAirport } from "@/lib/airports";
import { TimePair } from "./TimePair";
import { PassDelete } from "./PassDelete";
import { AlertIcon, CheckIcon, LinkIcon, PassIcon } from "./icons";

const action = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

export function PassCard({ view, homeTz }: { view: PassView; homeTz: string }) {
  const { pass, segment, traveler } = view;
  const gate = pass.gate ?? segment?.details?.departure_gate ?? null;
  const airportLink = airportPageUrl(pass.origin ?? segment?.origin?.code, gate);
  const originCode = pass.origin ?? segment?.origin?.code ?? null;
  const usDeparture = lookupAirport(originCode)?.country === "US" || segment?.origin?.country === "US";
  const svg = pass.barcode_message ? barcodeSvg(pass.barcode_message, pass.barcode_format) : null;
  const flight = segment
    ? segmentTitle(segment)
    : [pass.carrier, pass.flight_number, pass.origin && pass.destination ? `${pass.origin} → ${pass.destination}` : null]
        .filter(Boolean)
        .join(" ") || "Flight not matched yet";
  return (
    <article className="space-y-3 rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xl font-bold">{traveler?.name ?? pass.passenger_name ?? "Traveler not matched"}</p>
          <p className="font-semibold">{flight}</p>
        </div>
        <PassIcon size={28} />
      </div>
      {segment?.start_at && segment.start_tz ? <TimePair at={segment.start_at} tz={segment.start_tz} homeTz={homeTz} size="md" /> : null}
      <dl className="grid grid-cols-4 gap-2 text-center">
        {[
          ["Seat", pass.seat],
          ["Group", pass.boarding_group],
          ["Gate", gate],
          ["Boards", pass.boarding_time],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line p-2">
            <dt className="text-xs font-semibold uppercase text-muted">{label}</dt>
            <dd className="text-lg font-bold">{value || "–"}</dd>
          </div>
        ))}
      </dl>
      {usDeparture && pass.tsa_precheck === true ? (
        <p className="inline-flex items-center gap-2 rounded-full border-2 border-ink px-3 py-1 font-bold">
          <CheckIcon size={18} /> TSA PreCheck
        </p>
      ) : null}
      {usDeparture && pass.tsa_precheck === false ? (
        <p className="flex items-start gap-2 rounded-xl border-2 border-dashed border-ink p-3">
          <AlertIcon size={18} className="mt-0.5 shrink-0" />
          <span>
            TSA PreCheck is not on this pass. Add the Known Traveler Number to this booking in the airline app or website
            (it is in Passports and IDs), then get a new boarding pass.
          </span>
        </p>
      ) : null}
      {svg ? (
        <Link href={`/passes/${pass.id}`} aria-label="Show the barcode full screen" className="block rounded-xl bg-white p-3">
          <div className="mx-auto max-w-sm [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        </Link>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {svg ? (
          <Link href={`/passes/${pass.id}`} className={action}>
            Show at the gate
          </Link>
        ) : null}
        {pass.kind === "wallet" ? (
          <a href={`/api/passes/${pass.id}/file`} className={action}>
            <PassIcon size={18} /> Add to Apple Wallet
          </a>
        ) : pass.storage_path ? (
          <a href={`/api/passes/${pass.id}/file`} className={action} target="_blank" rel="noreferrer">
            <LinkIcon size={18} /> Open {pass.kind === "pdf" ? "PDF" : "image"}
          </a>
        ) : null}
        {airportLink ? (
          <Link href={airportLink} className={action}>
            {gate ? `Find gate ${gate}` : "Airport map"}
          </Link>
        ) : null}
        <PassDelete id={pass.id} />
      </div>
    </article>
  );
}
