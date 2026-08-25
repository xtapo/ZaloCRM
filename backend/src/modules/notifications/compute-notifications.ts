/**
 * compute-notifications.ts — engine tính các thông báo "đang active" của 1 user.
 *
 * Tách từ notification-routes.ts (2026-08-25) để cả route GET lẫn notification-worker
 * dùng chung 1 nguồn sự thật. Mỗi item trả về kèm `dedupeKey` tất định (không đổi giữa
 * các lần compute trừ khi có sự kiện mới) và `link` (route FE điều hướng) →
 * notification-service upsert theo (userId, dedupeKey).
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { getRequestZaloScope } from '../chat/chat-security-hooks.js';
import { getDownSinceBatch } from '../zalo/status-log-service.js';
import { PRIVACY_BLUR_TOKEN } from '../privacy/redact.js';

/** Trùng ngưỡng cảnh báo của cron zalo-health-check.ts — tránh 2 nguồn sự thật. */
export const ZALO_ALERT_THRESHOLD_MS = 15 * 60 * 1000;

export interface ComputedNotification {
  /** Nguồn phát sinh — dùng cho notification preferences (bật/tắt per-user). */
  source: NotificationSource;
  dedupeKey: string;
  type: string; // info | warning | error
  priority: string; // high | medium | low
  title: string;
  detail: string;
  link?: string;
  createdAt?: Date; // mốc gốc của sự kiện nếu có, mặc định now()
}

/**
 * Nguồn thông báo — đóng băng danh sách để FE settings hiển thị đúng thứ tự.
 * `security` chỉ hiện ở settings của owner/admin (route tự kiểm soát).
 */
export const NOTIFICATION_SOURCES = [
  'unreplied_chat',
  'appointments',
  'zalo_connection',
  'security',
  'group_pending',
] as const;
export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number];

export async function computeNotifications(user: any): Promise<ComputedNotification[]> {
  const notifications: ComputedNotification[] = [];
  const viewerId: string = user.userId ?? user.id;

  // 1. Unreplied conversations > 30 min
  const thirtyMinAgo = new Date(Date.now() - 30 * 60000);
  const unreplied = await prisma.conversation.count({
    where: { orgId: user.orgId, isReplied: false, lastMessageAt: { lt: thirtyMinAgo } },
  });
  if (unreplied > 0) {
    notifications.push({
      source: 'unreplied_chat',
      dedupeKey: 'unreplied',
      type: 'warning',
      priority: 'high',
      title: `${unreplied} cuộc trò chuyện chưa trả lời`,
      detail: 'Có tin nhắn chưa phản hồi quá 30 phút',
      link: '/chat',
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
      source: 'appointments',
      dedupeKey: `apt-${apt.id}`,
      type: 'info',
      priority: 'medium',
      title: `Lịch hẹn: ${apt.contact?.fullName || 'KH'}`,
      detail: `${apt.appointmentTime || ''} - ${apt.notes || 'Tái khám'}`,
      link: '/appointments',
      createdAt: apt.appointmentDate,
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
      source: 'appointments',
      dedupeKey: 'tmr-apts',
      type: 'info',
      priority: 'low',
      title: `${tmrApts} lịch hẹn ngày mai`,
      detail: 'Chuẩn bị cho ngày mai',
      link: '/appointments',
    });
  }

  // 4. Nick Zalo mất kết nối — CHỈ trong phạm vi nick của viewer, cùng ngưỡng 15 phút với cron.
  //    Trước đây route liệt kê mọi nick trong org kèm displayName cho mọi role → rò rỉ
  //    tên nick của người khác (ngược tinh thần PR #1–#3) và báo động ngay khi vừa mất tick.
  //    Mốc `downSince` đọc từ `zalo_account_status_log` (1 query batch) nên bền qua restart
  //    và khớp tuyệt đối với ngưỡng cron.
  const scope = await getRequestZaloScope({ user } as any);
  if (scope && (scope.isOrgAdmin || scope.accessibleIds.length > 0)) {
    const accounts = await prisma.zaloAccount.findMany({
      where: {
        orgId: user.orgId,
        ...(scope.isOrgAdmin ? {} : { id: { in: scope.accessibleIds } }),
      },
      select: { id: true, displayName: true, privacyMode: true, ownerUserId: true },
    });

    const downSinceMap = await getDownSinceBatch(accounts.map((acc) => acc.id));

    for (const acc of accounts) {
      const status = zaloPool.getStatus(acc.id);
      // 'connecting' là trạng thái đang tự reconnect → chưa phải sự cố.
      if (status === 'connected' || status === 'connecting') continue;

      const downSince = downSinceMap.get(acc.id) ?? null;
      const downMs = downSince ? Date.now() - downSince : null;
      // Session hết hiệu lực, phải quét QR lại → báo ngay, không chờ ngưỡng.
      const needsQr = status === 'qr_pending';
      if (!needsQr && (downMs === null || downMs < ZALO_ALERT_THRESHOLD_MS)) continue;

      // `privacy_mode` là TEXT NOT NULL DEFAULT 'sub' với CHECK IN ('main','sub'), nên
      // kiểm tra truthy đúng với MỌI nick → trước đây nick thường của người khác
      // cũng bị che tên, owner/admin không còn biết nick nào đang rớt. Chỉ nick 'main'
      // mới riêng tư — giống ngỡ nghĩa privacyMode !== 'main' trong privacy/redact.ts.
      const isPrivateNick = acc.privacyMode === 'main';
      const isOwnerOfNick = !!acc.ownerUserId && acc.ownerUserId === viewerId;
      const label = isPrivateNick && !isOwnerOfNick ? PRIVACY_BLUR_TOKEN : acc.displayName || acc.id;

      notifications.push({
        source: 'zalo_connection',
        dedupeKey: `zalo-${acc.id}`,
        type: 'error',
        priority: 'high',
        title: needsQr ? `Zalo "${label}" cần quét QR lại` : `Zalo "${label}" mất kết nối`,
        detail: needsQr
          ? 'Session hết hiệu lực — vào Cài đặt › Nick Zalo để đăng nhập lại'
          : `Trạng thái: ${status}${downMs ? ` · mất kết nối ${Math.round(downMs / 60000)} phút` : ''}`,
        link: '/zalo-accounts',
        createdAt: downSince ? new Date(downSince) : new Date(),
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
        createdAt: { gte: yesterday },
      },
      _count: { action: true },
      // Mốc sự kiện MỚI NHẤT của nhóm — dùng cho cả dedupeKey và createdAt.
      _max: { createdAt: true },
    });

    for (const group of securityEvents) {
      // Key tất định: trước đây dùng `Date.now()` nên mỗi lần poll 60s lại sinh key khác →
      // Vue render lại cả danh sách và không thể làm tính năng đánh dấu đã đọc / bỏ qua.
      // Nay key chỉ đổi khi có sự kiện bảo mật MỚI.
      const latestAt = group._max?.createdAt ?? new Date();
      const eventStamp = latestAt.getTime();

      if (group.action === 'security_scope_regression') {
        notifications.push({
          source: 'security',
          dedupeKey: `sec-reg-${eventStamp}`,
          type: 'error',
          priority: 'high',
          title: 'CẢNH BÁO: lưới an toàn phát hiện route rò dữ liệu',
          detail: `${group._count.action} lượt rò rỉ bị chặn trong 24h qua`,
          link: '/security-events',
          createdAt: latestAt,
        });
      } else {
        const typeName = group.action === 'security_scope_denied' ? 'ngoài phạm vi' : 'nick riêng tư';
        notifications.push({
          source: 'security',
          dedupeKey: `sec-${group.action}-${eventStamp}`,
          type: 'error',
          priority: 'high',
          title: `${group._count.action} lượt truy cập trái phép bị chặn (24h)`,
          detail: `Lý do: Truy cập ${typeName}`,
          link: '/security-events',
          createdAt: latestAt,
        });
      }
    }
  }

  // 6. Nhóm Zalo được phân công có tin nhắn chưa xử lý (>30 phút).
  //    Join qua GroupCrmProfile (assignedUserId == user) → conversation nhóm tương ứng.
  const myGroupProfiles = await prisma.groupCrmProfile.findMany({
    where: { orgId: user.orgId, assignedUserId: viewerId },
    select: { zaloAccountId: true, externalGroupId: true, crmName: true },
  });
  if (myGroupProfiles.length > 0) {
    // OR per-profile vì unique key là cặp (accountId, groupId)
    const pendingGroups = await prisma.conversation.findMany({
      where: {
        orgId: user.orgId,
        threadType: 'group',
        isReplied: false,
        lastMessageAt: { lt: thirtyMinAgo },
        OR: myGroupProfiles.map((p) => ({
          zaloAccountId: p.zaloAccountId,
          externalThreadId: p.externalGroupId,
        })),
      },
      select: {
        id: true,
        externalThreadId: true,
        groupName: true,
        lastMessageAt: true,
        zaloAccountId: true,
      },
      take: 10,
      orderBy: { lastMessageAt: 'desc' },
    });
    for (const conv of pendingGroups) {
      const profile = myGroupProfiles.find(
        (p) => p.zaloAccountId === conv.zaloAccountId && p.externalGroupId === conv.externalThreadId,
      );
      notifications.push({
        source: 'group_pending',
        dedupeKey: `group-pending-${conv.id}`,
        type: 'warning',
        priority: 'high',
        title: `Nhóm "${profile?.crmName || conv.groupName || 'nhóm'}" chưa xử lý`,
        detail: 'Bạn phụ trách nhóm này — có tin nhắn chưa phản hồi quá 30 phút',
        link: '/chat',
        createdAt: conv.lastMessageAt ?? new Date(),
      });
    }
  }

  return notifications;
}
