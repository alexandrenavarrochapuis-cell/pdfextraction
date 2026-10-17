"use client";

// The Atlas logo as a live mark: the plane flies its orbit around the globe
// and the star twinkles. "thinking" speeds the plane up while Atlas works.
// Still for anyone who asks their device to reduce motion.

import { useId, useSyncExternalStore } from "react";

const INK = "#1b1b1f";
const ACCENT = "#2047C4";
const GOLD = "#E3A21A";
const PAPER = "#f5f4f1";
const FRONT = "M -196 0 A 196 62 0 0 0 196 0";
const LOOP = "M 196 0 A 196 62 0 0 1 -196 0 A 196 62 0 0 1 196 0";

export type MarkMotion = "still" | "idle" | "thinking";

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  // Still on the server and in the first paint; the client decides after.
  return useSyncExternalStore(subscribe, () => window.matchMedia(REDUCE).matches, () => true);
}

export function AtlasMark({
  size = 40,
  motion = "still",
  label,
  background = false,
}: {
  size?: number;
  motion?: MarkMotion;
  /** Accessible name; omit when a visible "Atlas" label sits next to it. */
  label?: string;
  background?: boolean;
}) {
  const clip = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const moving = motion !== "still" && !reduced;
  const duration = motion === "thinking" ? "1.6s" : "7s";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={moving ? `atlas-mark atlas-mark-${motion}` : "atlas-mark"}
    >
      <defs>
        <clipPath id={clip}>
          <circle r="146" />
        </clipPath>
      </defs>
      {background ? <rect width="512" height="512" rx="96" fill={PAPER} /> : null}
      <g transform="translate(256 268)">
        <ellipse rx="196" ry="62" transform="rotate(-22)" fill="none" stroke={ACCENT} strokeWidth="16" />
        <g className="atlas-globe">
          <circle r="132" fill={PAPER} stroke={INK} strokeWidth="20" />
          <ellipse rx="58" ry="132" fill="none" stroke={INK} strokeWidth="13" />
          <line x1="-132" y1="0" x2="132" y2="0" stroke={INK} strokeWidth="13" />
        </g>
        <g clipPath={`url(#${clip})`}>
          <path d={FRONT} transform="rotate(-22)" fill="none" stroke={PAPER} strokeWidth="36" />
        </g>
        <path d={FRONT} transform="rotate(-22)" fill="none" stroke={ACCENT} strokeWidth="16" />
        {moving ? (
          <g transform="rotate(-22)">
            <circle r="19" fill={ACCENT}>
              <animateMotion dur={duration} repeatCount="indefinite" path={LOOP} />
            </circle>
          </g>
        ) : (
          <circle cx="179" cy="-50" r="19" fill={ACCENT} />
        )}
      </g>
      <path
        className="atlas-star"
        d="M 134 96 L 142 121 L 167 129 L 142 137 L 134 162 L 126 137 L 101 129 L 126 121 Z"
        fill={GOLD}
      />
    </svg>
  );
}
