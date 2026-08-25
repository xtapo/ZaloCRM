/**
 * Notification routes — persistent notifications cho user đang đăng nhập.
 *
 * Nguồn sự thật về "đang có gì đáng báo" là compute-notifications.ts; route GET
 * compute → syncNotifications() (upsert + emit socket) rồi trả danh sách đã persist
 * kèm unreadCount → FE giữ được trạng thái đã đọc qua các lần poll.
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import {
  computeNotifications,
  NOTIFICATION_SOURCES,
} from './compute-notifications.js';
import {
  filterByPrefs,
  getNotificationPrefs,
  listNotifications,
  markAllRead,
  markRead,
  saveNotificationPrefs,
  syncNotifications,
  unreadCount,
  viewerIdOf,
} from './notification-service.js';
import type { NotificationPrefs } from './notification-service.js';
import type { NotificationSource } from './compute-notifications.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/notifications', async (request) => {
    const user = request.user!;

    const computed = await computeNotifications(user);
    // Preferences lọc TRƯỚC sync → nguồn bị tắt không sinh row mới và được resolve.
    const prefs = await getNotificationPrefs(viewerIdOf(user));
    await syncNotifications(user, filterByPrefs(computed, prefs));

    const [notifications, unread] = await Promise.all([
      listNotifications(viewerIdOf(user), user.orgId),
      unreadCount(viewerIdOf(user)),
    ]);

    return { notifications, unreadCount: unread };
  });

  // Danh sách nguồn + trạng thái bật/tắt của user (FE settings render từ đây).
  app.get('/api/v1/notifications/preferences', async (request) => {
    const user = request.user!;
    const prefs = await getNotificationPrefs(viewerIdOf(user));
    return {
      sources: NOTIFICATION_SOURCES.map((src) => ({
        key: src,
        enabled: prefs.sources?.[src] !== false,
      })),
    };
  });

  // Lưu preferences. Body shape: { sources: { <source>: boolean } }. Chấp nhận
  // key hợp lệ, bỏ qua key lạ; nguồn thiếu = bật (mặc định).
  app.put('/api/v1/notifications/preferences', async (request, reply) => {
    const user = request.user!;
    const body = (request.body ?? {}) as NotificationPrefs;
    const validKeys = new Set<string>(NOTIFICATION_SOURCES);
    const sources: Partial<Record<NotificationSource, boolean>> = {};
    for (const [key, value] of Object.entries(body.sources ?? {})) {
      if (validKeys.has(key) && typeof value === 'boolean') {
        sources[key as NotificationSource] = value;
      }
    }
    await saveNotificationPrefs(viewerIdOf(user), { sources });
    return reply.code(204).send();
  });

  // Đánh dấu 1 thông báo đã đọc.
  app.patch('/api/v1/notifications/:id/read', async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    await markRead(viewerIdOf(user), id);
    return reply.code(204).send();
  });

  // Đánh dấu TẤT CẢ active đã đọc (nút "đánh dấu tất cả" trên FE).
  app.post('/api/v1/notifications/read-all', async (request, reply) => {
    const user = request.user!;
    await markAllRead(viewerIdOf(user));
    return reply.code(204).send();
  });
}
