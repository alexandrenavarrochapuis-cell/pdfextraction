// Web Push with VAPID (iOS 16.4+ when the app is installed to the home screen).

import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushSubscriptionRow } from "./types";
import { ownerEmail } from "./config";

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

let configured = false;

function configure() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error("VAPID keys are not set");
  webpush.setVapidDetails(`mailto:${ownerEmail()}`, publicKey, privateKey);
  configured = true;
}

/** Send to every device the user subscribed. Returns how many deliveries succeeded. */
export async function sendPushToUser(db: SupabaseClient, userId: string, message: PushMessage): Promise<number> {
  configure();
  const { data, error } = await db.from("push_subscriptions").select("*").eq("user_id", userId);
  if (error) throw error;
  let delivered = 0;
  for (const sub of (data ?? []) as PushSubscriptionRow[]) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(message),
        { TTL: 12 * 3600, urgency: "high" },
      );
      delivered += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410: the device dropped the subscription (app removed, permission revoked).
      if (status === 404 || status === 410) {
        await db.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.error(`[push] delivery to ${sub.endpoint.slice(0, 40)}… failed:`, err);
      }
    }
  }
  return delivered;
}
