// AI trip planner: describe the trip, get hotels and a way to get there.

import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import type { PlanRequest } from "@/lib/assistant/planner";
import { PlanForm } from "@/components/PlanForm";
import { Loading } from "@/components/Loading";

async function PastPlans() {
  const { db } = await requireUser();
  const { data } = await db.from("trip_plans").select("id, request, status, created_at").order("created_at", { ascending: false }).limit(20);
  const plans = (data ?? []) as { id: string; request: PlanRequest; status: string; created_at: string }[];
  if (!plans.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Earlier plans</h2>
      <ul className="space-y-2">
        {plans.map((p) => (
          <li key={p.id}>
            <Link href={`/plan/${p.id}`} className="block rounded-2xl border border-line bg-paper p-3">
              <p className="font-semibold">{p.request.destination}</p>
              <p className="text-sm text-muted">
                {p.request.start_date} to {p.request.end_date} · {p.status === "ready" ? "Ready" : p.status === "failed" ? "Failed" : "Working"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function PlanPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Plan a trip</h1>
        <p className="text-muted">
          Claude researches hotels near where you need to be, favoring your brands and the per diem, and compares flying,
          driving and the train from home.
        </p>
      </div>
      <div className="rounded-2xl border border-line bg-paper p-4">
        <PlanForm />
      </div>
      <Suspense fallback={<Loading />}>
        <PastPlans />
      </Suspense>
    </div>
  );
}
