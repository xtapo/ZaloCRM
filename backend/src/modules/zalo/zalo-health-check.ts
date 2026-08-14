/**
 * zalo-health-check.ts — Cron-based health monitor for Zalo account connections.
 * Runs every 5 minutes to detect disconnected accounts and auto-reconnect them.
 * Also runs a daily session refresh at 04:00 UTC to keep cookies fresh.
 *
 * Episode rớt kết nối KHÔNG còn giữ trong Map in-memory. Nguồn sự thật là open record
 * (endedAt IS NULL) của bảng `zalo_account_status_log` — xem `status-log-service.ts`:
 *   - Bền qua restart/deploy: đồng hồ 15 phút không bị đếm lại từ 0.
 *   - Chung cho mọi instance: nhiều pod đọc cùng một mốc `downSince`.
 * Chống cảnh báo trùng cũng dựa trên DB (ActivityLog) thay vì cờ `alerted` in-memory:
 * chỉ cảnh báo khi CHƯA có bản ghi `zalo_session_down` nào kể từ khi episode bắt đầu.
 */
import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { zaloPool } from './zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

import type { Server } from 'socket.io';
import { logActivity } from '../activity/activity-logger.js';
import { getDownSince } from './status-log-service.js';

// Ngưỡng 15 phút rớt kết nối. Dùng `>=` để khớp đúng ngưỡng ở GET /api/v1/notifications.
const DOWN_ALERT_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Episode hiện tại đã được cảnh báo chưa? Dedup dựa trên ActivityLog nên vẫn đúng sau
 * restart hoặc khi chạy nhiều instance (trước đây dùng cờ in-memory `alerted`).
 */
async function alreadyAlerted(orgId: string, accountId: string, since: Date): Promise<boolean> {
  const found = await prisma.activityLog.findFirst({
    where: {
      orgId,
      action: 'zalo_session_down',
      entityType: 'zalo_account',
      entityId: accountId,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return !!found;
}

/**
 * Có nên báo "đã kết nối lại" không: chỉ khi episode rớt gần nhất ĐÃ được cảnh báo và
 * chưa có bản ghi recovered nào sau đó → tránh spam mỗi tick cron 5 phút.
 */
async function shouldAnnounceRecovery(orgId: string, accountId: string): Promise<boolean> {
  const base = { orgId, entityType: 'zalo_account', entityId: accountId };
  const [down, recovered] = await Promise.all([
    prisma.activityLog.findFirst({
      where: { ...base, action: 'zalo_session_down' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.activityLog.findFirst({
      where: { ...base, action: 'zalo_session_recovered' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  if (!down) return false;
  return !recovered || recovered.createdAt < down.createdAt;
}

export function startZaloHealthCheck(io?: Server): void {
  // Every 5 minutes: check all accounts with saved sessions
  cron.schedule('*/5 * * * *', async () => {
    try {
      const accounts = await prisma.zaloAccount.findMany({
        where: { sessionData: { not: Prisma.JsonNull } },
        select: { id: true, orgId: true, displayName: true, sessionData: true },
      });

      for (const acc of accounts) {
        const status = zaloPool.getStatus(acc.id);

        if (status !== 'connected' && status !== 'connecting' && status !== 'qr_pending') {
          const downSince = await getDownSince(acc.id);

          if (downSince !== null) {
            const downMs = Date.now() - downSince;
            const downMinutes = Math.floor(downMs / 60000);

            if (
              downMs >= DOWN_ALERT_THRESHOLD_MS &&
              !(await alreadyAlerted(acc.orgId, acc.id, new Date(downSince)))
            ) {
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
          if (await shouldAnnounceRecovery(acc.orgId, acc.id)) {
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
