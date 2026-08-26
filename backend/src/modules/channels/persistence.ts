/**
 * persistence.ts — persist outbound message cho conv channel (2026-08-26).
 *
 * Trích logic persist sau khi gửi tin (create Message + update Conversation +
 * aggregates + socket emit) thành helper dùng chung. Route Zalo (chat-routes.ts)
 * giữ code inline hiện tại — refactor route Zalo sang helper này là việc sau
 * (defer, không bắt buộc ở phase này).
 */
import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { applyContactAggregateFromMessage } from '../contacts/contact-aggregate.js';
import type { SendResult } from './types.js';

export interface PersistOutboundInput {
  conversationId: string;
  provider: string;
  /** ChannelAccount.id — FE dùng khớp conv.zaloAccount?.id hiện tại; envelope
   *  'chat:message' của FE đọc data.accountId để update conv list. */
  channelAccountId: string;
  sendResult: SendResult;
  content: string;
  contentType: string;
  attachments?: unknown[];
  repliedByUserId: string;
  io: Server | null;
}

export async function persistOutboundChannelMessage(input: PersistOutboundInput): Promise<{ id: string }> {
  const sentAt = new Date();

  const message = await prisma.message.create({
    data: {
      id: randomUUID(),
      conversationId: input.conversationId,
      senderType: 'self',
      senderUid: '', // self — uid của page/bot, không dùng cho hiển thị
      senderName: 'Staff',
      content: input.content,
      contentType: input.contentType,
      attachments: input.attachments ?? [],
      externalMsgId: input.sendResult.externalMsgId || null,
      sentAt,
      repliedByUserId: input.repliedByUserId,
    },
  });

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: sentAt, isReplied: true, unreadCount: 0 },
  });

  if (input.contentType === 'text' || input.content) {
    void applyContactAggregateFromMessage({
      conversationId: input.conversationId,
      message: {
        id: message.id,
        content: message.content,
        contentType: message.contentType,
        sentAt: message.sentAt,
        senderType: 'self' as const,
      },
      outboundUserId: input.repliedByUserId,
    });
  }

  // Socket envelope giữ shape 'chat:message' chuẩn FE — accountId = ChannelAccount.id,
  // không kèm _privacyMeta (channel account org-wide).
  input.io?.emit('chat:message', {
    accountId: input.channelAccountId,
    message,
    conversationId: input.conversationId,
    provider: input.provider,
  });

  logger.info(`[channel-persist] outbound persisted conv=${input.conversationId} provider=${input.provider} extMsg=${input.sendResult.externalMsgId}`);
  return { id: message.id };
}
