// Bottom tab bar: large targets, icon plus label.

import Link from "next/link";
import { GearIcon, ListIcon, PassIcon, PlaneIcon } from "./icons";

const TABS = [
  { href: "/", label: "Trips", Icon: PlaneIcon },
  { href: "/passes", label: "Passes", Icon: PassIcon },
  { href: "/review", label: "Review", Icon: ListIcon },
  { href: "/settings", label: "Settings", Icon: GearIcon },
];

export function Nav() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-[1000] border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map(({ href, label, Icon }) => (
          <li key={href} className="flex-1">
            <Link href={href} className="flex min-h-16 flex-col items-center justify-center gap-0.5 text-sm font-semibold">
              <Icon size={24} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
