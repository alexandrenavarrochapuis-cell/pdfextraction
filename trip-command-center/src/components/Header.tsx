"use client";

// Top bar on every screen: the Atlas mark and name, and a way to ask Atlas.
// The sign-in screen has its own large logo.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AtlasMark } from "./AtlasMark";

export function Header() {
  return <HeaderBar path={usePathname()} />;
}

/** The bar itself; without a path (while the page streams in) it shows everything. */
export function HeaderBar({ path }: { path: string | null }) {
  if (path?.startsWith("/login")) return null;
  return (
    <header className="sticky top-0 z-[999] border-b border-line/60 bg-canvas/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2">
        <Link
          href="/"
          className="flex min-h-12 items-center gap-2 text-2xl font-extrabold tracking-tight"
        >
          <AtlasMark size={40} motion="idle" background />
          Atlas
        </Link>
        {path?.startsWith("/atlas") ? null : (
          <Link
            href="/atlas"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-4 font-bold text-white shadow-card"
          >
            Ask Atlas
          </Link>
        )}
      </div>
    </header>
  );
}
