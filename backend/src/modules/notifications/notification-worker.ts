/**
 * notification-worker.ts — vòng lặp 60s đồng bộ thông báo cho user đang ONLINE.
 *
 * Thay cho mô hình "FE poll 60s → route compute": worker chủ động compute + sync
 * (insert/resolve) rồi emit diff qua room `user:<id>` → badge FE cập nhật tức thì.
 * Route GET /notifications vẫn giữ nguyên làm fallback (reconnect, tab mới mở) và
 * cũng chạy sync nên không có kẻ hụt.
 *
 * Chỉ xử lý user có socket trong `user:*` rooms → org không ai online thì không tốn
 * query nào. Đúng pattern start/stop của các cron sẵn có (zalo-health-check…).
 */
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { computeNotifications } from './compute-notifications.js';
import { syncNotifications } from './notification-service.js';

const INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

/** userId của các socket đang nằm trong room `user:*` — không đếm trùng. */
export function getOnlineUserIds(io: Server): Set<string> {
  const online = new Set<string>();
  for (const [room] of io.of('/').adapter.rooms) {
    if (room.startsWith('user:')) online.add(room.slice('user:'.length));
  }
  return online;
}

export async function tickNotifications(io: Server): Promise<void> {
  const online = getOnlineUserIds(io);
  if (online.size === 0) return;

  const users = await prisma.user.findMany({
    where: { id: { in: [...online] }, isActive: true },
    select: { id: true, orgId: true, role: true },
  });

  for (const u of users) {
    // Mỗi user compute độc lập — lỗi 1 user không chặn những user còn lại.
    try {
      const computed = await computeNotifications(u);
      await syncNotifications(u, computed);
    } catch (err) {
      logger.warn(`[notification-worker] sync failed for user=${u.id}:`, err);
    }
  }
}

export function startNotificationWorker(io?: Server): void {
  if (!io || timer) return;
  timer = setInterval(() => {
    tickNotifications(io).catch((err) => logger.error('[notification-worker] tick failed:', err));
  }, INTERVAL_MS);
  // Không giữ event loop nếu mọi thứ khác đã thoát.
  timer.unref?.();
  logger.info('[notification-worker] started (interval 60s)');
}

export function stopNotificationWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
