"use client";

// A file field with a camera button. A single <input type="file"> that also
// accepts PDFs makes Android open the document picker without the camera, so
// "Take a photo" is its own input limited to images with capture set.

import { useId, useRef } from "react";

const button = "inline-flex min-h-12 items-center rounded-xl border-2 border-ink bg-paper px-4 font-semibold";

export function FileField({
  label,
  accept,
  file,
  onChange,
}: {
  label: string;
  accept: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const id = useId();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const take = (input: HTMLInputElement) => {
    onChange(input.files?.[0] ?? null);
    // Let the same file be chosen again after Remove.
    input.value = "";
  };
  return (
    <div role="group" aria-labelledby={id} className="space-y-2">
      <p id={id} className="font-semibold">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => camera.current?.click()}>
          Take a photo
        </button>
        <button type="button" className={button} onClick={() => picker.current?.click()}>
          Choose a file
        </button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => take(e.currentTarget)} />
      <input ref={picker} type="file" accept={accept} hidden onChange={(e) => take(e.currentTarget)} />
      {file ? (
        <p className="flex flex-wrap items-center gap-2">
          <span>
            Chosen: <strong>{file.name}</strong>
          </span>
          <button type="button" className="min-h-12 rounded-xl border border-line px-3 font-semibold" onClick={() => onChange(null)}>
            Remove
          </button>
        </p>
      ) : (
        <p className="text-muted">No file chosen.</p>
      )}
    </div>
  );
}
