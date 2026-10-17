// Screen 3: review queue. Each flagged segment sits beside its source email
// so fields can be checked and corrected quickly (spec section 6).

import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { listReviewItems } from "@/lib/data";
import { emailBodyText } from "@/lib/ingest/html";
import { segmentTitle } from "@/lib/present";
import { toLocalInput } from "@/lib/time";
import { TypeBadge } from "@/components/Badges";
import { SegmentEditForm } from "@/components/SegmentEditForm";
import { Loading } from "@/components/Loading";
import { AlertIcon } from "@/components/icons";

async function Queue() {
  const { db } = await requireUser();
  const items = await listReviewItems(db);
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-line bg-paper p-5">
        <p className="font-semibold">Nothing to review.</p>
        <p className="text-muted">Bookings that need a second look land here.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-6">
      {items.map(({ segment, email }) => (
        <li key={segment.id} className="rounded-2xl border-2 border-dashed border-ink bg-paper p-4">
          <div className="flex items-center justify-between gap-2">
            <TypeBadge type={segment.type} />
            <span className="inline-flex items-center gap-1 font-semibold">
              <AlertIcon size={16} /> Review
            </span>
          </div>
          <h2 className="mt-2 text-xl font-bold">{segmentTitle(segment)}</h2>
          {segment.review_reasons.length ? (
            <p className="mt-1">Why: {segment.review_reasons.join(", ")}.</p>
          ) : null}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section aria-label="Source email" className="rounded-xl border border-line p-3">
              <h3 className="font-bold">Source email</h3>
              {email ? (
                <>
                  <p className="text-sm text-muted">
                    {email.from_addr} · {new Date(email.received_at).toLocaleString("en-US")}
                  </p>
                  <p className="mt-1 font-semibold">{email.subject}</p>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">
                    {emailBodyText(email.body_text, email.body_html) || "(empty body)"}
                  </pre>
                </>
              ) : (
                <p className="text-muted">The source email is no longer stored (kept 90 days).</p>
              )}
            </section>
            <section aria-label="Extracted fields">
              <SegmentEditForm
                segment={segment}
                defaults={{
                  start_local: toLocalInput(segment.start_at, segment.start_tz),
                  end_local: toLocalInput(segment.end_at, segment.end_tz),
                }}
                emailFailed={email?.processing_status === "failed"}
              />
            </section>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ReviewPage() {
  return (
    <>
      <h1 className="mb-4 text-3xl font-bold">Review</h1>
      <Suspense fallback={<Loading label="Loading review queue…" />}>
        <Queue />
      </Suspense>
    </>
  );
}
