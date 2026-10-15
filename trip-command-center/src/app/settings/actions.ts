"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { geocodeAddress } from "@/lib/geo";

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

const PLACE_KINDS_ALLOWED = new Set(["home", "family", "friend", "office", "other"]);

export async function addPlace(form: FormData) {
  const { db, user } = await requireUser();
  const label = String(form.get("label") ?? "").trim().slice(0, 120);
  const address = String(form.get("address") ?? "").trim().slice(0, 300);
  const kindRaw = String(form.get("kind") ?? "other");
  if (!label || !address) return;
  const geo = await geocodeAddress(address);
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
  if (id) await db.from("travelers").delete().eq("id", id);
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
