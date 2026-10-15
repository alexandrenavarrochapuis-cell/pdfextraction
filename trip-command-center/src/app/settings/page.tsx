// Screen 4: settings (spec section 6).

import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { allowedForwarders, inboundAddress } from "@/lib/config";
import type { Profile, SavedPlace, Traveler } from "@/lib/types";
import { CopyButton } from "@/components/CopyButton";
import { PushToggle } from "@/components/PushToggle";
import { Loading } from "@/components/Loading";
import { signOut } from "../login/actions";
import {
  addPlace,
  addTraveler,
  deletePlace,
  deleteTraveler,
  disableCalendarFeed,
  rotateCalendarToken,
  saveBriefSettings,
} from "./actions";
import { headers } from "next/headers";

const card = "rounded-2xl border border-line bg-paper p-4 space-y-3";

const PLACE_KIND_LABEL: Record<SavedPlace["kind"], string> = {
  home: "Home",
  family: "Family",
  friend: "Friends",
  office: "Office",
  other: "Other",
};

function hourLabel(h: number): string {
  const suffix = h < 12 ? "a.m." : "p.m.";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${suffix}`;
}

async function SettingsBody() {
  const { db, user } = await requireUser();
  const [{ data }, { data: placeRows }, { data: travelerRows }] = await Promise.all([
    db.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    db.from("places").select("*").order("kind").order("label"),
    db.from("travelers").select("*").order("name"),
  ]);
  const travelers = (travelerRows ?? []) as Traveler[];
  const h = await headers();
  const host = h.get("host");
  const calendarToken = (data as { calendar_token?: string | null } | null)?.calendar_token ?? null;
  const feedUrl = calendarToken && host ? `https://${host}/api/calendar/${calendarToken}.ics` : null;
  const profile = data as Profile | null;
  const places = (placeRows ?? []) as SavedPlace[];
  const address = inboundAddress();
  const forwarders = allowedForwarders();

  return (
    <div className="space-y-5">
      <section className={card}>
        <h2 className="text-xl font-bold">Inbound address</h2>
        {address ? (
          <>
            <p className="break-all font-mono text-lg font-bold">{address}</p>
            <CopyButton value={address} label="Copy address" />
          </>
        ) : (
          <p>Set INBOUND_ADDRESS on the server to show it here.</p>
        )}
        <p className="text-muted">
          Accepted from: {forwarders.length ? forwarders.join(", ") : "no forwarders configured (ALLOWED_FORWARDERS)"}.
        </p>
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Forwarding rules</h2>
        <details>
          <summary className="flex min-h-12 cursor-pointer items-center font-semibold">Gmail (alex@sidus.group)</summary>
          <ol className="list-decimal space-y-1 pl-6">
            <li>Gmail settings, Forwarding and POP/IMAP, Add a forwarding address: the inbound address above.</li>
            <li>
              Gmail sends a confirmation code to that address. Read it in the Resend dashboard under Emails,
              Receiving, and enter it in Gmail.
            </li>
            <li>
              Create a filter. From: <code>delta.com OR aa.com OR airfrance.fr OR marriott.com OR hilton.com OR
              avis.com OR hertz.com OR booking.com</code> (add others as they come up). Choose “Forward it to” the
              inbound address.
            </li>
          </ol>
        </details>
        <details>
          <summary className="flex min-h-12 cursor-pointer items-center font-semibold">Outlook (Performa)</summary>
          <ol className="list-decimal space-y-1 pl-6">
            <li>Outlook settings, Mail, Rules, Add new rule.</li>
            <li>Condition: From contains the same airline, hotel, car and booking domains.</li>
            <li>Action: Forward to the inbound address.</li>
            <li>If the rule is blocked, the Performa tenant may restrict external forwarding; ask IT, or forward by hand.</li>
          </ol>
        </details>
        <p className="text-muted">Anything else: forward the email to the inbound address by hand.</p>
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Travelers</h2>
        <p className="text-muted">You and your family. Boarding passes and passports are filed under these names.</p>
        {travelers.length ? (
          <ul className="divide-y divide-line">
            {travelers.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-semibold">
                    {t.name} <span className="text-sm font-normal text-muted">({t.relation})</span>
                  </p>
                  {t.name_variants.length ? <p className="text-sm text-muted">Also printed as {t.name_variants.join(", ")}</p> : null}
                </div>
                <form action={deleteTraveler}>
                  <input type="hidden" name="id" value={t.id} />
                  <button className="min-h-12 rounded-xl border border-line px-3 font-semibold">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        <form action={addTraveler} className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input name="name" required placeholder="Full name as on the passport" className="min-h-12 rounded-xl border-2 border-line bg-paper px-3" />
          <select name="relation" defaultValue={travelers.length ? "child" : "self"} className="min-h-12 rounded-xl border-2 border-line bg-paper px-3">
            <option value="self">Me</option>
            <option value="spouse">Spouse or partner</option>
            <option value="child">Child</option>
            <option value="parent">Parent</option>
            <option value="other">Other</option>
          </select>
          <input
            name="name_variants"
            placeholder="Optional: name as airlines print it, e.g. NAVARRO/ALEXANDRE"
            className="min-h-12 rounded-xl border-2 border-line bg-paper px-3 sm:col-span-2"
          />
          <button className="min-h-12 rounded-xl bg-accent px-5 font-bold text-white sm:col-span-2">Add traveler</button>
        </form>
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Places</h2>
        <p className="text-muted">
          Home, family, friends and office, for road trips and stops. A drive that ends at Home closes the trip.
        </p>
        {places.length ? (
          <ul className="divide-y divide-line">
            {places.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-semibold">
                    {p.label} <span className="text-sm font-normal text-muted">({PLACE_KIND_LABEL[p.kind]})</span>
                  </p>
                  <p className="text-sm text-muted">{p.address}</p>
                  {p.lat == null ? <p className="text-sm font-semibold">Address not found on the map; check it.</p> : null}
                </div>
                <form action={deletePlace}>
                  <input type="hidden" name="id" value={p.id} />
                  <button className="min-h-12 rounded-xl border border-line px-3 font-semibold">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        <form action={addPlace} className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input name="label" required placeholder="Name, e.g. Mom's house" className="min-h-12 rounded-xl border-2 border-line bg-paper px-3" />
          <select name="kind" defaultValue="family" className="min-h-12 rounded-xl border-2 border-line bg-paper px-3">
            {Object.entries(PLACE_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            name="address"
            required
            placeholder="Street address"
            autoComplete="street-address"
            className="min-h-12 rounded-xl border-2 border-line bg-paper px-3 sm:col-span-2"
          />
          <button className="min-h-12 rounded-xl bg-accent px-5 font-bold text-white sm:col-span-2">Save place</button>
        </form>
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Calendar feed</h2>
        <p className="text-muted">
          Every booking in your calendar, kept up to date. Confirmation codes are not included. Anyone with the link can
          see your itinerary, so make a new link if it leaks.
        </p>
        {feedUrl ? (
          <>
            <p className="break-all font-mono text-sm">{feedUrl}</p>
            <div className="flex flex-wrap gap-2">
              <CopyButton value={feedUrl} label="Copy link" />
              <a
                href={feedUrl.replace(/^https:/, "webcal:")}
                className="inline-flex min-h-12 items-center rounded-xl border border-line bg-paper px-4 font-semibold"
              >
                Subscribe on this iPhone
              </a>
            </div>
            <ul className="list-disc space-y-1 pl-6 text-sm">
              <li>Outlook: Calendar, Add calendar, Subscribe from web, paste the link.</li>
              <li>Google Calendar: Other calendars, +, From URL, paste the link.</li>
              <li>Apple Calendar: tap Subscribe on this iPhone.</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <form action={rotateCalendarToken}>
                <button className="min-h-12 rounded-xl border border-line px-4 font-semibold">Make a new link</button>
              </form>
              <form action={disableCalendarFeed}>
                <button className="min-h-12 rounded-xl border border-line px-4 font-semibold">Turn off</button>
              </form>
            </div>
          </>
        ) : (
          <form action={rotateCalendarToken}>
            <button className="min-h-12 rounded-xl bg-accent px-5 font-bold text-white">Create calendar link</button>
          </form>
        )}
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Notifications</h2>
        <PushToggle vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Day-before brief</h2>
        <form action={saveBriefSettings} className="space-y-3">
          <label className="block space-y-1">
            <span className="font-semibold">Send at (your local time wherever you are)</span>
            <select
              name="brief_hour"
              defaultValue={profile?.brief_hour ?? 19}
              className="min-h-12 w-full rounded-xl border-2 border-line bg-paper px-3"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-12 items-center gap-3">
            <input
              type="checkbox"
              name="push_enabled"
              defaultChecked={profile?.push_enabled ?? true}
              className="size-6"
            />
            <span className="font-semibold">Send the brief as a notification</span>
          </label>
          <button className="min-h-12 rounded-xl bg-accent px-5 font-bold text-white">Save</button>
        </form>
      </section>

      <form action={signOut}>
        <button className="min-h-12 rounded-xl border-2 border-ink bg-paper px-5 font-semibold">Sign out</button>
      </form>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <h1 className="mb-4 text-3xl font-bold">Settings</h1>
      <Suspense fallback={<Loading />}>
        <SettingsBody />
      </Suspense>
    </>
  );
}
