// Local time at the place, large; Florida time small beneath (spec section 6).

import { formatDay, formatTime, formatTimeWithZone, localDateKey, tzOffsetMinutes } from "@/lib/time";

export function TimePair({
  at,
  tz,
  homeTz,
  size = "lg",
}: {
  at: string;
  tz: string;
  homeTz: string;
  size?: "lg" | "md";
}) {
  const date = new Date(at);
  const sameZone = tzOffsetMinutes(date, tz) === tzOffsetMinutes(date, homeTz);
  const dayDiffers = localDateKey(date, tz) !== localDateKey(date, homeTz);
  return (
    <div className="leading-tight">
      <div className={size === "lg" ? "text-2xl font-bold tabular-nums" : "text-lg font-semibold tabular-nums"}>
        <time dateTime={at}>{formatTimeWithZone(date, tz)}</time>
      </div>
      <div className="text-sm text-muted tabular-nums">
        {sameZone ? "Florida time" : `Florida ${formatTime(date, homeTz)}`}
        {!sameZone && dayDiffers ? `, ${formatDay(date, homeTz)}` : ""}
      </div>
    </div>
  );
}
