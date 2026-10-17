"use client";

// Bottom tab bar: large targets, icon plus label, the current tab marked by a
// filled pill and bold label (not color alone). Frosted over the content.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AtlasMark } from "./AtlasMark";
import { GearIcon, ListIcon, PassIcon, PlaneIcon } from "./icons";

const AtlasIcon = ({ size }: { size?: number }) => <AtlasMark size={(size ?? 24) + 6} />;

const TABS = [
  { href: "/", label: "Trips", Icon: PlaneIcon },
  { href: "/atlas", label: "Atlas", Icon: AtlasIcon },
  { href: "/passes", label: "Passes", Icon: PassIcon },
  { href: "/review", label: "Review", Icon: ListIcon },
  { href: "/settings", label: "Settings", Icon: GearIcon },
];

export function Nav() {
  return <NavBar path={usePathname()} />;
}

/** The bar itself; without a path (while the page streams in) no tab is marked. */
export function NavBar({ path }: { path: string | null }) {
  if (path?.startsWith("/login")) return null;
  const active = (href: string) => !!path && (href === "/" ? path === "/" || path.startsWith("/trips") : path.startsWith(href));
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-[1000] border-t border-line/70 bg-paper/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map(({ href, label, Icon }) => {
          const on = active(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs ${on ? "font-bold text-accent" : "font-semibold text-muted"}`}
              >
                <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${on ? "bg-accent-soft" : ""}`}>
                  <Icon size={22} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
