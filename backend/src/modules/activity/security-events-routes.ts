/**
 * security-events-routes.ts — Endpoint quản lý và tra cứu Sự kiện Bảo mật (ActivityLog category='security').
 *
 * Chỉ cho phép role ['owner', 'admin'] truy cập.
 * Hỗ trợ filter: from, to, actions, search, composite cursor pagination (createdAt DESC, id DESC).
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

      // 2. Limit clamp (chặn limit âm, min 1, max 200)
      const parsedLimit = parseInt(request.query.limit || '50', 10);
      const limit = Math.max(1, Math.min(Number.isNaN(parsedLimit) ? 50 : parsedLimit, 200));

      // 3. Parse composite cursor: "<ISO>|<id>"
      let cursorDate: Date | null = null;
      let cursorId: string | null = null;
      if (request.query.cursor) {
        const parts = request.query.cursor.split('|');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          return reply.status(400).send({
            error: 'Invalid cursor format. Expected <ISO>|<id>',
            code: 'INVALID_CURSOR',
          });
        }
        cursorDate = new Date(parts[0]);
        cursorId = parts[1];
        if (Number.isNaN(cursorDate.getTime())) {
          return reply.status(400).send({
            error: 'Invalid cursor format. Expected <ISO>|<id>',
            code: 'INVALID_CURSOR',
          });
        }
      }

      // 4. Action filter — nếu truyền chuỗi không hợp lệ thì trả rỗng
      let filterActions: string[] | null = null;
      if (typeof request.query.actions === 'string' && request.query.actions.trim()) {
        const rawList = request.query.actions.split(',').map((s) => s.trim()).filter(Boolean);
        filterActions = rawList.filter((a) => SECURITY_ACTIONS.includes(a));
        if (filterActions.length === 0) {
          return { events: [], nextCursor: null };
        }
      }

      const fromDate = request.query.from ? new Date(request.query.from) : null;
      const toDate = request.query.to ? new Date(request.query.to) : null;
      const search = (request.query.search || '').trim();

      // 5. Xây dựng WHERE clause — BẮT BUỘC theo user.orgId
      const where: Record<string, any> = {
        orgId: user.orgId,
        category: 'security',
        action: { in: filterActions !== null ? filterActions : SECURITY_ACTIONS },
      };

      const dateConditions: Record<string, Date> = {};
      if (fromDate && !Number.isNaN(fromDate.getTime())) dateConditions.gte = fromDate;
      if (toDate && !Number.isNaN(toDate.getTime())) dateConditions.lte = toDate;
      if (Object.keys(dateConditions).length) {
        where.createdAt = dateConditions;
      }

      // Cursor composite condition: createdAt < cursorDate OR (createdAt = cursorDate AND id < cursorId)
      const andClauses: Record<string, any>[] = [];
      if (cursorDate && cursorId) {
        andClauses.push({
          OR: [
            { createdAt: { lt: cursorDate } },
            { createdAt: cursorDate, id: { lt: cursorId } },
          ],
        });
      }

      if (andClauses.length > 0) {
        where.AND = andClauses;
      }

      if (search) {
        where.OR = [
          { action: { contains: search, mode: 'insensitive' } },
          { systemSource: { contains: search, mode: 'insensitive' } },
          { details: { path: ['displayName'], string_contains: search } },
          { details: { path: ['accountName'], string_contains: search } },
          { details: { path: ['reason'], string_contains: search } },
          { details: { path: ['path'], string_contains: search } },
          { user: { fullName: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const events = await prisma.activityLog.findMany({
        where: where as any,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });

      // 6. Privacy Redaction cho nick privacyMode === 'main'
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
          isPrivate: acc.privacyMode === 'main',
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
        ? `${events[events.length - 1].createdAt.toISOString()}|${events[events.length - 1].id}`
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
