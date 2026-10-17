"use client";

// Address field with suggestions as you type: Google Places with a Google
// key, OpenStreetMap without one. Picking a suggestion fills the address with
// its coordinates; text typed without a pick still works and is looked up on
// the map when saved. With `name`, the field also posts lat, lng, city and
// country as hidden inputs, for plain server-action forms.

import { useEffect, useRef, useState } from "react";
import type { FoundPlace, PlaceSuggestion } from "@/lib/place-search";
import { CheckIcon } from "./icons";

export interface PickedPlace {
  address?: string;
  label?: string;
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
}

const input = "min-h-12 w-full rounded-xl border-2 border-line bg-paper px-3";

export function PlaceSearch({
  label,
  initial = {},
  onChange,
  name,
  required,
  placeholder = "Start typing an address or a place",
}: {
  label: string;
  initial?: PickedPlace;
  onChange?: (place: PickedPlace) => void;
  name?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const [place, setPlace] = useState<PickedPlace>(initial);
  const [query, setQuery] = useState(initial.address ?? "");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const session = useRef("");
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (p: PickedPlace) => {
    setPlace(p);
    onChange?.(p);
  };

  function type(text: string) {
    setQuery(text);
    update({ address: text });
    clearTimeout(timer.current);
    const q = text.trim();
    const ticket = ++latest.current;
    if (q.length < 3) {
      setSuggestions([]);
      setStatus(null);
      return;
    }
    // One session from the first keystroke to the pick, for Google billing.
    session.current ||= crypto.randomUUID();
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places/search?q=${encodeURIComponent(q)}&session=${session.current}`);
        const data = (await res.json()) as { suggestions?: PlaceSuggestion[] };
        if (ticket !== latest.current) return;
        const list = data.suggestions ?? [];
        setSuggestions(list);
        setStatus(list.length ? `${list.length} suggestions below.` : "No match yet. Keep typing, or keep the address as typed.");
      } catch {
        if (ticket === latest.current) setStatus(null);
      }
    }, 300);
  }

  async function pick(s: PlaceSuggestion) {
    latest.current++;
    clearTimeout(timer.current);
    setSuggestions([]);
    let found: FoundPlace | null = s.place;
    if (!found) {
      setStatus("Finding it on the map…");
      const res = await fetch(`/api/places/details?id=${encodeURIComponent(s.id)}&session=${session.current}`).catch(() => null);
      found = res?.ok ? ((await res.json()) as { place: FoundPlace | null }).place : null;
    }
    session.current = "";
    if (!found) {
      const text = [s.primary, s.secondary].filter(Boolean).join(", ");
      setQuery(text);
      update({ address: text });
      setStatus("Could not place it on the map; it will be looked up when saved.");
      return;
    }
    setQuery(found.address);
    update({
      address: found.address,
      label: found.name ?? undefined,
      lat: found.lat,
      lng: found.lng,
      city: found.city ?? undefined,
      country: found.country ?? undefined,
    });
    setStatus(null);
  }

  const mapped = place.lat != null && place.lng != null;
  const source = suggestions[0]?.id.startsWith("google:") ? "Powered by Google" : "Suggestions © OpenStreetMap contributors";
  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="font-semibold">{label}</span>
        <input
          className={input}
          name={name}
          value={query}
          required={required}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => type(e.target.value)}
        />
      </label>
      {suggestions.length ? (
        <div className="overflow-hidden rounded-xl border-2 border-line bg-paper">
          <ul className="divide-y divide-line">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button type="button" className="block min-h-12 w-full px-3 py-2 text-left" onClick={() => pick(s)}>
                  <span className="block font-semibold">{s.primary}</span>
                  {s.secondary ? <span className="block text-sm text-muted">{s.secondary}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-3 py-1 text-xs text-muted">{source}</p>
        </div>
      ) : null}
      <p aria-live="polite" className="text-sm">
        {mapped ? (
          <span className="inline-flex items-center gap-1 font-semibold">
            <CheckIcon size={16} /> Found on the map
          </span>
        ) : (
          status
        )}
      </p>
      {name ? (
        <>
          <input type="hidden" name="lat" value={place.lat ?? ""} />
          <input type="hidden" name="lng" value={place.lng ?? ""} />
          <input type="hidden" name="city" value={place.city ?? ""} />
          <input type="hidden" name="country" value={place.country ?? ""} />
        </>
      ) : null}
    </div>
  );
}
