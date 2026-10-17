"use client";

// Correct extracted fields (review queue) or edit any segment. Times are
// entered as local time at the place, with its time zone.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Segment } from "@/lib/types";
import { SEGMENT_TYPES } from "@/lib/types";
import { TYPE_LABEL } from "@/lib/present";

const COMMON_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Puerto_Rico",
  "America/St_Thomas",
  "America/Toronto",
  "America/Mexico_City",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Lisbon",
  "Asia/Tokyo",
];

const input = "min-h-12 w-full rounded-xl border-2 border-line bg-paper px-3";
const label = "block space-y-1";
const button = "inline-flex min-h-12 items-center rounded-xl border border-line bg-paper px-4 font-semibold disabled:opacity-60";
const primary = "inline-flex min-h-12 items-center rounded-xl bg-accent px-5 font-bold text-white disabled:opacity-60";

export interface EditDefaults {
  start_local: string;
  end_local: string;
}

function Field({ name, title, defaultValue, type = "text", list }: {
  name: string;
  title: string;
  defaultValue?: string | null;
  type?: string;
  list?: string;
}) {
  return (
    <label className={label}>
      <span className="font-semibold">{title}</span>
      <input className={input} name={name} type={type} defaultValue={defaultValue ?? ""} list={list} />
    </label>
  );
}

export function SegmentEditForm({
  segment,
  defaults,
  emailFailed,
  afterSave = "refresh",
}: {
  segment: Segment;
  defaults: EditDefaults;
  emailFailed?: boolean;
  afterSave?: "refresh" | "back";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const d = segment.details ?? {};

  const done = () => (afterSave === "back" ? router.back() : router.refresh());

  const submit = (form: HTMLFormElement, action: "save" | "confirm" | "cancel") =>
    start(async () => {
      const f = new FormData(form);
      const v = (k: string) => String(f.get(k) ?? "");
      const body = {
        action,
        type: v("type"),
        provider: v("provider"),
        confirmation_code: v("confirmation_code"),
        start_local: v("start_local"),
        start_tz: v("start_tz"),
        end_local: v("end_local"),
        end_tz: v("end_tz"),
        origin: { code: v("origin_code"), city: v("origin_city"), name: v("origin_name") },
        destination: { code: v("dest_code"), city: v("dest_city"), name: v("dest_name"), address: v("dest_address") },
        details: {
          flight_number: v("flight_number"),
          property_name: v("property_name"),
          company: v("company"),
          address: v("address"),
          phone: v("phone"),
          check_in_url: v("check_in_url"),
        },
      };
      const res = await fetch(`/api/segments/${segment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; reasons?: string[] };
      if (!res.ok) return setMessage(`Error: ${data.error ?? res.status}`);
      setMessage(data.reasons?.length ? `Saved. Still missing: ${data.reasons.join(", ")}.` : "Saved.");
      done();
    });

  const remove = () =>
    start(async () => {
      if (!window.confirm("Delete this booking from the app?")) return;
      const res = await fetch(`/api/segments/${segment.id}`, { method: "DELETE" });
      if (!res.ok) return setMessage("Error: delete failed");
      done();
    });

  const retry = () =>
    start(async () => {
      setMessage("Reading the email again…");
      const res = await fetch("/api/ingest/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email_id: segment.source_email_id }),
      });
      setMessage(res.ok ? "Done." : "Error: extraction failed again. Enter the details by hand.");
      router.refresh();
    });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget, "confirm");
      }}
    >
      <datalist id="zones">
        {COMMON_ZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          <span className="font-semibold">Type</span>
          <select className={input} name="type" defaultValue={segment.type}>
            {SEGMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <Field name="provider" title="Airline, hotel or company" defaultValue={segment.provider} />
        <Field name="confirmation_code" title="Confirmation code" defaultValue={segment.confirmation_code} />
        <Field name="flight_number" title="Flight number" defaultValue={d.flight_number} />
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 font-bold">Start (local time at the place)</legend>
        <Field name="start_local" title="Date and time" type="datetime-local" defaultValue={defaults.start_local} />
        <Field name="start_tz" title="Time zone" defaultValue={segment.start_tz} list="zones" />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 font-bold">End (local time at the place)</legend>
        <Field name="end_local" title="Date and time" type="datetime-local" defaultValue={defaults.end_local} />
        <Field name="end_tz" title="Time zone" defaultValue={segment.end_tz} list="zones" />
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 font-bold">From (departure airport or pick-up)</legend>
        <Field name="origin_code" title="Airport code" defaultValue={segment.origin?.code} />
        <Field name="origin_city" title="City" defaultValue={segment.origin?.city} />
        <Field name="origin_name" title="Name" defaultValue={segment.origin?.name} />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 font-bold">To (arrival airport, hotel or venue)</legend>
        <Field name="dest_code" title="Airport code" defaultValue={segment.destination?.code} />
        <Field name="dest_city" title="City" defaultValue={segment.destination?.city} />
        <Field name="dest_name" title="Name" defaultValue={segment.destination?.name} />
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="property_name" title="Hotel name" defaultValue={d.property_name} />
        <Field name="company" title="Rental company" defaultValue={d.company} />
        <Field name="address" title="Address" defaultValue={d.address ?? segment.destination?.address} />
        <Field name="phone" title="Phone" defaultValue={d.phone} type="tel" />
        <Field name="check_in_url" title="Check-in link" defaultValue={d.check_in_url} type="url" />
      </div>

      {message ? (
        <p role="status" className="font-semibold">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={pending}>
          Confirm
        </button>
        <button
          type="button"
          className={button}
          disabled={pending}
          onClick={(e) => submit(e.currentTarget.form!, "save")}
        >
          Save without confirming
        </button>
        <button
          type="button"
          className={button}
          disabled={pending}
          onClick={(e) => submit(e.currentTarget.form!, "cancel")}
        >
          Mark cancelled
        </button>
        {emailFailed && segment.source_email_id ? (
          <button type="button" className={button} disabled={pending} onClick={retry}>
            Retry extraction
          </button>
        ) : null}
        <button type="button" className={button} disabled={pending} onClick={remove}>
          Delete
        </button>
      </div>
    </form>
  );
}
