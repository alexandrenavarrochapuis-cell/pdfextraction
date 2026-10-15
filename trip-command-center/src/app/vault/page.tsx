// Passports and IDs for the family, encrypted on the device.

import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import type { TravelDocument, Traveler } from "@/lib/types";
import { VaultClient } from "@/components/VaultClient";
import { Loading } from "@/components/Loading";

async function Vault() {
  const { db, user } = await requireUser();
  const [{ data: profile }, { data: docs }, { data: travelers }] = await Promise.all([
    db.from("profiles").select("vault_salt, vault_check, vault_check_iv").eq("id", user.id).single(),
    db.from("travel_documents").select("*").order("created_at"),
    db.from("travelers").select("*").order("name"),
  ]);
  return (
    <VaultClient
      setup={{ salt: profile?.vault_salt ?? null, check: profile?.vault_check ?? null, checkIv: profile?.vault_check_iv ?? null }}
      documents={(docs ?? []) as TravelDocument[]}
      travelers={(travelers ?? []) as Traveler[]}
    />
  );
}

export default function VaultPage() {
  return (
    <>
      <h1 className="mb-2 text-3xl font-bold">Passports and IDs</h1>
      <p className="mb-4 text-muted">
        Keep the originals with you; this is a backup. On iPhone, a US passport can also be added to Apple Wallet as a
        Digital ID for TSA checkpoints.
      </p>
      <Suspense fallback={<Loading />}>
        <Vault />
      </Suspense>
    </>
  );
}
