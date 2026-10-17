"use client";

// Chat with Atlas. Replies stream in as Atlas writes; while it searches or
// acts, its avatar's plane speeds around the globe and a status line says
// what it is doing. Changes it makes in the app appear as chips with a link.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { AtlasEvent } from "@/lib/atlas/agent";
import type { AtlasAction } from "@/lib/atlas/tools";
import type { ChatItem } from "@/lib/atlas/transcript";
import { AtlasMark } from "./AtlasMark";
import { RichText } from "./RichText";

interface LiveItem extends ChatItem {
  actions?: AtlasAction[];
  error?: string;
}

const STARTERS = [
  "Plan our next family trip",
  "Find flights for my next work trip",
  "Find a hotel near my meeting",
  "Rent a car at my next airport",
  "Plan a drive with Superchargers",
  "What do I need to enter France?",
  "Convert 100 euros to dollars",
];

export function AtlasChat({
  initialItems,
  conversationId: initialId,
  conversations,
  sos = false,
}: {
  initialItems: ChatItem[];
  conversationId: string | null;
  conversations: { id: string; title: string | null }[];
  /** Ask for emergency help as soon as the chat opens. */
  sos?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<LiveItem[]>(initialItems);
  const [conversationId, setConversationId] = useState(initialId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, status]);

  const updateLast = (f: (item: LiveItem) => LiveItem) =>
    setItems((list) => [...list.slice(0, -1), f(list[list.length - 1])]);

  function locate(): Promise<{ lat: number; lng: number } | null> {
    if (!("geolocation" in navigator)) return Promise.resolve(null);
    setLocating(true);
    return new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLocation(here);
          setLocating(false);
          resolve(here);
        },
        () => {
          setLocating(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      ),
    );
  }

  async function send(text: string, here = location) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setBusy(true);
    setStatus("Thinking…");
    setItems((list) => [...list, { role: "user", text: message, sources: [] }, { role: "atlas", text: "", sources: [], actions: [] }]);
    let changed = false;
    try {
      const res = await fetch("/api/atlas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          text: message,
          location: here,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        updateLast((item) => ({ ...item, error: data.error ?? `Atlas could not answer (${res.status}).` }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AtlasEvent;
          if (event.t === "text") {
            setStatus(null);
            updateLast((item) => ({ ...item, text: item.text + event.d }));
          } else if (event.t === "status") {
            setStatus(event.text);
          } else if (event.t === "action") {
            changed = true;
            updateLast((item) => ({ ...item, actions: [...(item.actions ?? []), event.action] }));
          } else if (event.t === "sources") {
            updateLast((item) => ({ ...item, sources: event.sources }));
          } else if (event.t === "error") {
            updateLast((item) => ({ ...item, error: event.text }));
          } else if (event.t === "done") {
            setConversationId(event.conversation_id);
          }
        }
      }
    } catch {
      updateLast((item) => ({ ...item, error: "The connection dropped. Check your signal and try again." }));
    } finally {
      setBusy(false);
      setStatus(null);
      // Refresh server data so trips Atlas changed show up everywhere.
      if (changed) router.refresh();
    }
  }

  async function emergency() {
    const here = await locate();
    await send(
      here ? "I need emergency help near me." : "I need emergency help. My location could not be shared; ask me where I am.",
      here,
    );
  }

  // Once per page load: drop ?sos=1 so a reload does not ask again.
  const sosSent = useRef(false);
  const onSos = useEffectEvent(() => {
    if (sosSent.current) return;
    sosSent.current = true;
    window.history.replaceState(null, "", "/atlas?new=1");
    void emergency();
  });
  useEffect(() => {
    if (sos) onSos();
  }, [sos]);

  function newChat() {
    setItems([]);
    setConversationId(null);
    router.replace("/atlas?new=1");
  }

  const lastAtlas = items.length - 1;
  return (
    <div className="flex min-h-[calc(100dvh-12rem)] flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={newChat} className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-semibold shadow-sm">
          + New chat
        </button>
        {conversations.length ? (
          <label className="min-w-0 flex-1">
            <span className="sr-only">Earlier chats</span>
            <select
              className="min-h-11 w-full truncate rounded-full border border-line bg-paper px-4 text-sm font-semibold shadow-sm"
              value={conversationId ?? ""}
              onChange={(e) => e.target.value && router.push(`/atlas?c=${e.target.value}`)}
            >
              <option value="">Earlier chats</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title ?? "Chat"}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          onClick={emergency}
          className="min-h-11 rounded-full border-2 border-ink bg-paper px-4 text-sm font-bold shadow-sm"
        >
          SOS · Help nearby
        </button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center animate-rise">
          <AtlasMark size={112} motion="idle" background label="Atlas" />
          <div>
            <p className="text-2xl font-bold">Hi, I&rsquo;m Atlas, your AI travel agent.</p>
            <p className="text-muted">
              I plan your family and work trips, search the web for flights, hotels, cars and drives, prepare the bookings,
              and update your trips when you ask. In an emergency, tap SOS.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-semibold shadow-sm transition active:scale-95"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="flex-1 space-y-4" aria-live="polite">
          {items.map((item, i) =>
            item.role === "user" ? (
              <li key={i} className="flex justify-end animate-rise">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-md bg-accent-soft px-4 py-2.5">
                  <span className="sr-only">You: </span>
                  {item.text}
                </p>
              </li>
            ) : (
              <li key={i} className="flex items-start gap-2 animate-rise">
                <span className="mt-1 shrink-0">
                  <AtlasMark size={36} background motion={i === lastAtlas ? (busy ? "thinking" : "idle") : "still"} label="Atlas" />
                </span>
                <div className="min-w-0 max-w-[88%] space-y-2 rounded-3xl rounded-tl-md border border-line/60 bg-paper px-4 py-3 shadow-card">
                  {item.text ? <RichText text={item.text} /> : null}
                  {i === lastAtlas && busy && status ? (
                    <p className="flex items-center gap-2 text-sm text-muted" role="status">
                      <span className="typing-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                      {status}
                    </p>
                  ) : null}
                  {item.actions?.length ? (
                    <ul className="flex flex-wrap gap-2">
                      {item.actions.map((a, j) => (
                        <li key={j}>
                          {a.href ? (
                            <Link href={a.href} className="inline-flex min-h-10 items-center gap-1 rounded-full border-2 border-ink px-3 text-sm font-semibold">
                              ✓ {a.label} →
                            </Link>
                          ) : (
                            <span className="inline-flex min-h-10 items-center rounded-full border-2 border-ink px-3 text-sm font-semibold">✓ {a.label}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {item.error ? (
                    <p className="font-semibold" role="alert">
                      ⚠ {item.error}
                    </p>
                  ) : null}
                  {item.sources.length ? (
                    <details className="text-sm">
                      <summary className="min-h-10 cursor-pointer py-2 font-semibold text-muted">Sources ({item.sources.length})</summary>
                      <ul className="space-y-1">
                        {item.sources.map((s) => (
                          <li key={s.url}>
                            <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                              {s.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </li>
            ),
          )}
          <div ref={end} />
        </ol>
      )}

      <form
        className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] mt-4 flex items-end gap-2 rounded-[1.75rem] border border-line/70 bg-paper/85 p-2 shadow-float backdrop-blur-xl"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <button
          type="button"
          onClick={() => (location ? setLocation(null) : locate())}
          aria-pressed={!!location}
          className={`min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold ${location ? "border-2 border-ink bg-accent-soft" : "border border-line"}`}
        >
          {locating ? "Locating…" : location ? "📍 Shared" : "📍 Share"}
        </button>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Message Atlas</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={1}
            placeholder="Ask Atlas…"
            className="max-h-40 min-h-11 w-full resize-none bg-transparent px-2 py-2.5 outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="min-h-11 shrink-0 rounded-full bg-accent px-5 font-bold text-white transition active:scale-95 disabled:opacity-40"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
