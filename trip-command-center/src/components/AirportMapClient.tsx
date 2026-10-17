"use client";

import dynamic from "next/dynamic";
import type { AirportPoi } from "@/lib/airport/pois";

const AirportMap = dynamic(() => import("./AirportMap"), {
  ssr: false,
  loading: () => <div className="h-[60vh] min-h-96 rounded-2xl border border-line bg-paper" />,
});

export function AirportMapClient(props: { pois: AirportPoi[]; center: { lat: number; lng: number }; initialGate?: string }) {
  return <AirportMap {...props} />;
}
