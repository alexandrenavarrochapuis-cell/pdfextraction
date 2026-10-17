# Atlas

<img src="public/icons/logo.svg" alt="Atlas logo" width="96" height="96">

Atlas, named for the Titan who holds up the heavens, is a mobile-first web
app (installable on iPhone) that turns forwarded travel confirmations into one
trip timeline, sends a brief the evening before each travel day, and keeps the
family's boarding passes and travel documents in one place.

Built from the Trip Command Center Phase 1 spec (itinerary timeline and
day-before brief; the code still lives in `trip-command-center/`), plus
the features requested afterwards: flight tracking, road trips, boarding
passes, a document vault, an AI assistant and airport maps.

## What it does

**Itinerary from email.** Forward airline, hotel, car, rail, Booking.com or
Airbnb confirmations (or calendar invites) to the inbound address. The app
reads schema.org reservation markup when the email has it, and otherwise
asks Claude (`claude-sonnet-5-5`, structured output). Changed flights update
in place, cancellations are struck through, and incomplete items land in a
review queue next to the source email. Segments group into trips
automatically: under 48 hours apart or in the same city, and a flight landing
at SRQ or TPA (or a drive ending at Home) ends the trip.

**Timeline.** Day by day, local time large with Florida time underneath.
Copy a confirmation code, check in, open Maps, call the hotel. The timeline
also shows layovers (tight connections flagged), nights with no place to stay
booked (with Booking.com and Airbnb searches), passport expiry warnings, the
GSA per diem for US trips, and country briefs for trips abroad.

**Day-before brief.** At 7 p.m. in whatever time zone you are in, a push
notification covers the first departure, when to leave home, hotel and car,
weather, the time difference, PreCheck and Global Entry reminders, and
anything to review. It is sent once per trip and day.

**Flight map.** Follows your plane in the air and, before boarding, the
inbound aircraft that will operate your flight. Live position needs a
FlightAware AeroAPI key; without one the position is estimated from the
schedule.

**Road trips.** Drives in the Tesla or Porsche with up to 9 stops: open
turn-by-turn in Google Maps (all stops), Apple Maps or Waze, or send a stop
to the car through the iPhone share sheet (the Tesla app accepts shared
addresses). Saved places (home, family, friends, office) feed drives and
personal or meeting stops. A shorter stop order is suggested when there is
one.

**Boarding passes.** For the whole family, from forwarded emails (Apple Wallet
`.pkpass` files are read directly; PDF passes are identified by Claude) or by
upload. Each pass is matched to the flight and the traveler through the IATA
bar-coded boarding pass data. The barcode shows full screen at the gate, Wallet
passes go back into Apple Wallet, and a US departure without TSA PreCheck on
the pass is flagged.

**Passports and IDs.** Numbers, notes and scans are encrypted in the browser
with a passphrase only you know (PBKDF2 and AES-GCM); the server stores
ciphertext only. Expiry dates stay readable for warnings. A forgotten
passphrase cannot be recovered.

**AI assistant.**
- *Country brief:* entry rules for each passport you hold, what you can bring
  in and back to the US, vaccines, emergency numbers, US and French embassies
  and the State Department advisory. Researched by Claude (`claude-opus-5-5`
  with web search limited to official government sites), with sources and a
  date.
- *Trip planner:* give a destination, dates and preferences. It researches
  hotels near the destination, favoring Hilton and Marriott (or the brands
  you choose) and the GSA lodging rate, and compares flying, driving and rail
  from home.
- *Calendar feed:* a private iCalendar link that Outlook, Google Calendar and
  Apple Calendar subscribe to. Confirmation codes are left out.

**Airport maps.** Gates, restrooms, food, lounges, shops and security from
OpenStreetMap, with your GPS position, gate search and walking distance.

## Design rules

Light background and dark text. The accent `#BE2332` is used sparingly.
Every status and type has an icon and a text label, and statuses also differ
by border: dashed means review, strikethrough means cancelled. Nothing relies
on color alone, so every screen reads in grayscale. Tap targets are at least
48 px.

## Stack

Next.js 16 (App Router, Cache Components) with TypeScript and Tailwind 4.
Supabase (Postgres with RLS on every table, Auth, Storage). Resend inbound
email. Claude API. Open-Meteo (weather, geocoding), OpenStreetMap (Nominatim
geocoding, Overpass airport data, map tiles), Leaflet, web push with VAPID.
Hosted on Vercel.

## Setup

1. **Supabase.** Create a project. Apply the migrations in order with
   `supabase db push`, or paste `supabase/migrations/*.sql` into the SQL
   editor.
   - Sign-in email: set `AUTH_EMAIL_FROM` (step 3) and Atlas sends the code
     itself through Resend, so the two settings below can stay as they are.
     Without it, Supabase's built-in mailer sends the code (2 emails an hour)
     and needs them:
     - Auth > Email templates > Magic Link: add `{{ .Token }}` to the
       template. On iPhone, the home-screen app keeps its own cookies, so you
       sign in by typing the 6-digit code; a link would sign in Safari instead.
     - Auth > URL configuration: set the site URL to your Vercel domain and
       add `https://<domain>/auth/confirm` to the redirect URLs.
   - After your first sign-in, turn off new sign-ups (Auth > Providers >
     Email). The app also refuses any email other than `OWNER_EMAIL` and
     `HOUSEHOLD_EMAILS`. A household address gets its own sign-in code and
     opens the owner's account, so the family shares one set of trips.
   - Scheduling runs in the database (`0007_scheduler.sql`: pg_cron calls
     the app hourly for briefs and daily for the purge), so it works on any
     Vercel plan. After the first deploy, store the app URL and the cron
     secret in Vault once (SQL editor):
     `select vault.create_secret('https://<domain>', 'atlas_app_url');` and
     `select vault.create_secret('<CRON_SECRET>', 'atlas_cron_secret');`.
2. **Resend.** Add a receiving subdomain (for example `inbound.<your-domain>`,
   so your main mail is untouched) and its MX record. Pick a random inbound
   address on it for `INBOUND_ADDRESS`: mail Resend did not deliver to exactly
   that address is rejected, so keep it out of anything but your forwarding
   rules. Create a webhook for `email.received` pointing to
   `https://<domain>/api/ingest/email` and put its signing secret in
   `RESEND_WEBHOOK_SECRET`. For sign-in codes, verify a sending domain too and
   set `AUTH_EMAIL_FROM` to an address on it; `RESEND_API_KEY` then needs
   full access (receiving and sending).
3. **Environment.** Copy `.env.example` and fill it in. Generate VAPID keys
   with `npx web-push generate-vapid-keys`.
4. **Vercel.** Import the repo with root directory `trip-command-center`.
   Any plan works; the schedule lives in Supabase (step 1).
5. **Sign in** on the phone, add the app to the Home Screen (Share > Add to
   Home Screen), open it from there, and turn on notifications in Settings.
   In Settings, also add your travelers and places, and create the calendar
   link.
6. **Forwarding.**
   - Gmail: add the inbound address as a forwarding address. The
     confirmation code arrives at the inbound address; read it in the Resend
     dashboard (Emails > Receiving). Then create a filter for airline, hotel,
     car and booking senders that forwards to it.
   - Outlook (Performa): create a rule that forwards the same senders. If
     the tenant blocks external forwarding, forward by hand or ask IT.

## Development

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev                  # http://localhost:3000
npm test                     # Vitest, 108 tests, no network
npm run lint && npm run typecheck && npm run build
```

GitHub Actions runs the same checks (lint, typecheck, tests, build) on every
pull request that touches this folder; see
`.github/workflows/trip-command-center.yml` at the repo root.

`fixtures/synthetic/` holds hand-written `.eml` files that go through the real
pipeline in the tests. Real confirmations go in the gitignored
`fixtures/real/` and run against Claude with `npm run test:live`; see
`fixtures/README.md`.

## What was and was not verified

Verified in this repo: unit and pipeline tests over the synthetic fixtures,
lint, typecheck and production build. Not exercised against live services
from the build sandbox: Supabase, Resend, the Claude API, web push,
FlightAware AeroAPI, the GSA API, Overpass and Nominatim. The AeroAPI and GSA
response field names follow their published docs and are read defensively.
The first real deploy should be checked end to end.

## Not built, and why

- **Booking.com and Airbnb APIs.** Neither offers an API for a traveler's own
  reservations; their APIs are for partners and property managers.
  Forwarding the confirmation emails captures the same data.
- **Gmail, Outlook and Google Calendar account access.** This needs OAuth.
  Gmail read access is a restricted Google scope that needs Google's security verification.
  The Performa Outlook tenant needs admin consent, and the spec rules out
  tenant OAuth. Forwarding rules cover the inbound side, and the calendar
  feed covers writing to your calendars without account access.
- **Tesla Fleet API.** Battery-aware routing, preconditioning and sending
  routes from the server need Tesla developer registration, a hosted public
  key and per-call billing. The share sheet covers sending destinations
  today. Porsche has no public API.
- **Security wait times and lounge access rules.** There is no reliable free
  data source; the airport map shows lounge locations.
- Phase 2 backlog from the spec: gate-change push alerts, receipt capture to
  Performa Expenses, rental condition photo log, WhatsApp delivery, and
  meeting context from calendar and HubSpot.
