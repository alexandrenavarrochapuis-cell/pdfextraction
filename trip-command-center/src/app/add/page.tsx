// Add something that did not arrive by email: a road trip, a family or
// office stop, a meeting, a stay, a train.

import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import type { SavedPlace } from "@/lib/types";
import { AddForm } from "@/components/AddForm";
import { Loading } from "@/components/Loading";

const KINDS = new Set(["drive", "stop", "hotel", "train", "flight", "event"]);

type AddParams = { type?: string; name?: string; provider?: string; address?: string; checkin?: string; checkout?: string };

async function Body({ searchParams }: { searchParams: Promise<AddParams> }) {
  const { type, name, provider, address, checkin, checkout } = await searchParams;
  const { db } = await requireUser();
  const { data } = await db.from("places").select("*").order("kind").order("label");
  const places = (data ?? []) as SavedPlace[];
  return (
    <>
      {!places.length ? (
        <p className="mb-4 rounded-2xl border border-line bg-paper p-4">
          Tip: save Home, family, friends and office in{" "}
          <Link href="/settings" className="font-semibold underline">
            Settings
          </Link>{" "}
          to pick them here.
        </p>
      ) : null}
      <AddForm
        places={places}
        initialKind={type && KINDS.has(type) ? (type as "drive") : "drive"}
        prefill={{ property_name: name, provider, address, start_local: checkin, end_local: checkout }}
      />
    </>
  );
}

export default function AddPage({ searchParams }: PageProps<"/add">) {
  return (
    <>
      <h1 className="mb-4 text-3xl font-bold">Add</h1>
      <Suspense fallback={<Loading />}>
        <Body searchParams={searchParams as Promise<AddParams>} />
      </Suspense>
    </>
  );
}
