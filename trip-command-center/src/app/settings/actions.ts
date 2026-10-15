"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";

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
