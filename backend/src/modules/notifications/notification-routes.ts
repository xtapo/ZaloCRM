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
} from './compute-notifications.js';
import {
  listNotifications,
  markAllRead,
  markRead,
  syncNotifications,
  unreadCount,
  viewerIdOf,
} from './notification-service.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/notifications', async (request) => {
    const user = request.user!;

    const computed = await computeNotifications(user);
    await syncNotifications(user, computed);

    const [notifications, unread] = await Promise.all([
      listNotifications(viewerIdOf(user), user.orgId),
      unreadCount(viewerIdOf(user)),
    ]);

    return { notifications, unreadCount: unread };
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
