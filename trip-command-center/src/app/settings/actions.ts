"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { geocodeAddress, timezoneAt } from "@/lib/geo";

export async function saveBriefSettings(form: FormData) {
  const { db, user } = await requireUser();
  const hour = Number(form.get("brief_hour"));
  const update = {
    brief_hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 19,
    push_enabled: form.get("push_enabled") === "on",
  };
  await db.from("profiles").update(update).eq("id", user.id);
  revalidatePath("/settings");
}

function pickedCoordinates(form: FormData): { lat: number; lng: number } | null {
  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  const valid = form.get("lat") !== "" && form.get("lng") !== "" && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return valid && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

const PLACE_KINDS_ALLOWED = new Set(["home", "family", "friend", "office", "other"]);

export async function addPlace(form: FormData) {
  const { db, user } = await requireUser();
  const label = String(form.get("label") ?? "").trim().slice(0, 120);
  const address = String(form.get("address") ?? "").trim().slice(0, 300);
  const kindRaw = String(form.get("kind") ?? "other");
  if (!label || !address) return;
  // Coordinates come with a picked suggestion; typed text is looked up here.
  const picked = pickedCoordinates(form);
  const geo = picked
    ? {
        ...picked,
        city: String(form.get("city") ?? "").trim().slice(0, 120) || null,
        country: /^[A-Za-z]{2}$/.test(String(form.get("country") ?? "")) ? String(form.get("country")).toUpperCase() : null,
        tz: await timezoneAt(picked.lat, picked.lng),
      }
    : await geocodeAddress(address);
  await db.from("places").insert({
    user_id: user.id,
    label,
    address,
    kind: PLACE_KINDS_ALLOWED.has(kindRaw) ? kindRaw : "other",
    city: geo?.city ?? null,
    country: geo?.country ?? null,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    tz: geo?.tz ?? null,
  });
  revalidatePath("/settings");
}

export async function deletePlace(form: FormData) {
  const { db } = await requireUser();
  const id = String(form.get("id") ?? "");
  if (id) await db.from("places").delete().eq("id", id);
  revalidatePath("/settings");
}

const RELATIONS = new Set(["self", "spouse", "child", "parent", "other"]);

export async function addTraveler(form: FormData) {
  const { db, user } = await requireUser();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  if (!name) return;
  const relation = String(form.get("relation") ?? "other");
  const variants = String(form.get("name_variants") ?? "")
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 10);
  await db.from("travelers").insert({
    user_id: user.id,
    name,
    relation: RELATIONS.has(relation) ? relation : "other",
    name_variants: variants,
  });
  revalidatePath("/settings");
}

export async function deleteTraveler(form: FormData) {
  const { db } = await requireUser();
  const id = String(form.get("id") ?? "");
  if (!id) return;
  // The traveler's documents cascade away with them; their encrypted scans
  // live in Storage and have to be removed first. RLS scopes the read.
  const { data: docs } = await db.from("travel_documents").select("scan_path").eq("traveler_id", id);
  const scans = (docs ?? []).map((d) => d.scan_path as string | null).filter((p): p is string => !!p);
  if (scans.length) await createAdminClient().storage.from("vault").remove(scans);
  await db.from("travelers").delete().eq("id", id);
  revalidatePath("/settings");
}

export async function rotateCalendarToken() {
  const { db, user } = await requireUser();
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Buffer.from(bytes).toString("base64url");
  await db.from("profiles").update({ calendar_token: token }).eq("id", user.id);
  revalidatePath("/settings");
}

export async function disableCalendarFeed() {
  const { db, user } = await requireUser();
  await db.from("profiles").update({ calendar_token: null }).eq("id", user.id);
  revalidatePath("/settings");
}
