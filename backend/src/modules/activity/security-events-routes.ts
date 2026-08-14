/**
/**
 * security-events-routes.ts — Endpoint quản lý và tra cứu Sự kiện Bảo mật (ActivityLog category='security').
 *
 * Chỉ cho phép role ['owner', 'admin'] truy cập.
 * Hỗ trợ filter: from, to, actions, search, cursor pagination (createdAt DESC).
 * Redaction: Che tên nick/tài khoản có privacyMode === 'main' nếu viewer không phải chủ sở hữu.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { PRIVACY_BLUR_TOKEN } from '../privacy/redact.js';

export const SECURITY_ACTIONS = [
  'security_scope_denied',
  'privacy_locked_access',
  'security_scope_regression',
  'zalo_session_down',
  'zalo_session_recovered',
];

export async function securityEventsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/security-events', async (request: FastifyRequest<{
    Querystring: {
      cursor?: string;
      limit?: string;
      actions?: string;
      from?: string;
      to?: string;
      search?: string;
    };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;

      // 1. Role Gate: Bắt buộc chỉ owner và admin (role khác trả 403)
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({
          error: 'Forbidden — Chỉ Owner và Admin mới có quyền truy cập sự kiện bảo mật',
          code: 'FORBIDDEN',
        });
      }

      const limit = Math.min(parseInt(request.query.limit || '50') || 50, 200);
      const cursorDate = request.query.cursor ? new Date(request.query.cursor) : null;
      if (cursorDate && Number.isNaN(cursorDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid cursor' });
      }

      // 2. Action filter
      const actionsArr = request.query.actions
        ? request.query.actions.split(',').map((s) => s.trim()).filter(Boolean)
        : null;

      const validActions = actionsArr
        ? actionsArr.filter((a) => SECURITY_ACTIONS.includes(a))
        : SECURITY_ACTIONS;

      const fromDate = request.query.from ? new Date(request.query.from) : null;
      const toDate = request.query.to ? new Date(request.query.to) : null;
      const search = (request.query.search || '').trim();

      // 3. Xây dựng WHERE clause — BẮT BUỘC theo user.orgId
      const where: Record<string, unknown> = {
        orgId: user.orgId,
        category: 'security',
        action: { in: validActions.length ? validActions : SECURITY_ACTIONS },
      };

      const dateConditions: Record<string, Date> = {};
      if (fromDate && !Number.isNaN(fromDate.getTime())) dateConditions.gte = fromDate;
      if (toDate && !Number.isNaN(toDate.getTime())) dateConditions.lte = toDate;
      if (cursorDate) dateConditions.lt = cursorDate;
      if (Object.keys(dateConditions).length) where.createdAt = dateConditions;

      if (search) {
        where.OR = [
          { action: { contains: search, mode: 'insensitive' } },
          { systemSource: { contains: search, mode: 'insensitive' } },
          { details: { string_contains: search } },
        ];
      }

      const events = await prisma.activityLog.findMany({
        where: where as any,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      // 4. Privacy Redaction cho nick privacyMode
      const viewerId = (user as any).userId ?? (user as any).id;
      const zaloAccountIds = new Set<string>();

      for (const e of events) {
        if (e.entityType === 'zalo_account' && e.entityId) {
          zaloAccountIds.add(e.entityId);
        }
        const d = e.details as Record<string, any> | null;
        if (d?.accountId && typeof d.accountId === 'string') {
          zaloAccountIds.add(d.accountId);
        }
      }

      const privacyAccounts = zaloAccountIds.size > 0
        ? await prisma.zaloAccount.findMany({
            where: {
              id: { in: [...zaloAccountIds] },
              orgId: user.orgId,
            },
            select: { id: true, privacyMode: true, ownerUserId: true, displayName: true },
          })
        : [];

      const privacyMap = new Map<string, { isPrivate: boolean; ownerUserId: string | null; displayName: string | null }>();
      for (const acc of privacyAccounts) {
        privacyMap.set(acc.id, {
          isPrivate: acc.privacyMode === 'main' || acc.privacyMode === 'true' || (acc.privacyMode as any) === true,
          ownerUserId: acc.ownerUserId,
          displayName: acc.displayName,
        });
      }

      const redactedEvents = events.map((e) => {
        const d = (e.details ?? {}) as Record<string, any>;
        const accId = (e.entityType === 'zalo_account' ? e.entityId : d.accountId) as string | undefined;

        const details = { ...d };
        if (accId && privacyMap.has(accId)) {
          const accInfo = privacyMap.get(accId)!;
          const isOwnerOfNick = !!accInfo.ownerUserId && accInfo.ownerUserId === viewerId;
          if (accInfo.isPrivate && !isOwnerOfNick) {
            if (details.displayName) details.displayName = PRIVACY_BLUR_TOKEN;
            if (details.accountName) details.accountName = PRIVACY_BLUR_TOKEN;
            if (details.name) details.name = PRIVACY_BLUR_TOKEN;
          }
        }

        return {
          id: e.id,
          orgId: e.orgId,
          userId: e.userId,
          actorType: e.actorType,
          botName: e.botName,
          systemSource: e.systemSource,
          category: e.category,
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId,
          details,
          createdAt: e.createdAt.toISOString(),
          user: e.user,
        };
      });

      const nextCursor = events.length === limit
        ? events[events.length - 1].createdAt.toISOString()
        : null;

      return {
        events: redactedEvents,
        nextCursor,
      };
    } catch (err) {
      logger.error('[security-events] Error loading security events:', err);
      return reply.status(500).send({ error: 'Failed to load security events' });
    }
  });
}
