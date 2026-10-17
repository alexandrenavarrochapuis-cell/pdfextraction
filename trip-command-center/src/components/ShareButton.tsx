"use client";

// iPhone share sheet. Sharing an address to the Tesla app sends it to the
// car's navigation; Google Maps, Waze and Messages appear there too.

import { useState } from "react";
import { ShareIcon } from "./icons";

export function ShareButton({ title, text, url, label }: { title: string; text: string; url?: string; label: string }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold"
        onClick={async () => {
          if (navigator.share) {
            try {
              await navigator.share({ title, text, url });
            } catch {
              // Closing the share sheet rejects; nothing to do.
            }
            return;
          }
          await navigator.clipboard?.writeText(text).catch(() => {});
          setNote("Sharing is not available here; the address was copied.");
        }}
      >
        <ShareIcon size={18} /> {label}
      </button>
      {note ? <p className="w-full text-sm">{note}</p> : null}
    </>
  );
}
