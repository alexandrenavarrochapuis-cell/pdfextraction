"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this code", value);
        }
      }}
    >
      {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
      {copied ? "Copied" : label}
    </button>
  );
}
