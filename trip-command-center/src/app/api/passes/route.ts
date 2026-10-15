// POST /api/passes: upload a boarding pass (Wallet .pkpass, PDF or screenshot)
// for any family member. It is matched to a flight and a traveler when the
// form does not say which.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { passKind, saveBoardingPass } from "@/lib/passes/store";

const MAX_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 10 MB" }, { status: 400 });
  if (!passKind(file.type, file.name)) {
    return NextResponse.json({ error: "Use a Wallet pass (.pkpass), a PDF or an image" }, { status: 400 });
  }
  const segmentId = String(form.get("segment_id") ?? "");
  const travelerId = String(form.get("traveler_id") ?? "");
  // RLS check that the chosen flight and traveler belong to the caller.
  if (segmentId && !(await session.db.from("segments").select("id").eq("id", segmentId).maybeSingle()).data) {
    return NextResponse.json({ error: "Flight not found" }, { status: 404 });
  }
  if (travelerId && !(await session.db.from("travelers").select("id").eq("id", travelerId).maybeSingle()).data) {
    return NextResponse.json({ error: "Traveler not found" }, { status: 404 });
  }
  const id = await saveBoardingPass(createAdminClient(), {
    userId: session.user.id,
    bytes: new Uint8Array(await file.arrayBuffer()),
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    segmentId: UUID.test(segmentId) ? segmentId : null,
    travelerId: UUID.test(travelerId) ? travelerId : null,
  });
  return NextResponse.json({ id });
}
