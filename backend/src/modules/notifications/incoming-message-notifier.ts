/**
 * incoming-message-notifier.ts — đẩy thông báo "tin nhắn đến tức thì" ngay khi
 * tin nhắn inbound ghi vào DB, KHÔNG chờ tick 60s của notification-worker.
 *
 * Cùng mô hình persist với các nguồn khác: syncNotifications upsert theo
 * (userId, dedupeKey `inmsg-<messageId>`) → trạng thái đã đọc giữ được qua poll,
 * và compute engine (cửa sổ 5 phút) tự resolve khi hết hạn hoặc agent trả lời.
 * Người nhận phải khớp tiêu chí của compute section #7: owner/admin của org +
 * người sở hữu nick + người được phân công contact.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { filterByPrefs, getNotificationPrefs, syncNotifications } from './notification-service.js';

/** Gọi từ message-handler sau khi message đã persist — fire-and-forget an toàn. */
export async function notifyIncomingMessage(input: {
  orgId: string;
  conversationId: string;
  messageId: string;
  content: string;
  contentType: string;
}): Promise<void> {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true, threadType: true, zaloAccountId: true },
    });
    // Nhóm có nguồn group_pending riêng; hội thoại lạ → bỏ qua.
    if (!conv || conv.threadType !== 'user') return;

    const contact = await prisma.contact.findFirst({
      where: { conversations: { some: { id: conv.id } } },
      select: { crmName: true, fullName: true, assignedUserId: true },
    });

    const displayName =
      contact?.crmName || contact?.fullName || 'Khách hàng';
    const detail =
      input.content && input.content.length > 0
        ? String(input.content).slice(0, 80)
        : `[${input.contentType || 'tin nhắn'}]`;

    // Người nhận: owner/admin org (nhận mọi tin) + owner nick + assigned contact.
    const admins = await prisma.user.findMany({
      where: { orgId: input.orgId, role: { in: ['owner', 'admin'] }, isActive: true },
      select: { id: true },
    });
    const recipientIds = new Set<string>(admins.map((u) => u.id));
    const account = await prisma.zaloAccount.findUnique({
      where: { id: conv.zaloAccountId },
      select: { ownerUserId: true },
    });
    if (account?.ownerUserId) recipientIds.add(account.ownerUserId);
    if (contact?.assignedUserId) recipientIds.add(contact.assignedUserId);

    for (const userId of recipientIds) {
      try {
        const prefs = await getNotificationPrefs(userId);
        await syncNotifications({ id: userId, orgId: input.orgId }, filterByPrefs([
          {
            source: 'incoming_message' as const,
            dedupeKey: `inmsg-${input.messageId}`,
            type: 'info',
            priority: 'medium',
            title: `${displayName} vừa nhắn tin`,
            detail,
            link: '/chat',
          },
        ], prefs));
      } catch (err) {
        logger.warn(`[incoming-message-notifier] push failed for user=${userId}:`, err);
      }
    }
  } catch (err) {
    logger.warn('[incoming-message-notifier] push failed:', err);
  }
}
