/**
 * notification-service.ts — đồng bộ kết quả compute vào bảng `notifications` và
 * quản lý trạng thái đã đọc.
 *
 * Mô hình: compute-notifications.ts là nguồn sự thật cho "đang có gì đáng báo";
 * bảng DB lưu trạng thái (readAt) và lịch sử. syncNotifications() upsert theo
 * (userId, dedupeKey):
 *   - item mới → insert + emit `notification:new` tới room user:<id>
 *   - item đã có → cập nhật title/detail nếu đổi, GIỮ nguyên readAt
 *   - item trong DB không còn trong kết quả compute → set resolvedAt (ẩn khỏi danh
 *     sách nhưng giữ lịch sử) + emit `notification:resolved`
 *
 * Emit đi qua getter io() do app.ts decorate lúc bootstrap — module này không import
 * ngược app.ts.
 */
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import type { ComputedNotification, NotificationSource } from './compute-notifications.js';

/** Shape lưu trong User.notificationPrefs — nguồn thiếu/false = tắt. */
export interface NotificationPrefs {
  sources?: Partial<Record<NotificationSource, boolean>>;
}

/**
 * Đọc prefs của user. NULL/không parse được = tất cả bật (mặc định an toàn —
 * không bao giờ vì dữ liệu hỏng mà nuốt mất cảnh báo).
 */
export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationPrefs: true },
  });
  const raw = (u?.notificationPrefs ?? null) as unknown;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as NotificationPrefs;
  }
  return {};
}

/** Lọc bỏ các item thuộc nguồn user đã tắt — chạy TRƯỚC sync để không sinh row mới. */
export function filterByPrefs(
  computed: ComputedNotification[],
  prefs: NotificationPrefs,
): ComputedNotification[] {
  const disabled = new Set(
    Object.entries(prefs.sources ?? {})
      .filter(([, on]) => on === false)
      .map(([src]) => src),
  );
  if (disabled.size === 0) return computed;
  return computed.filter((item) => !disabled.has(item.source));
}

let ioRef: Server | null = null;

/** app.ts gọi 1 lần sau khi tạo io (pattern zaloPool.setIO). */
export function setNotificationIO(io: Server): void {
  ioRef = io;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function viewerIdOf(user: any): string {
  return user.userId ?? user.id;
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Danh sách active của user: unread trước rồi mới nhất trước, giới hạn 50 item. */
export async function listNotifications(userId: string, orgId: string) {
  const rows = await prisma.notification.findMany({
    where: { orgId, userId, resolvedAt: null },
    orderBy: [{ createdAt: 'desc' }],
    take: 50,
  });
  // Sort in-memory: unread lên đầu, trong mỗi nhóm sort theo priority rồi createdAt.
  return rows.sort((a, b) => {
    if (!!a.readAt !== !!b.readAt) return a.readAt ? 1 : -1;
    const pd = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
    if (pd !== 0) return pd;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, resolvedAt: null, readAt: null } });
}

/**
 * Đồng bộ 1 batch kết quả compute với DB cho 1 user. Trả về số row MỚI insert
 * (để caller biết cần đẩy badge qua socket).
 */
export async function syncNotifications(
  user: any,
  computed: ComputedNotification[],
): Promise<{ inserted: number; resolvedKeys: string[] }> {
  const orgId: string = user.orgId;
  const userId = viewerIdOf(user);

  const existing = await prisma.notification.findMany({
    where: { userId, resolvedAt: null },
    select: { id: true, dedupeKey: true, title: true, detail: true },
  });
  const existingByKey = new Map(existing.map((r) => [r.dedupeKey, r]));
  const computedKeys = new Set(computed.map((c) => c.dedupeKey));

  let inserted = 0;

  for (const item of computed) {
    const prev = existingByKey.get(item.dedupeKey);
    const createdAt = item.createdAt ?? new Date();

    if (!prev) {
      await prisma.notification.create({
        data: {
          orgId,
          userId,
          dedupeKey: item.dedupeKey,
          type: item.type,
          priority: item.priority,
          title: item.title,
          detail: item.detail,
          link: item.link ?? null,
          createdAt,
        },
      });
      inserted++;
      safeEmit(userRoom(userId), 'notification:new', {
        id: item.dedupeKey,
        type: item.type,
        title: item.title,
        detail: item.detail,
        priority: item.priority,
        link: item.link ?? null,
        createdAt: createdAt.toISOString(),
      });
      continue;
    }

    // Đã có — chỉ update nếu nội dung đổi (tránh ghi vô nghĩa mỗi tick 60s).
    if (prev.title !== item.title || prev.detail !== item.detail) {
      await prisma.notification.update({
        where: { id: prev.id },
        data: { title: item.title, detail: item.detail },
      });
    }
  }

  // Resolve: nguồn không còn báo nữa → ẩn khỏi danh sách active.
  const resolvedKeys = existing.filter((r) => !computedKeys.has(r.dedupeKey)).map((r) => r.id);
  if (resolvedKeys.length > 0) {
    await prisma.notification.updateMany({
      where: { id: { in: resolvedKeys } },
      data: { resolvedAt: new Date() },
    });
    for (const row of existing) {
      if (!computedKeys.has(row.dedupeKey)) {
        safeEmit(userRoom(userId), 'notification:resolved', { id: row.dedupeKey });
      }
    }
  }

  return { inserted, resolvedKeys };
}

export async function markRead(userId: string, id: string): Promise<boolean> {
  const res = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return res.count > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: { userId, resolvedAt: null, readAt: null },
    data: { readAt: new Date() },
  });
  return res.count;
}

/** Lưu prefs (PUT toàn bộ object — FE gửi shape đầy đủ). */
export async function saveNotificationPrefs(userId: string, prefs: NotificationPrefs): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { notificationPrefs: prefs as any },
  });
}

function safeEmit(room: string, event: string, payload: unknown): void {
  try {
    ioRef?.to(room).emit(event, payload);
  } catch (err) {
    logger.warn(`[notification-service] emit ${event} failed:`, err);
  }
}
