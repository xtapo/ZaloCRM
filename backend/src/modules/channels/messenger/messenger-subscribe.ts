/**
 * messenger-subscribe.ts — subscribe page nhận cả messaging events (bên cạnh leadgen).
 *
 * Tách khỏi messenger-routes để test được độc lập (mock fetch). Dùng chung Graph
 * version với facebook-graph-client (v21.0) nhưng tự gọi fetch — không import
 * graphPost vì hàm đó không export.
 */
import { logger } from '../../../shared/utils/logger.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

/** Idempotent: resubscribe ghi đè subscribed_fields — phải liệt kê ĐẦY ĐỦ các field
 *  cần giữ (leadgen + messages), không chỉ field mới. */
export async function subscribePageFields(pageId: string, pageToken: string): Promise<void> {
  const url = `${GRAPH_BASE}/${pageId}/subscribed_apps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      subscribed_fields: 'leadgen,messages,messaging_postbacks,message_reactions',
      access_token: pageToken,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[messenger-subscribe] POST /subscribed_apps failed ${res.status}: ${body.slice(0, 300)}`);
  }
  logger.info(`[messenger-subscribe] page ${pageId} subscribed to messages`);
}
