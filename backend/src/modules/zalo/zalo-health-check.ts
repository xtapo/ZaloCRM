/**
 * zalo-health-check.ts — Cron-based health monitor for Zalo account connections.
 * Runs every 5 minutes to detect disconnected accounts and auto-reconnect them.
 * Also runs a daily session refresh at 04:00 UTC to keep cookies fresh.
 *
 * Episode rớt kết nối được theo dõi trong `downTracker` (in-memory, module scope) để
 * cron và `GET /api/v1/notifications` dùng CHUNG một nguồn sự thật + chung ngưỡng 15 phút.
 * Hạn chế đã biết: state mất khi restart/deploy (đồng hồ 15 phút đếm lại) và có thể
 * cảnh báo trùng khi chạy nhiều instance — sẽ xử lý dứt điểm bằng cột
 * `zaloAccount.lastDisconnectedAt` ở PR sau.
 */
import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { zaloPool } from './zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

import type { Server } from 'socket.io';
import { logActivity } from '../activity/activity-logger.js';

const DOWN_ALERT_THRESHOLD_MS = 15 * 60 * 1000; // Ngưỡng 15 phút rớt kết nối

/** accountId -> { downSince, alerted } */
const downTracker = new Map<string, { downSince: number; alerted: boolean }>();

/**
 * Thời điểm (epoch ms) nick bắt đầu rớt kết nối, hoặc null nếu đang bình thường /
 * chưa ghi nhận episode nào. Dùng ở notification-routes để áp cùng ngưỡng với cron.
 */
export function getSessionDownSince(accountId: string): number | null {
  return downTracker.get(accountId)?.downSince ?? null;
}

export function startZaloHealthCheck(io?: Server): void {
  // Khởi động lại monitor → episode cũ không còn ý nghĩa (và giữ test isolation).
  downTracker.clear();

  // Every 5 minutes: check all accounts with saved sessions
  cron.schedule('*/5 * * * *', async () => {
    try {
      const accounts = await prisma.zaloAccount.findMany({
        where: { sessionData: { not: Prisma.JsonNull } },
        select: { id: true, orgId: true, displayName: true, sessionData: true },
      });

      for (const acc of accounts) {
        const status = zaloPool.getStatus(acc.id);
        const tracker = downTracker.get(acc.id);

        if (status !== 'connected' && status !== 'connecting' && status !== 'qr_pending') {
          if (!tracker) {
            downTracker.set(acc.id, { downSince: Date.now(), alerted: false });
          } else {
            const downMinutes = Math.floor((Date.now() - tracker.downSince) / 60000);
            if (Date.now() - tracker.downSince > DOWN_ALERT_THRESHOLD_MS && !tracker.alerted) {
              tracker.alerted = true;
              logActivity({
                orgId: acc.orgId,
                systemSource: 'zalo-health-check',
                action: 'zalo_session_down',
                entityType: 'zalo_account',
                entityId: acc.id,
                details: { displayName: acc.displayName, downMinutes, status },
              });
              if (io) {
                io.to(`org:${acc.orgId}`).emit('zalo:session-alert', {
                  accountId: acc.id,
                  displayName: acc.displayName,
                  status,
                  downMinutes,
                });
              }
            }
          }

          const session = acc.sessionData as any;
          if (session?.imei) {
            logger.info(`[health-check] Reconnecting ${acc.displayName || acc.id}...`);
            zaloPool.reconnect(acc.id, session).catch((err) => {
              logger.warn(`[health-check] Reconnect failed for ${acc.id}:`, err);
            });
          }
        } else if (status === 'connected') {
          if (tracker) {
            if (tracker.alerted) {
              logActivity({
                orgId: acc.orgId,
                systemSource: 'zalo-health-check',
                action: 'zalo_session_recovered',
                entityType: 'zalo_account',
                entityId: acc.id,
                details: { displayName: acc.displayName },
              });
              if (io) {
                io.to(`org:${acc.orgId}`).emit('zalo:session-recovered', {
                  accountId: acc.id,
                  displayName: acc.displayName,
                });
              }
            }
            downTracker.delete(acc.id);
          }
        }
      }
    } catch (err) {
      logger.error('[health-check] Error during health check:', err);
    }
  });

  // Daily at 04:00 UTC (11:00 AM VN): refresh all sessions to keep cookies alive
  cron.schedule('0 4 * * *', async () => {
    logger.info('[health-check] Daily session refresh starting...');
    try {
      const accounts = await prisma.zaloAccount.findMany({
        where: { sessionData: { not: Prisma.JsonNull } },
        select: { id: true, sessionData: true },
      });

      for (const acc of accounts) {
        const session = acc.sessionData as any;
        if (session?.imei) {
          // Disconnect then reconnect to force cookie refresh
          zaloPool.disconnect(acc.id);
          await new Promise((r) => setTimeout(r, 5000));
          zaloPool.reconnect(acc.id, session).catch((err) => {
            logger.warn(`[health-check] Daily refresh failed for ${acc.id}:`, err);
          });
        }
        // Stagger reconnects by 10 seconds per account to avoid rate limits
        await new Promise((r) => setTimeout(r, 10000));
      }
    } catch (err) {
      logger.error('[health-check] Error during daily refresh:', err);
    }
  });

  logger.info('[health-check] Zalo health check started (every 5 min + daily refresh at 04:00 UTC)');
}
