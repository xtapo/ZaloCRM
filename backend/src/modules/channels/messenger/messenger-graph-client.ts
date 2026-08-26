/**
 * messenger-graph-client.ts — Facebook Graph API calls cho Messenger channel.
 *
 * Dùng Page Access Token (đã lưu encrypted trong ChannelAccount.accessTokenEnc).
 * API version pin cố định — nâng cấp là thay đổi có chủ đích, kèm test lại.
 *
 * Endpoints dùng:
 *   POST /{pageId}/messages          — gửi text/attachment (Send API)
 *   GET  /{psid}?fields=...          — profile của user (cần pages_messaging + App trong dev mode)
 *   POST /{psid}/messages (sender_action) — typing on/off, mark_seen
 */
import { logger } from '../../../shared/utils/logger.js';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class MessengerGraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly fbErrorCode?: number,
    public readonly fbErrorSubcode?: number,
    message?: string,
  ) {
    super(message ?? `Graph API error ${status}${fbErrorCode ? ` (code ${fbErrorCode})` : ''}`);
  }
}

async function graphFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: number; error_subcode?: number } }).error;
    throw new MessengerGraphError(res.status, err?.code, err?.error_subcode, err?.message);
  }
  return body as T;
}

export interface SendApiRecipient {
  id: string; // PSID
}

export interface SendApiResponse {
  recipient_id: string;
  message_id: string;
  /** Có khi attachment upload inline — attachment_id để reuse */
  attachment_id?: string;
}

/** Gửi text (hoặc text + reply_to). */
export async function sendText(
  pageAccessToken: string,
  pageId: string,
  psid: string,
  text: string,
  replyToMid?: string,
): Promise<SendApiResponse> {
  const message: Record<string, unknown> = { text };
  if (replyToMid) {
    message.reply_to = { mid: replyToMid };
  }
  return graphFetch<SendApiResponse>(`/${pageId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid } satisfies SendApiRecipient,
      messaging_type: 'RESPONSE',
      message,
      access_token: pageAccessToken,
    }),
  });
}

/**
 * Gửi attachment bằng URL công khai (MinIO). FB tự tải và re-host.
 * kind map: image → image, file → file, voice/audio → audio, video → video.
 */
export async function sendAttachment(
  pageAccessToken: string,
  pageId: string,
  psid: string,
  type: 'image' | 'file' | 'audio' | 'video',
  url: string,
  replyToMid?: string,
): Promise<SendApiResponse> {
  const message: Record<string, unknown> = {
    attachment: { type, payload: { url, is_reusable: true } },
  };
  if (replyToMid) message.reply_to = { mid: replyToMid };
  return graphFetch<SendApiResponse>(`/${pageId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid } satisfies SendApiRecipient,
      messaging_type: 'RESPONSE',
      message,
      access_token: pageAccessToken,
    }),
  });
}

/** Typing indicator / mark seen — best-effort, lỗi không ném. */
export async function senderAction(
  pageAccessToken: string,
  pageId: string,
  psid: string,
  action: 'typing_on' | 'typing_off' | 'mark_seen',
): Promise<void> {
  try {
    await graphFetch(`/${pageId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psid },
        sender_action: action,
        access_token: pageAccessToken,
      }),
    });
  } catch (err) {
    logger.warn('[messenger-graph] senderAction failed:', err);
  }
}

export interface PsidProfile {
  first_name?: string;
  last_name?: string;
  profile_pic?: string;
}

/**
 * Fetch profile PSID. LƯU Ý: từ 2020 Meta chỉ trả name qua webhook (name field bị
 * rút khỏi GET /{psid} với app chưa được duyệt đặc biệt) — fields vẫn khai báo
 * đầy đủ, response thiếu gì dùng nấy. Best-effort: fail → null.
 */
export async function fetchPsidProfile(
  pageAccessToken: string,
  psid: string,
): Promise<PsidProfile | null> {
  try {
    return await graphFetch<PsidProfile>(
      `/${psid}?fields=first_name,last_name,name,profile_pic&access_token=${encodeURIComponent(pageAccessToken)}`,
      { method: 'GET' },
    );
  } catch (err) {
    logger.warn('[messenger-graph] fetchPsidProfile failed:', err);
    return null;
  }
}
