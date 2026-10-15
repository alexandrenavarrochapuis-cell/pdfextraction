// One timeline entry. Tap to expand: details, copy confirmation code,
// check-in link, Maps, call, flight map, edit.

import Link from "next/link";
import type { Segment } from "@/lib/types";
import type { EntryKind } from "@/lib/timeline";
import { ENTRY_LABEL } from "@/lib/timeline";
import {
  appleDirectionsUrl,
  googleDirectionsUrl,
  mapsUrl,
  placeLong,
  placeText,
  PLATFORM_MANAGE,
  segmentAddress,
  segmentTitle,
  stayPlatform,
  STOP_KIND_LABEL,
  telUrl,
  TYPE_LABEL,
  wazeUrl,
} from "@/lib/present";
import { airportMapUrl } from "@/lib/trips/insights";
import { ShareButton } from "./ShareButton";
import { StatusBadge, TypeBadge } from "./Badges";
import { CopyButton } from "./CopyButton";
import { TimePair } from "./TimePair";
import { ChevronDownIcon, LinkIcon, MapIcon, PassIcon, PhoneIcon, PinIcon } from "./icons";
import { SplitButton } from "./TripActions";

const DETAIL_LABELS: [keyof Segment["details"], string][] = [
  ["flight_number", "Flight"],
  ["airline", "Airline"],
  ["departure_terminal", "Departure terminal"],
  ["departure_gate", "Gate"],
  ["arrival_terminal", "Arrival terminal"],
  ["seat", "Seat"],
  ["cabin", "Cabin"],
  ["record_locator", "Record locator"],
  ["property_name", "Property"],
  ["address", "Address"],
  ["phone", "Phone"],
  ["check_in_time", "Check-in"],
  ["check_out_time", "Check-out"],
  ["room_type", "Room"],
  ["cancellation_deadline", "Free cancellation until"],
  ["company", "Company"],
  ["pickup_location", "Pick-up"],
  ["dropoff_location", "Drop-off"],
  ["reservation_number", "Reservation"],
  ["vehicle_class", "Vehicle"],
  ["pickup_hours", "Branch hours"],
  ["check_in_instructions", "Arrival instructions"],
  ["rate_per_night", "Nightly rate"],
  ["currency", "Currency"],
  ["vehicle", "Car"],
  ["note", "Note"],
];

const action =
  "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

export function SegmentCard({
  segment,
  kind = "single",
  at,
  tz,
  homeTz,
  tripId,
  passCount = 0,
}: {
  segment: Segment;
  kind?: EntryKind;
  at?: string;
  tz?: string;
  homeTz: string;
  tripId?: string;
  passCount?: number;
}) {
  const cancelled = segment.status === "cancelled";
  const review = segment.status === "needs_review";
  const d = segment.details ?? {};
  const address = segmentAddress(segment);
  const entryLabel = ENTRY_LABEL[kind];
  const typeLabel = entryLabel ? `${TYPE_LABEL[segment.type]} · ${entryLabel}` : TYPE_LABEL[segment.type];
  const showArrival = segment.type === "flight" || segment.type === "train" || segment.type === "drive";
  const platform = segment.type === "hotel" ? stayPlatform(segment) : null;
  const stops = segment.type === "drive" ? (d.stops ?? []) : [];
  const driveDest = segment.type === "drive" ? segment.destination : null;

  return (
    <details
      className={`group rounded-2xl bg-paper ${review ? "border-2 border-dashed border-ink" : cancelled ? "border-2 border-ink" : "border border-line"}`}
    >
      <summary className="cursor-pointer p-4">
        <div className="flex items-center justify-between gap-2">
          <TypeBadge type={segment.type} label={typeLabel} />
          {segment.status !== "confirmed" ? <StatusBadge status={segment.status} /> : null}
        </div>
        <h3 className={`mt-2 text-lg font-bold ${cancelled ? "line-through" : ""}`}>{segmentTitle(segment)}</h3>
        <div className={`mt-2 flex items-end justify-between gap-4 ${cancelled ? "line-through" : ""}`}>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {at && tz ? <TimePair at={at} tz={tz} homeTz={homeTz} /> : <p className="text-muted">Time not set</p>}
            {showArrival && segment.end_at && segment.end_tz ? (
              <div>
                <p className="text-xs font-semibold uppercase text-muted">Arrives</p>
                <TimePair at={segment.end_at} tz={segment.end_tz} homeTz={homeTz} size="md" />
              </div>
            ) : null}
          </div>
          <ChevronDownIcon className="chevron shrink-0 transition-transform" aria-label="Show details" />
        </div>
      </summary>

      <div className="space-y-4 border-t border-line p-4">
        {review && segment.review_reasons.length ? (
          <p className="font-semibold">Needs review: {segment.review_reasons.join(", ")}.</p>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {segment.provider ? (
            <>
              <dt className="text-muted">Provider</dt>
              <dd>{segment.provider}</dd>
            </>
          ) : null}
          {segment.confirmation_code ? (
            <>
              <dt className="text-muted">Confirmation</dt>
              <dd className="font-mono text-lg font-bold">{segment.confirmation_code}</dd>
            </>
          ) : null}
          {segment.type === "stop" && d.stop_kind ? (
            <>
              <dt className="text-muted">Kind</dt>
              <dd>{STOP_KIND_LABEL[d.stop_kind]}</dd>
            </>
          ) : null}
          {segment.origin && (segment.type === "flight" || segment.type === "train" || segment.type === "drive") ? (
            <>
              <dt className="text-muted">From</dt>
              <dd>{segment.type === "drive" ? placeText(segment.origin) : placeLong(segment.origin)}</dd>
              {stops.map((stop, i) => (
                <div key={i} className="contents">
                  <dt className="text-muted">Stop {i + 1}</dt>
                  <dd>{[stop.name, placeText(stop)].filter(Boolean).join(" · ")}</dd>
                </div>
              ))}
              <dt className="text-muted">To</dt>
              <dd>
                {segment.type === "drive" && segment.destination ? placeText(segment.destination) : placeLong(segment.destination)}
              </dd>
            </>
          ) : null}
          {DETAIL_LABELS.map(([key, label]) => {
            const value = d[key];
            if (value === null || value === undefined || value === "" || key === "flight_number") return null;
            if (typeof value === "object" && !Array.isArray(value)) return null;
            return (
              <div key={key} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="break-words">{Array.isArray(value) ? value.join(", ") : String(value)}</dd>
              </div>
            );
          })}
        </dl>

        <div className="flex flex-wrap gap-2">
          {segment.confirmation_code ? <CopyButton value={segment.confirmation_code} label="Copy code" /> : null}
          {segment.type === "flight" && segment.start_at ? (
            <Link href={`/trips/${tripId ?? segment.trip_id}/flight/${segment.id}`} className={action}>
              <MapIcon size={18} /> Track flight
            </Link>
          ) : null}
          {driveDest ? (
            <>
              <a
                href={googleDirectionsUrl(segment.origin, driveDest, stops)}
                className={action}
                target="_blank"
                rel="noreferrer"
              >
                <MapIcon size={18} /> Start GPS in Google Maps
              </a>
              <a href={appleDirectionsUrl(segment.origin, stops[0] ?? driveDest)} className={action} target="_blank" rel="noreferrer">
                <PinIcon size={18} /> Apple Maps{stops.length ? " to stop 1" : ""}
              </a>
              <a href={wazeUrl(stops[0] ?? driveDest)} className={action} target="_blank" rel="noreferrer">
                <PinIcon size={18} /> Waze{stops.length ? " to stop 1" : ""}
              </a>
              <ShareButton
                title={stops[0]?.name ?? driveDest.name ?? "Destination"}
                text={placeText(stops[0] ?? driveDest)}
                label={`Send ${stops.length ? "first stop" : "destination"} to car`}
              />
              {tripId ? (
                <Link href={`/trips/${tripId}/drive/${segment.id}`} className={action}>
                  <MapIcon size={18} /> Route map
                </Link>
              ) : null}
            </>
          ) : null}
          {segment.type === "flight" ? (
            <Link href={`/passes?segment=${segment.id}`} className={action}>
              <PassIcon size={18} /> {passCount ? `Boarding passes (${passCount})` : "Add boarding pass"}
            </Link>
          ) : null}
          {segment.type === "flight" && airportMapUrl(segment.origin?.code) ? (
            <a href={airportMapUrl(segment.origin?.code)!} className={action} target="_blank" rel="noreferrer">
              <MapIcon size={18} /> {segment.origin?.code} airport map
            </a>
          ) : null}
          {platform ? (
            <a href={PLATFORM_MANAGE[platform].url} className={action} target="_blank" rel="noreferrer">
              <LinkIcon size={18} /> {PLATFORM_MANAGE[platform].label}
            </a>
          ) : null}
          {d.check_in_url ? (
            <a href={d.check_in_url} className={action} target="_blank" rel="noreferrer">
              <LinkIcon size={18} /> Check in
            </a>
          ) : null}
          {address && segment.type !== "drive" ? (
            <a href={mapsUrl(address)} className={action} target="_blank" rel="noreferrer">
              <PinIcon size={18} /> Open in Maps
            </a>
          ) : null}
          {d.phone ? (
            <a href={telUrl(d.phone)} className={action}>
              <PhoneIcon size={18} /> Call
            </a>
          ) : null}
          <Link href={`/segments/${segment.id}`} className={action}>
            Edit
          </Link>
          {tripId && segment.start_at ? <SplitButton tripId={tripId} segmentId={segment.id} /> : null}
        </div>
      </div>
    </details>
  );
}
