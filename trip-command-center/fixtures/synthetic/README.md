# Fixtures

`synthetic/` holds hand-written confirmation emails with fake names and
booking codes. They exercise the pipeline offline in `npm test`:

| File | Path through the pipeline |
|---|---|
| `delta-paris-roundtrip.eml` | schema.org FlightReservation markup, Gmail auto-forward headers |
| `marriott-paris.eml` | LodgingReservation with dates only (default check-in/out hours) |
| `hertz-paris.eml` | RentalCarReservation, manual forward from Alex |
| `hertz-paris-cancel.eml` | Cancellation markup for the same rental |
| `delta-schedule-change.eml` | Free text; Claude path. `*.claude.json` is the canned model output |
| `airline-newsletter.eml` | Not a booking; Claude says so |
| `spoofed-sender.eml` | Not forwarded by an allowlisted address; rejected |

`real/` is for the 10 to 15 real confirmations the spec asks for (Air France,
Delta, American, Marriott, Hilton, Avis, Hertz, Booking.com). It is
gitignored because real confirmations carry names, booking codes and
sometimes partial card numbers. Drop `.eml` files there, optionally with a
`<name>.expected.json` next to each, and run:

```bash
ANTHROPIC_API_KEY=... npm run test:live
```

`tests/live-extraction.test.ts` sends every real fixture through the full
extraction path (markup first, then Claude) and checks the fields listed in
the expected file. Without an expected file it prints what was extracted, so
you can review it and save it as the expectation.

Expected file shape (only the fields you list are checked):

```json
{
  "segments": [
    { "type": "flight", "confirmation_code": "ABC123", "flight_number": "AF 91",
      "origin": "CDG", "destination": "IAD", "start_at": "2026-06-24T10:25:00.000Z" }
  ]
}
```
