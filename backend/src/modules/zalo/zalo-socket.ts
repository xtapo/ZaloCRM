/**
 * Zalo Socket.IO event handlers.
 * Manages room subscriptions for org-level and per-account events.
 *
 * FIX 2026-08-13 — trước đây bất kỳ socket nào (kể cả chưa đăng nhập) cũng join được
 * `org:<bất kỳ>` và `account:<bất kỳ>` → nghe lén QR đăng nhập và event của nick người khác.
 * Nay room join được đối chiếu với danh tính ở handshake (socket.data.user do
 * shared/realtime/socket-privacy.ts gắn) và scope nick của user.
 * Socket ẩn danh (client cũ chưa có cookie phiên) vẫn join được org room để không vỡ UI,
 * nhưng mọi event mang nội dung đều đã bị lọc/redact ở socket-privacy.ts.
 */
import type { Server, Socket } from 'socket.io';
import { logger } from '../../shared/utils/logger.js';
import { getZaloScope } from './zalo-scope.js';

interface SocketUser {
  id: string;
  orgId: string;
  role: string;
}

function userOf(socket: Socket): SocketUser | null {
  return (socket.data as any)?.user ?? null;
}

export function registerZaloSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    // Client should send orgId after connecting to join org-level room
    socket.on('org:join', (data: { orgId: string }) => {
      if (!data?.orgId) return;
      const user = userOf(socket);
      if (user && user.orgId !== data.orgId) {
        logger.warn(`Socket ${socket.id} (user=${user.id}) bị chặn join org:${data.orgId}`);
        return;
      }
      socket.join(`org:${data.orgId}`);
      logger.debug(`Socket ${socket.id} joined org:${data.orgId}`);
    });

    // Persistent notifications (2026-08-25) — room riêng từng user để emit
    // notification:new / notification:resolved. Chỉ được join room của CHÍNH MÌNH,
    // đối chiếu danh tính handshake giống guard của org:join.
    socket.on('user:join', (data: { userId: string }) => {
      if (!data?.userId) return;
      const user = userOf(socket);
      if (!user || user.id !== data.userId) {
        logger.warn(
          `Socket ${socket.id} (user=${user?.id ?? 'anon'}) bị chặn join user:${data.userId}`,
        );
        return;
      }
      socket.join(`user:${data.userId}`);
      logger.debug(`Socket ${socket.id} joined user:${data.userId}`);
    });

    // Subscribe to QR/status updates for a specific Zalo account
    socket.on('zalo:subscribe', async (data: { accountId: string }) => {
      if (!data?.accountId) return;
      const user = userOf(socket);
      if (user) {
        try {
          const scope = await getZaloScope(user.id, user.orgId, user.role);
          const allowed = scope.isOrgAdmin || (scope.accessibleIds ?? []).includes(data.accountId);
          if (!allowed) {
            logger.warn(
              `Socket ${socket.id} (user=${user.id}) bị chặn subscribe account:${data.accountId}`,
            );
            return;
          }
        } catch (err) {
          logger.error('[zalo-socket] scope check failed:', err);
          return;
        }
      }
      socket.join(`account:${data.accountId}`);
      logger.debug(`Socket ${socket.id} joined account:${data.accountId}`);
    });

    // Unsubscribe from a specific account room
    socket.on('zalo:unsubscribe', (data: { accountId: string }) => {
      if (!data?.accountId) return;
      socket.leave(`account:${data.accountId}`);
      logger.debug(`Socket ${socket.id} left account:${data.accountId}`);
    });
  });
}
