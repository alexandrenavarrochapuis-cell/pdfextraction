// Type and status badges. Each pairs an icon with a text label, and statuses
// also differ by border style, so they read the same in grayscale.

import type { SegmentStatus, SegmentType } from "@/lib/types";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/present";
import { AlertIcon, CheckIcon, TypeIcon, XIcon } from "./icons";

export function TypeBadge({ type, label }: { type: SegmentType; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink">
      <TypeIcon type={type} size={18} />
      {label ?? TYPE_LABEL[type]}
    </span>
  );
}

const STATUS_STYLE: Record<SegmentStatus, string> = {
  confirmed: "border border-solid border-line",
  cancelled: "border-2 border-solid border-ink line-through",
  needs_review: "border-2 border-dashed border-ink",
};

export function StatusBadge({ status }: { status: SegmentStatus }) {
  const Icon = status === "confirmed" ? CheckIcon : status === "cancelled" ? XIcon : AlertIcon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-0.5 text-sm font-semibold ${STATUS_STYLE[status]}`}
    >
      <Icon size={15} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ReviewCountBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border-2 border-dashed border-ink bg-paper px-2.5 py-0.5 text-sm font-semibold">
      <AlertIcon size={15} />
      Review {count > 1 ? `(${count})` : ""}
    </span>
  );
}
