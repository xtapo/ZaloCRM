/**
 * Notification routes — computed on-the-fly notifications for the authenticated user.
 * Sources: unreplied conversations, today/tomorrow appointments, disconnected Zalo accounts
 * (chỉ trong phạm vi nick của viewer), security events (owner/admin).
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { getRequestZaloScope } from '../chat/chat-security-hooks.js';
import { getSessionDownSince } from '../zalo/zalo-health-check.js';
import { PRIVACY_BLUR_TOKEN } from '../privacy/redact.js';

/** Trùng ngưỡng cảnh báo của cron zalo-health-check.ts — tránh 2 nguồn sự thật. */
const ZALO_ALERT_THRESHOLD_MS = 15 * 60 * 1000;

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
  createdAt: string;
}

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/notifications', async (request) => {
    const user = request.user!;
    const notifications: NotificationItem[] = [];

    // 1. Unreplied conversations > 30 min
    const thirtyMinAgo = new Date(Date.now() - 30 * 60000);
    const unreplied = await prisma.conversation.count({
      where: { orgId: user.orgId, isReplied: false, lastMessageAt: { lt: thirtyMinAgo } },
    });
    if (unreplied > 0) {
      notifications.push({
        id: 'unreplied',
        type: 'warning',
        priority: 'high',
        title: `${unreplied} cuộc trò chuyện chưa trả lời`,
        detail: 'Có tin nhắn chưa phản hồi quá 30 phút',
        createdAt: new Date().toISOString(),
      });
    }

    // 2. Today's appointments
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const todayApts = await prisma.appointment.findMany({
      where: {
        orgId: user.orgId,
        appointmentDate: { gte: todayStart, lt: todayEnd },
        status: 'scheduled',
      },
      include: { contact: { select: { fullName: true } } },
      take: 5,
    });
    for (const apt of todayApts) {
      notifications.push({
        id: `apt-${apt.id}`,
        type: 'info',
        priority: 'medium',
        title: `Lịch hẹn: ${apt.contact?.fullName || 'KH'}`,
        detail: `${apt.appointmentTime || ''} - ${apt.notes || 'Tái khám'}`,
        createdAt: apt.appointmentDate.toISOString(),
      });
    }

    // 3. Tomorrow's appointments
    const tomorrowStart = new Date(todayEnd);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    const tmrApts = await prisma.appointment.count({
      where: {
        orgId: user.orgId,
        appointmentDate: { gte: tomorrowStart, lt: tomorrowEnd },
        status: 'scheduled',
      },
    });
    if (tmrApts > 0) {
      notifications.push({
        id: 'tmr-apts',
        type: 'info',
        priority: 'low',
        title: `${tmrApts} lịch hẹn ngày mai`,
        detail: 'Chuẩn bị cho ngày mai',
        createdAt: new Date().toISOString(),
      });
    }

    // 4. Nick Zalo mất kết nối — CHỈ trong phạm vi nick của viewer, cùng ngưỡng 15 phút với cron.
    //    Trước đây route liệt kê mọi nick trong org kèm displayName cho mọi role → rò rỉ
    //    tên nick của người khác (ngược tinh thần PR #1–#3) và báo động ngay khi vừa mất tick.
    const scope = await getRequestZaloScope(request as any);
    if (scope && (scope.isOrgAdmin || scope.accessibleIds.length > 0)) {
      const accounts = await prisma.zaloAccount.findMany({
        where: {
          orgId: user.orgId,
          ...(scope.isOrgAdmin ? {} : { id: { in: scope.accessibleIds } }),
        },
        select: { id: true, displayName: true, privacyMode: true, ownerUserId: true },
      });

      const viewerId = (user as any).userId ?? (user as any).id;

      for (const acc of accounts) {
        const status = zaloPool.getStatus(acc.id);
        // 'connecting' là trạng thái đang tự reconnect → chưa phải sự cố.
        if (status === 'connected' || status === 'connecting') continue;

        const downSince = getSessionDownSince(acc.id);
        const downMs = downSince ? Date.now() - downSince : null;
        // Session hết hiệu lực, phải quét QR lại → báo ngay, không chờ ngưỡng.
        const needsQr = status === 'qr_pending';
        if (!needsQr && (downMs === null || downMs < ZALO_ALERT_THRESHOLD_MS)) continue;

        const isOwnerOfNick = !!acc.ownerUserId && acc.ownerUserId === viewerId;
        const label =
          acc.privacyMode && !isOwnerOfNick ? PRIVACY_BLUR_TOKEN : acc.displayName || acc.id;

        notifications.push({
          id: `zalo-${acc.id}`,
          type: 'error',
          priority: 'high',
          title: needsQr ? `Zalo "${label}" cần quét QR lại` : `Zalo "${label}" mất kết nối`,
          detail: needsQr
            ? 'Session hết hiệu lực — vào Cài đặt › Nick Zalo để đăng nhập lại'
            : `Trạng thái: ${status}${downMs ? ` · mất kết nối ${Math.round(downMs / 60000)} phút` : ''}`,
          createdAt: (downSince ? new Date(downSince) : new Date()).toISOString(),
        });
      }
    }

    // 5. Security events (last 24h) - Only for admin/owner
    if (['owner', 'admin'].includes(user.role)) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const securityEvents = await prisma.activityLog.groupBy({
        by: ['action'],
        where: {
          orgId: user.orgId,
          action: { in: ['security_scope_denied', 'privacy_locked_access', 'security_scope_regression'] },
          createdAt: { gte: yesterday }
        },
        _count: { action: true },
      });

      for (const group of securityEvents) {
        if (group.action === 'security_scope_regression') {
          notifications.push({
            id: `sec-reg-${Date.now()}`,
            type: 'error',
            priority: 'high',
            title: 'CẢNH BÁO: lưới an toàn phát hiện route rò dữ liệu',
            detail: `${group._count.action} lượt rò rỉ bị chặn trong 24h qua`,
            createdAt: new Date().toISOString(),
          });
        } else {
          const typeName = group.action === 'security_scope_denied' ? 'ngoài phạm vi' : 'nick riêng tư';
          notifications.push({
            id: `sec-${group.action}-${Date.now()}`,
            type: 'error',
            priority: 'high',
            title: `${group._count.action} lượt truy cập trái phép bị chặn (24h)`,
            detail: `Lý do: Truy cập ${typeName}`,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    return { notifications };
  });
}
