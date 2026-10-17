// POST /api/atlas: one message to Atlas. Streams newline-delimited JSON
// events (text, status, actions, sources) while Atlas works, then stores the
// turn. GET lists recent conversations.

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import * as z from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import { runAtlas, type AtlasEvent } from "@/lib/atlas/agent";
import { contextBlock, systemPrompt } from "@/lib/atlas/prompt";
import { userTimezone } from "@/lib/config";
import { isValidTimeZone } from "@/lib/time";

export const maxDuration = 300;

const Body = z.object({
  conversation_id: z.uuid().nullable().optional(),
  text: z.string().trim().min(1).max(4000),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional(),
  tz: z.string().max(64).optional(),
});

function explain(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key in Vercel is not valid.";
  if (err instanceof Anthropic.RateLimitError) return "Atlas is busy right now; try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Atlas could not reach its service; check the connection and try again.";
  if (err instanceof Anthropic.APIError) return `Atlas hit a problem (${err.status ?? "error"}). Try again.`;
  return "Atlas hit a problem. Try again.";
}

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Atlas needs an Anthropic API key: add ANTHROPIC_API_KEY in Vercel." }, { status: 503 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  const { db, user } = session;
  const input = parsed.data;

  let conversationId = input.conversation_id ?? null;
  if (conversationId) {
    const { data } = await db.from("atlas_conversations").select("id").eq("id", conversationId).maybeSingle();
    if (!data) conversationId = null;
  }
  if (!conversationId) {
    const { data, error } = await db
      .from("atlas_conversations")
      .insert({ user_id: user.id, title: input.text.slice(0, 80) })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    conversationId = data.id as string;
  }

  const [{ data: rows }, system] = await Promise.all([
    db.from("atlas_messages").select("role, content").eq("conversation_id", conversationId).order("id"),
    systemPrompt(db),
  ]);
  const history = (rows ?? []) as Anthropic.Beta.BetaMessageParam[];
  const tz = input.tz && isValidTimeZone(input.tz) ? input.tz : userTimezone();
  const location = input.location ?? null;
  const userMessage: Anthropic.Beta.BetaMessageParam = {
    role: "user",
    content: [
      { type: "text", text: contextBlock(new Date(), tz, location) },
      { type: "text", text: input.text },
    ],
  };

  const client = new Anthropic({ timeout: 200_000, maxRetries: 1 });
  const encoder = new TextEncoder();
  const id = conversationId;
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AtlasEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The phone went away; finish the turn and store it anyway.
        }
      };
      let added: Anthropic.Beta.BetaMessageParam[] = [];
      try {
        added = await runAtlas(client, { system, history: [...history, userMessage], ctx: { db, userId: user.id, location }, emit });
      } catch (err) {
        console.error("Atlas turn failed", err);
        emit({ t: "error", text: explain(err) });
      }
      // Append only: the user's message, then Atlas's complete turn, if any.
      const toStore = [userMessage, ...added].map((m) => ({ conversation_id: id, user_id: user.id, role: m.role, content: m.content }));
      const { error } = await db.from("atlas_messages").insert(toStore);
      if (error) console.error("Atlas could not store the turn", error);
      await db.from("atlas_conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);
      emit({ t: "done", conversation_id: id });
      try {
        controller.close();
      } catch {
        // Already closed by the client.
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data } = await session.db.from("atlas_conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(20);
  return NextResponse.json({ conversations: data ?? [] });
}
