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

To save an email from Gmail, open it, choose Show original, then Download
Original. In Outlook, use Save as.

`tests/live-extraction.test.ts` sends every real fixture through the full
extraction path (markup first, then Claude, with PDF and `.ics` attachments)
and writes what it extracted to `<name>.extracted.json`, in the same shape as
an expected file. Review it, correct anything wrong, and save it as
`<name>.expected.json` to turn it into a regression check.

Expected file shape:

```json
{
  "is_travel": true,
  "segments": [
    { "type": "flight", "confirmation_code": "ABC123", "flight_number": "AF 91",
      "origin": "CDG", "destination": "IAD", "start_at": "2026-06-24T10:25:00.000Z" }
  ]
}
```

- Only the fields you list are checked. Each listed segment must match a
  different extracted segment, and the number of segments must be the same.
- Matching ignores case and spaces, so `DL84` matches `DL 84`.
- `origin` and `destination` compare against the place's airport or station
  code, or its city when it has no code, or its name when it has neither.
- `start_at` and `end_at` compare as instants, so any ISO 8601 form works.
- Any other field (`flight_number`, `seat`, `property_name`, ...) is
  looked up in the segment's details.
