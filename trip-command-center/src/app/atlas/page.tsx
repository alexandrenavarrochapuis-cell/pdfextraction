// Atlas, the assistant: the latest conversation (or the one picked), ready to
// continue.

import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { toChatItems, type StoredMessage } from "@/lib/atlas/transcript";
import { AtlasChat } from "@/components/AtlasChat";
import { Loading } from "@/components/Loading";

async function Chat({ searchParams }: { searchParams: Promise<{ c?: string; new?: string }> }) {
  const { c, new: fresh } = await searchParams;
  const { db } = await requireUser();
  const { data: conversations } = await db
    .from("atlas_conversations")
    .select("id, title")
    .order("updated_at", { ascending: false })
    .limit(20);
  const list = (conversations ?? []) as { id: string; title: string | null }[];
  const picked = fresh ? null : c && /^[0-9a-f-]{36}$/i.test(c) ? c : (list[0]?.id ?? null);
  const { data: messages } = picked
    ? await db.from("atlas_messages").select("role, content").eq("conversation_id", picked).order("id")
    : { data: [] };
  return (
    <AtlasChat
      key={picked ?? "new"}
      initialItems={toChatItems((messages ?? []) as StoredMessage[])}
      conversationId={picked}
      conversations={list}
    />
  );
}

export default function AtlasPage({ searchParams }: PageProps<"/atlas">) {
  return (
    <>
      <h1 className="sr-only">Atlas</h1>
      <Suspense fallback={<Loading label="Opening Atlas…" />}>
        <Chat searchParams={searchParams as Promise<{ c?: string; new?: string }>} />
      </Suspense>
    </>
  );
}
