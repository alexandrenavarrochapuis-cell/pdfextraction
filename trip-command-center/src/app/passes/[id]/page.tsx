// Full-screen barcode for the gate scanner: white background, as large as
// the screen allows. Turn the screen brightness up before scanning.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { barcodeSvg } from "@/lib/passes/barcode";
import type { BoardingPass, Traveler } from "@/lib/types";
import { Loading } from "@/components/Loading";

async function Gate({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requireUser();
  const { data } = await db.from("boarding_passes").select("*").eq("id", id).maybeSingle();
  const pass = data as BoardingPass | null;
  if (!pass?.barcode_message) notFound();
  const { data: traveler } = pass.traveler_id
    ? await db.from("travelers").select("*").eq("id", pass.traveler_id).maybeSingle()
    : { data: null };
  const svg = barcodeSvg(pass.barcode_message, pass.barcode_format);
  return (
    <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-4 bg-white p-4 text-ink">
      <p className="text-2xl font-bold">{(traveler as Traveler | null)?.name ?? pass.passenger_name}</p>
      <p className="text-lg font-semibold">
        {[pass.carrier, pass.flight_number].filter(Boolean).join(" ")}
        {pass.seat ? ` · Seat ${pass.seat}` : ""}
        {pass.boarding_group ? ` · Group ${pass.boarding_group}` : ""}
      </p>
      {svg ? (
        <div className="w-full max-w-xl [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : null}
      <p className="text-muted">Turn screen brightness up for the scanner.</p>
      <Link href="/passes" className="min-h-12 rounded-xl border-2 border-ink px-6 py-3 font-semibold">
        Done
      </Link>
    </div>
  );
}

export default function GatePassPage({ params }: PageProps<"/passes/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Gate params={params} />
    </Suspense>
  );
}
