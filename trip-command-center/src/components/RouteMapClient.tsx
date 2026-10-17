"use client";

import dynamic from "next/dynamic";
import type { RoutePoint } from "./RouteMap";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="h-[55vh] min-h-80 rounded-2xl border border-line bg-paper" />,
});

export function RouteMapClient({ points, driveId }: { points: RoutePoint[]; driveId?: string }) {
  return <RouteMap points={points} driveId={driveId} />;
}
