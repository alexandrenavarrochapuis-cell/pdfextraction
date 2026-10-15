// One boarding pass: who, which flight, seat and group, the barcode, and
// buttons for Apple Wallet, the original file and full screen.

import Link from "next/link";
import type { PassView } from "@/lib/passes/data";
import { barcodeSvg } from "@/lib/passes/barcode";
import { segmentTitle } from "@/lib/present";
import { TimePair } from "./TimePair";
import { PassDelete } from "./PassDelete";
import { LinkIcon, PassIcon } from "./icons";

const action = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

export function PassCard({ view, homeTz }: { view: PassView; homeTz: string }) {
  const { pass, segment, traveler } = view;
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
          ["Gate", pass.gate ?? segment?.details?.departure_gate ?? null],
          ["Boards", pass.boarding_time],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line p-2">
            <dt className="text-xs font-semibold uppercase text-muted">{label}</dt>
            <dd className="text-lg font-bold">{value || "–"}</dd>
          </div>
        ))}
      </dl>
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
        <PassDelete id={pass.id} />
      </div>
    </article>
  );
}
