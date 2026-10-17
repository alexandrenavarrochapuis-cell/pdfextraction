// Edit any segment from the timeline.

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { segmentTitle } from "@/lib/present";
import { toLocalInput } from "@/lib/time";
import type { Segment } from "@/lib/types";
import { SegmentEditForm } from "@/components/SegmentEditForm";
import { TypeBadge } from "@/components/Badges";
import { Loading } from "@/components/Loading";

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requireUser();
  const { data } = await db.from("segments").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const segment = data as Segment;
  return (
    <>
      <TypeBadge type={segment.type} />
      <h1 className="mb-4 mt-1 text-2xl font-bold">{segmentTitle(segment)}</h1>
      <div className="rounded-2xl border border-line bg-paper p-4">
        <SegmentEditForm
          segment={segment}
          defaults={{
            start_local: toLocalInput(segment.start_at, segment.start_tz),
            end_local: toLocalInput(segment.end_at, segment.end_tz),
          }}
          afterSave="back"
        />
      </div>
    </>
  );
}

export default function SegmentPage({ params }: PageProps<"/segments/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Editor params={params} />
    </Suspense>
  );
}
