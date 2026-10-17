"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function ReorderStops({
  segmentId,
  order,
  labels,
  currentKm,
  suggestedKm,
}: {
  segmentId: string;
  order: number[];
  labels: string[];
  currentKm: number;
  suggestedKm: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-2xl border-2 border-dashed border-ink bg-paper p-4">
      <p className="font-bold">Shorter order found</p>
      <p>
        {order.map((i) => labels[i]).join(" → ")}: about {currentKm - suggestedKm} km less in a straight line ({suggestedKm} km
        instead of {currentKm} km).
      </p>
      <button
        type="button"
        disabled={pending}
        className="min-h-12 rounded-xl bg-accent px-5 font-bold text-white disabled:opacity-60"
        onClick={() =>
          start(async () => {
            await fetch(`/api/segments/${segmentId}/stops`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ order }),
            });
            router.refresh();
          })
        }
      >
        Use this order
      </button>
    </div>
  );
}
