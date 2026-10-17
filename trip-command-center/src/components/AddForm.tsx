"use client";

// Add a drive, stop, stay or booking by hand. Places come from saved places
// (Settings) or a typed address, airport code or city.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SavedPlace, StopKind } from "@/lib/types";
import { STOP_KIND_LABEL } from "@/lib/present";
import { TypeIcon } from "./icons";
import { PlaceSearch } from "./PlaceSearch";

type Kind = "drive" | "stop" | "hotel" | "train" | "flight" | "event";

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "drive", label: "Drive" },
  { kind: "stop", label: "Stop or meeting" },
  { kind: "hotel", label: "Stay" },
  { kind: "train", label: "Train" },
  { kind: "flight", label: "Flight" },
  { kind: "event", label: "Event" },
];

interface PlaceValue {
  place_id?: string;
  address?: string;
  label?: string;
  code?: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
}

const input = "min-h-12 w-full rounded-xl border-2 border-line bg-paper px-3";
const labelCls = "block space-y-1";
const smallBtn = "inline-flex min-h-12 items-center rounded-xl border border-line bg-paper px-3 font-semibold";

function PlacePicker({
  title,
  places,
  value,
  onChange,
  mode = "address",
}: {
  title: string;
  places: SavedPlace[];
  value: PlaceValue;
  onChange: (v: PlaceValue) => void;
  mode?: "address" | "code" | "city";
}) {
  const saved = value.place_id ?? "";
  return (
    <fieldset className="space-y-2 rounded-xl border border-line p-3">
      <legend className="px-1 font-bold">{title}</legend>
      {places.length && mode === "address" ? (
        <label className={labelCls}>
          <span className="font-semibold">Saved place</span>
          <select className={input} value={saved} onChange={(e) => onChange(e.target.value ? { place_id: e.target.value } : {})}>
            <option value="">Type an address instead</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {!saved && mode === "address" ? (
        <>
          <PlaceSearch
            label="Address or place"
            initial={value}
            // A picked business fills the name unless one was typed.
            onChange={(p) => onChange({ ...p, label: value.label || p.label })}
          />
          <label className={labelCls}>
            <span className="font-semibold">Name (optional)</span>
            <input className={input} value={value.label ?? ""} onChange={(e) => onChange({ ...value, label: e.target.value })} />
          </label>
        </>
      ) : null}
      {mode === "code" ? (
        <label className={labelCls}>
          <span className="font-semibold">Airport code</span>
          <input
            className={`${input} uppercase`}
            maxLength={3}
            value={value.code ?? ""}
            onChange={(e) => onChange({ code: e.target.value.toUpperCase() })}
          />
        </label>
      ) : null}
      {mode === "city" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={labelCls}>
            <span className="font-semibold">Station</span>
            <input className={input} value={value.label ?? ""} onChange={(e) => onChange({ ...value, label: e.target.value })} />
          </label>
          <label className={labelCls}>
            <span className="font-semibold">City</span>
            <input className={input} value={value.city ?? ""} onChange={(e) => onChange({ ...value, city: e.target.value })} />
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

function clean(v: PlaceValue): PlaceValue | undefined {
  const out = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== "")) as PlaceValue;
  return Object.keys(out).length ? out : undefined;
}

export interface AddPrefill {
  property_name?: string;
  provider?: string;
  address?: string;
  start_local?: string;
  end_local?: string;
}

export function AddForm({
  places,
  initialKind = "drive",
  prefill = {},
}: {
  places: SavedPlace[];
  initialKind?: Kind;
  prefill?: AddPrefill;
}) {
  const router = useRouter();
  const home = places.find((p) => p.kind === "home");
  const [kind, setKind] = useState<Kind>(initialKind);
  const [origin, setOrigin] = useState<PlaceValue>(home ? { place_id: home.id } : {});
  const [destination, setDestination] = useState<PlaceValue>(
    prefill.address ? { address: prefill.address, label: prefill.property_name } : {},
  );
  const [stops, setStops] = useState<PlaceValue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (form: HTMLFormElement) =>
    start(async () => {
      const f = new FormData(form);
      const v = (k: string) => String(f.get(k) ?? "").trim();
      const details: Record<string, string> = {};
      for (const key of ["property_name", "flight_number", "seat", "note", "phone"]) if (v(key)) details[key] = v(key);
      const body = {
        type: kind,
        provider: v("provider") || undefined,
        confirmation_code: v("confirmation_code") || undefined,
        start_local: v("start_local"),
        end_local: v("end_local") || undefined,
        origin: kind === "hotel" || kind === "stop" || kind === "event" ? undefined : clean(origin),
        destination: clean(destination),
        stops: kind === "drive" ? stops.map(clean).filter(Boolean) : undefined,
        vehicle: kind === "drive" ? (v("vehicle") === "Other" ? v("vehicle_other") : v("vehicle")) : undefined,
        stop_kind: kind === "stop" ? (v("stop_kind") as StopKind) : undefined,
        details,
      };
      const res = await fetch("/api/segments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; trip_id?: string | null };
      if (!res.ok) return setError(data.error ?? `Error ${res.status}`);
      router.push(data.trip_id ? `/trips/${data.trip_id}` : "/review");
    });

  const placeMode = kind === "flight" ? "code" : kind === "train" ? "city" : "address";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        submit(e.currentTarget);
      }}
    >
      <div role="radiogroup" aria-label="What are you adding" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="radio"
            aria-checked={kind === k.kind}
            onClick={() => setKind(k.kind)}
            className={`flex min-h-14 items-center gap-2 rounded-xl px-3 font-semibold ${kind === k.kind ? "border-[3px] border-ink bg-paper" : "border border-line bg-paper"}`}
          >
            <TypeIcon type={k.kind} size={20} />
            {k.label}
            {kind === k.kind ? <span className="sr-only">(selected)</span> : null}
          </button>
        ))}
      </div>

      {kind === "stop" ? (
        <label className={labelCls}>
          <span className="font-semibold">Kind of stop</span>
          <select name="stop_kind" className={input} defaultValue="family">
            {Object.entries(STOP_KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {kind === "hotel" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>
            <span className="font-semibold">Booked with</span>
            <select name="provider" className={input} defaultValue={prefill.provider ? "" : "Booking.com"}>
              <option>Booking.com</option>
              <option>Airbnb</option>
              <option>Vrbo</option>
              <option>Expedia</option>
              <option value="">Hotel directly</option>
            </select>
          </label>
          <label className={labelCls}>
            <span className="font-semibold">Property name</span>
            <input name="property_name" className={input} defaultValue={prefill.property_name} />
          </label>
        </div>
      ) : null}

      {kind === "flight" ? (
        <label className={labelCls}>
          <span className="font-semibold">Flight number</span>
          <input name="flight_number" className={input} placeholder="AF 91" />
        </label>
      ) : null}
      {kind === "train" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>
            <span className="font-semibold">Operator</span>
            <input name="provider" className={input} placeholder="SNCF, Eurostar, Trenitalia…" />
          </label>
          <label className={labelCls}>
            <span className="font-semibold">Coach and seat</span>
            <input name="seat" className={input} />
          </label>
        </div>
      ) : null}
      {kind === "event" ? (
        <label className={labelCls}>
          <span className="font-semibold">Event name</span>
          <input name="note" className={input} />
        </label>
      ) : null}

      {kind === "drive" || kind === "flight" || kind === "train" ? (
        <PlacePicker title="From" places={places} value={origin} onChange={setOrigin} mode={placeMode} />
      ) : null}

      {kind === "drive" ? (
        <div className="space-y-2">
          {stops.map((s, i) => (
            <div key={i} className="space-y-2">
              <PlacePicker
                title={`Stop ${i + 1}`}
                places={places}
                value={s}
                onChange={(v) => setStops(stops.map((x, j) => (j === i ? v : x)))}
              />
              <div className="flex flex-wrap gap-2">
                {i > 0 ? (
                  <button
                    type="button"
                    className={smallBtn}
                    onClick={() => setStops(stops.map((x, j) => (j === i - 1 ? stops[i] : j === i ? stops[i - 1] : x)))}
                  >
                    Move up
                  </button>
                ) : null}
                <button type="button" className={smallBtn} onClick={() => setStops(stops.filter((_, j) => j !== i))}>
                  Remove stop {i + 1}
                </button>
              </div>
            </div>
          ))}
          {stops.length < 9 ? (
            <button type="button" className={smallBtn} onClick={() => setStops([...stops, {}])}>
              + Add a stop
            </button>
          ) : (
            <p className="text-muted">Google Maps routes take up to 9 stops.</p>
          )}
        </div>
      ) : null}

      <PlacePicker
        title={kind === "drive" ? "To" : kind === "hotel" ? "Where you are staying" : kind === "flight" || kind === "train" ? "To" : "Where"}
        places={places}
        value={destination}
        onChange={setDestination}
        mode={placeMode}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>
          <span className="font-semibold">
            {kind === "hotel" ? "Check-in" : kind === "drive" ? "Leave" : "Starts"} (local time there)
          </span>
          <input name="start_local" type="datetime-local" required className={input} defaultValue={prefill.start_local} />
        </label>
        <label className={labelCls}>
          <span className="font-semibold">
            {kind === "hotel" ? "Check-out" : kind === "drive" || kind === "flight" || kind === "train" ? "Arrive" : "Ends"}{" "}
            (optional)
          </span>
          <input name="end_local" type="datetime-local" className={input} defaultValue={prefill.end_local} />
        </label>
      </div>

      {kind === "drive" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>
            <span className="font-semibold">Car</span>
            <select name="vehicle" className={input} defaultValue="Tesla">
              <option>Tesla</option>
              <option>Porsche</option>
              <option>Other</option>
            </select>
          </label>
          <label className={labelCls}>
            <span className="font-semibold">Other car (optional)</span>
            <input name="vehicle_other" className={input} />
          </label>
        </div>
      ) : null}

      {kind !== "drive" && kind !== "stop" ? (
        <label className={labelCls}>
          <span className="font-semibold">Confirmation code (optional)</span>
          <input name="confirmation_code" className={input} />
        </label>
      ) : null}
      {kind === "stop" || kind === "drive" ? (
        <label className={labelCls}>
          <span className="font-semibold">Note (optional)</span>
          <input name="note" className={input} />
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="font-semibold">
          Error: {error}
        </p>
      ) : null}
      <button className="min-h-14 w-full rounded-xl bg-accent px-4 text-lg font-bold text-white disabled:opacity-60" disabled={pending}>
        {pending ? "Saving…" : "Add to my trips"}
      </button>
    </form>
  );
}
