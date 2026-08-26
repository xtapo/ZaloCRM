/**
 * messenger-provider.ts — ChannelProvider cho Facebook Messenger (2026-08-26).
 *
 * MVP capabilities: text + image + file + voice(audio). KHÔNG hỗ trợ: undo,
 * reactions, sticker, edit, group threads.
 *
 * Inbound: parseWebhook → NormalizedInbound[]. Attachment (image/video/file/audio)
 * giữ sourceUrl CDN FB — persistence layer tải buffer lên MinIO rồi mới ghi DB
 * (CDN URL của FB hết hạn sau ~1 ngày, không dùng trực tiếp trong CRM).
 *
 * Outbound: Send API qua messenger-graph-client. 24h messaging window check ở canSendMessage.
 */
import { logger } from '../../../shared/utils/logger.js';
import { prisma } from '../../../shared/database/prisma-client.js';
import type {
  ChannelAccountRow,
  ChannelCapabilities,
  ChannelProvider,
  NormalizedInbound,
  OutboundPayload,
  SendResult,
} from '../types.js';
import {
  fetchPsidProfile,
  sendAttachment,
  sendText,
} from './messenger-graph-client.js';
import {
  extractPageMessagingEvents,
  verifyChallenge,
  verifyMessengerSignature,
  type RawMessagingEvent,
} from './messenger-webhook-service.js';

export const MESSENGER_CAPABILITIES: ChannelCapabilities = {
  text: true,
  image: true,
  file: true,
  voice: true, // gửi dạng audio attachment
  video: false, // defer — payload lớn, cần chunk upload riêng
  sticker: false,
  undo: false,
  reactions: false,
  quoteReply: true,
  editMessage: false,
  typingIndicator: true,
  readReceipts: true,
  groupThreads: false,
};

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Map FB attachment type → CRM contentType. */
function mapAttachmentType(fbType?: string): NormalizedInbound['contentType'] | null {
  switch (fbType) {
    case 'image': return 'image';
    case 'video': return 'video';
    case 'audio': return 'voice';
    case 'file': return 'file';
    default: return null; // template/fallback/location — defer MVP
  }
}

async function resolveChannelAccountId(orgId: string, provider: string, externalId: string): Promise<string | null> {
  const row = await prisma.channelAccount.findUnique({
    where: { orgId_provider_externalId: { orgId, provider, externalId } },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Parse 1 messaging event → NormalizedInbound | null. orgId truyền từ trên xuống
 * (đã resolve pageId → ChannelAccount trước đó — webhook không mang orgId).
 */
async function normalizeEvent(
  orgId: string,
  channelAccountId: string | null,
  ev: RawMessagingEvent,
): Promise<NormalizedInbound | null> {
  // ── Read receipt ──────────────────────────────────────────────────────────
  // Không phải message — trả null; delivery/read xử lý ở route level (xử lý
  // watermark update trước khi gọi hàm này).
  if (!ev.message) return null;
  if (!ev.sender?.id || !ev.timestamp || !ev.message.mid) return null;

  const isSelf = Boolean(ev.message.is_echo);
  // Echo: sender.id là PAGE id, recipient.id là PSID. Thường: ngược lại.
  const psid = isSelf ? (ev.recipient?.id ?? '') : ev.sender.id;
  if (!psid) return null;

  if (ev.message.is_deleted) {
    // FB cho unsend — mark deleted theo mid. Route xử lý; normalize skip.
    return null;
  }

  const attachments: Array<Record<string, unknown>> = [];
  let contentType: NormalizedInbound['contentType'] = 'text';
  let sourceUrl: string | undefined;
  let content = ev.message.text ?? '';

  for (const att of ev.message.attachments ?? []) {
    const mapped = mapAttachmentType(att.type);
    if (!mapped) continue;
    contentType = mapped;
    sourceUrl = att.payload?.url ?? undefined;
    attachments.push({
      kind: mapped === 'voice' ? 'audio' : mapped,
      url: sourceUrl ?? null,
      mimeType: null,
      fileName: att.payload?.url ? decodeURIComponent(att.payload.url.split('/').pop() ?? '') || null : null,
      size: null,
    });
  }

  if (!isSelf && !content && attachments.length > 0) {
    content = ''; // attachment-only tin — FE render bubble media
  }

  // Sender name cho echo = page displayName (route đã có); cho inbound = profile
  // best-effort được enrich ở persistence sau (không block webhook ở đây).
  return {
    provider: 'messenger',
    accountId: channelAccountId ?? '',
    senderUid: psid,
    senderName: '', // enrich async ở routes sau khi persist contact
    content,
    contentType,
    msgId: ev.message.mid,
    timestamp: Number(ev.timestamp),
    isSelf,
    threadId: psid,
    threadType: 'user',
    attachments: attachments.length > 0 ? attachments : undefined,
    quote: ev.message.reply_to?.mid ? { mid: ev.message.reply_to.mid } : undefined,
    sourceUrl,
  };
}

export const messengerProvider: ChannelProvider = {
  name: 'messenger',
  capabilities: MESSENGER_CAPABILITIES,

  verifyWebhook(query) {
    return verifyChallenge(query);
  },

  async parseWebhook(rawBody: Buffer, signature?: string): Promise<NormalizedInbound[]> {
    if (!verifyMessengerSignature(rawBody, signature)) {
      throw new Error('invalid_signature');
    }
    const body = JSON.parse(rawBody.toString('utf8'));
    const parsedEntries = extractPageMessagingEvents(body);
    if (parsedEntries.length === 0) return [];

    const out: NormalizedInbound[] = [];
    for (const entry of parsedEntries) {
      // Resolve ChannelAccount theo pageId. Webhook không mang orgId — lookup theo
      // externalId xuyên org (page chỉ thuộc 1 org trong thực tế; nếu trùng thì
      // unique [orgId, provider, externalId] cho phép nhiều row — lấy row connected đầu tiên).
      const account = await prisma.channelAccount.findFirst({
        where: { provider: 'messenger', externalId: entry.pageId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, orgId: true },
      });
      if (!account) {
        logger.warn(`[messenger-provider] no ChannelAccount for page ${entry.pageId} — dropping ${entry.events.length} events`);
        continue;
      }

      for (const ev of entry.events) {
        // Delivery/read không phải message — bỏ qua ở đây (read receipts cập nhật
        // qua handler riêng trong routes).
        if (!ev.message) continue;
        const normalized = await normalizeEvent(account.orgId, account.id, ev);
        if (normalized) out.push(normalized);
      }
    }
    return out;
  },

  async sendMessage(channelAccount, externalThreadId, payload): Promise<SendResult> {
    const replyToMid = payload.replyToExternalMsgId;
    let lastMsgId = '';

    if (payload.text) {
      const res = await sendText(channelAccount.accessToken, channelAccount.externalId, externalThreadId, payload.text, replyToMid);
      lastMsgId = res.message_id;
    }

    for (const att of payload.attachments ?? []) {
      const fbType =
        att.kind === 'voice' ? 'audio' :
        att.kind === 'video' ? 'video' :
        att.kind === 'file' ? 'file' : 'image';
      const res = await sendAttachment(
        channelAccount.accessToken,
        channelAccount.externalId,
        externalThreadId,
        fbType as 'image' | 'file' | 'audio' | 'video',
        att.url,
        // reply_to chỉ áp dụng tin đầu tiên trong lô
        lastMsgId ? undefined : replyToMid,
      );
      lastMsgId = res.message_id;
    }

    return { externalMsgId: lastMsgId };
  },

  async fetchProfile(channelAccount, externalUserId) {
    const p = await fetchPsidProfile(channelAccount.accessToken, externalUserId);
    if (!p) return null;
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || (p as { name?: string }).name;
    return { fullName: fullName || undefined, avatarUrl: p.profile_pic };
  },

  canSendMessage(lastInboundAt) {
    if (!lastInboundAt) {
      return { allowed: false, reason: 'Chưa từng nhận tin từ khách hàng — Messenger chặn gửi chủ động ngoài 24h window' };
    }
    const elapsed = Date.now() - lastInboundAt.getTime();
    if (elapsed > WINDOW_MS) {
      return { allowed: false, reason: `Quá 24h (${Math.round(elapsed / 3_600_000)}h) kể từ tin cuối của khách — Messenger chặn gửi. Khách cần nhắn tin trước.` };
    }
    return { allowed: true };
  },
};
