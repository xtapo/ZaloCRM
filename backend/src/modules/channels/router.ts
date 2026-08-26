/**
 * router.ts — ChannelRouter: entry outbound cho conv channel (provider != 'zalo').
 *
 * Trách nhiệm:
 *   1. Resolve provider từ registry
 *   2. Decrypt access token (AES-GCM) — provider chỉ thấy token đã decrypt
 *   3. Capability gate — payload vượt capability → CapabilityError (route map → 400)
 *   4. Messaging window check (vd Messenger 24h) — fail → Error code rõ ràng
 *   5. Dispatch sendMessage
 */
import { decrypt } from '../../shared/crypto/aes-gcm.js';
import { logger } from '../../shared/utils/logger.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { getProvider } from './registry.js';
import {
  CapabilityError,
  type OutboundPayload,
  type SendResult,
} from './types.js';

export class MessagingWindowError extends Error {
  statusCode = 403;
  code = 'MESSAGING_WINDOW_EXPIRED';
  constructor(message: string) {
    super(message);
  }
}

export class ChannelAccountError extends Error {
  statusCode = 400;
  code = 'CHANNEL_ACCOUNT_ERROR';
}

export interface ConversationForSend {
  id: string;
  orgId: string;
  externalThreadId: string;
  lastMessageAt: Date | null;
  channelAccountId: string | null;
}

export async function sendViaChannel(
  conversation: ConversationForSend,
  payload: OutboundPayload,
): Promise<SendResult> {
  if (!conversation.channelAccountId || !conversation.externalThreadId) {
    throw new ChannelAccountError('Conversation is not linked to a channel account');
  }

  const row = await prisma.channelAccount.findUnique({
    where: { id: conversation.channelAccountId },
  });
  if (!row || row.status !== 'connected') {
    throw new ChannelAccountError(`Channel account unavailable (status=${row?.status ?? 'missing'})`);
  }

  const provider = await getProvider(row.provider);
  if (!provider) throw new ChannelAccountError(`Unknown provider '${row.provider}'`);

  // ── Capability gate ────────────────────────────────────────────────────────
  const caps = provider.capabilities;
  if (payload.text && !caps.text) throw new CapabilityError('text', row.provider);
  for (const att of payload.attachments ?? []) {
    const allowed =
      (att.kind === 'image' && caps.image) ||
      (att.kind === 'file' && caps.file) ||
      (att.kind === 'voice' && caps.voice) ||
      (att.kind === 'video' && caps.video);
    if (!allowed) throw new CapabilityError(att.kind, row.provider);
  }
  if (payload.replyToExternalMsgId && !caps.quoteReply) {
    // Quote là best-effort — drop thay vì fail (tin vẫn đi không quote).
    logger.warn(`[channel-router] ${row.provider} no quoteReply — dropping replyToExternalMsgId`);
    delete payload.replyToExternalMsgId;
  }

  // ── Messaging window (24h rule Messenger...) ───────────────────────────────
  const lastInbound = await prisma.message.findFirst({
    where: { conversationId: conversation.id, senderType: 'contact', isDeleted: false },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });
  const windowCheck = provider.canSendMessage(lastInbound?.sentAt ?? null);
  if (!windowCheck.allowed) {
    throw new MessagingWindowError(windowCheck.reason ?? 'Messaging window expired');
  }

  const accessToken = row.accessTokenEnc ? decrypt(row.accessTokenEnc) : '';
  if (!accessToken) throw new ChannelAccountError('Channel account has no access token');

  const result = await provider.sendMessage(
    {
      id: row.id,
      orgId: row.orgId,
      provider: row.provider,
      externalId: row.externalId,
      displayName: row.displayName,
      accessToken,
      status: row.status,
    },
    conversation.externalThreadId,
    payload,
  );

  logger.info(`[channel-router] sent via ${row.provider} conv=${conversation.id} extMsg=${result.externalMsgId}`);
  return result;
}
