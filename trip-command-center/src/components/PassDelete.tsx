"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function PassDelete({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="inline-flex min-h-12 items-center rounded-xl border border-line bg-paper px-4 font-semibold"
      onClick={() =>
        start(async () => {
          if (!window.confirm("Delete this boarding pass?")) return;
          await fetch(`/api/passes/${id}`, { method: "DELETE" });
          router.refresh();
        })
      }
    >
      Delete
    </button>
  );
}
