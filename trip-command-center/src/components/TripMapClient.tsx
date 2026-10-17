"use client";

import dynamic from "next/dynamic";
import type { TripMapData } from "@/lib/trips/map";

const TripMap = dynamic(() => import("./TripMap"), {
  ssr: false,
  loading: () => <div className="h-[65vh] min-h-96 rounded-2xl border border-line bg-paper" />,
});

export function TripMapClient({ data }: { data: TripMapData }) {
  return <TripMap data={data} />;
}
