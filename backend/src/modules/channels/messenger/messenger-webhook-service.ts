/**
 * messenger-webhook-service.ts — verify + parse Messenger webhook payload.
 *
 * Payload shape (Meta webhook 'page' object, field 'messages'):
 *   entry[].id = page id
 *   entry[].messaging[]:
 *     - message event: { sender:{id=PSID}, recipient:{id=pageId}, timestamp,
 *         message: { mid, text?, attachments?:[{type,payload:{url}}], reply_to?{mid}, is_echo?, is_image?... } }
 *     - echo (tin page tự gửi từ Inbox FB): message.is_echo=true, sender=pageId
 *     - read: { recipient, timestamp, read:{watermark} }
 *     - delivery: { ..., delivery:{mids, watermark} }
 *
 * Verify HMAC X-Hub-Signature-256 — cùng cơ chế FB Lead Ads đang dùng
 * (reusing facebook-webhook-service.verifySignature qua chung secret FB_APP_SECRET).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../../../shared/utils/logger.js';

export interface RawMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    reply_to?: { mid?: string };
    attachments?: Array<{
      type?: string; // image | video | file | audio | template | fallback | location
      payload?: { url?: string; attachment_id?: string } & Record<string, unknown>;
    }>;
  };
  read?: { watermark?: number; seq?: number };
  delivery?: { mids?: string[]; watermark?: number };
}

export interface ParsedWebhook {
  pageId: string;
  events: RawMessagingEvent[];
}

/** Trả hub.challenge nếu verify token khớp env MESSENGER_VERIFY_TOKEN. */
export function verifyChallenge(query: {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}): string | null {
  const token = process.env.MESSENGER_VERIFY_TOKEN ?? '';
  if (!token) {
    logger.warn('[messenger-webhook] MESSENGER_VERIFY_TOKEN not set — rejecting challenge');
    return null;
  }
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === token) {
    return query['hub.challenge'] ?? null;
  }
  return null;
}

/**
 * Verify X-Hub-Signature-256 ("sha256=<hex>") với FB_APP_SECRET.
 * Export riêng để test inject secret.
 */
export function verifyMessengerSignature(rawBody: Buffer, signatureHeader?: string): boolean {
  const appSecret = process.env.FB_APP_SECRET ?? '';
  if (!appSecret) {
    logger.warn('[messenger-webhook] FB_APP_SECRET not set — rejecting all webhook POSTs');
    return false;
  }
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Extract messaging entries từ webhook body — trả [] nếu object không phải 'page'. */
export function extractPageMessagingEvents(body: unknown): ParsedWebhook[] {
  const obj = body as {
    object?: string;
    entry?: Array<{
      id?: string;
      messaging?: RawMessagingEvent[];
    }>;
  };
  if (obj?.object !== 'page' || !Array.isArray(obj.entry)) return [];

  const out: ParsedWebhook[] = [];
  for (const entry of obj.entry) {
    if (!entry.id || !Array.isArray(entry.messaging) || entry.messaging.length === 0) continue;
    out.push({ pageId: entry.id, events: entry.messaging });
  }
  return out;
}
