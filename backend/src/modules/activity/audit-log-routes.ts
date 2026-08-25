/**
 * audit-log-routes.ts — Audit Log toàn tổ chức (ActivityLog mọi category).
 *
 * Endpoints:
 *  1. GET /api/v1/audit-logs — listing filter: users, categories, actions, actorTypes,
 *     entityType/entityId, from/to, search. Composite cursor pagination `<ISO>|<id>` DESC.
 *  2. GET /api/v1/audit-logs/meta — distinct users + categories cho filter dropdown.
 *  3. GET /api/v1/audit-logs/export — CSV export, cap 10K rows.
 *
 * Gate: RBAC grant `audit_log.view_all` (owner/admin mặc định có theo permission-types matrix).
 * Mọi query BẮT BUỘC scope theo user.orgId — không bao giờ trả dữ liệu chéo org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { logger } from '../../shared/utils/logger.js';

/** Meta cache 60s — tránh query groupBy mỗi lần mở trang filter dropdown. */
let metaCache: { at: number; data: Record<string, unknown> } | null = null;
const META_CACHE_TTL_MS = 60_000;

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function csvList(value?: string): string[] | null {
  if (!value || !value.trim()) return null;
  const list = value.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

export async function auditLogRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/audit-logs/meta — filter dropdown data ───────────────────
  app.get('/api/v1/audit-logs/meta', {
    preHandler: requireGrant('audit_log', 'view_all'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const now = Date.now();
      if (metaCache && now - metaCache.at < META_CACHE_TTL_MS) {
        return reply.send(metaCache.data);
      }

      const [categories, users] = await Promise.all([
        prisma.activityLog.groupBy({
          by: ['category'],
          where: { orgId: user.orgId },
          _count: true,
        }),
        prisma.user.findMany({
          where: { orgId: user.orgId },
          select: { id: true, fullName: true, email: true },
          orderBy: { fullName: 'asc' },
        }),
      ]);

      const data = {
        categories: categories
          .filter((c) => c.category)
          .map((c) => ({ value: c.category as string, count: c._count })),
        users,
        actions: Object.keys(
          await import('./action-types.js').then((m) => m.ACTION_CATEGORY),
        ),
      };
      metaCache = { at: now, data };
      return reply.send(data);
    } catch (err) {
      logger.error('[audit-logs] Meta error:', err);
      return reply.status(500).send({ error: 'Failed to load audit log meta' });
    }
  });

  // ── GET /api/v1/audit-logs — main listing ────────────────────────────────
  app.get('/api/v1/audit-logs', {
    preHandler: requireGrant('audit_log', 'view_all'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      // Options-object route → Fastify generic không infer được; cast query thủ công
      const query = request.query as {
        cursor?: string; limit?: string;
        users?: string; categories?: string; actions?: string; actorTypes?: string;
        entityType?: string; entityId?: string;
        from?: string; to?: string; search?: string;
      };

      // Limit clamp (min 1, max 200)
      const parsedLimit = parseInt(query.limit || '50', 10);
      const limit = Math.max(1, Math.min(Number.isNaN(parsedLimit) ? 50 : parsedLimit, 200));

      // Composite cursor "<ISO>|<id>"
      let cursorDate: Date | null = null;
      let cursorId: string | null = null;
      if (query.cursor) {
        const parts = query.cursor.split('|');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          return reply.status(400).send({ error: 'Invalid cursor format. Expected <ISO>|<id>', code: 'INVALID_CURSOR' });
        }
        cursorDate = new Date(parts[0]);
        cursorId = parts[1];
        if (!cursorId || Number.isNaN(cursorDate.getTime())) {
          return reply.status(400).send({ error: 'Invalid cursor format. Expected <ISO>|<id>', code: 'INVALID_CURSOR' });
        }
      }

      const userIds = csvList(query.users);
      const categories = csvList(query.categories);
      const actions = csvList(query.actions);
      const actorTypes = csvList(query.actorTypes)?.filter((t) =>
        ['user', 'bot', 'system'].includes(t),
      );
      const fromDate = parseDate(query.from);
      const toDate = parseDate(query.to);
      const search = (query.search || '').trim();

      const where: Record<string, unknown> = { orgId: user.orgId }; // BẮT BUỘC org scope
      if (userIds?.length) where.userId = { in: userIds };
      if (categories?.length) where.category = { in: categories };
      if (actions?.length) where.action = { in: actions };
      if (actorTypes?.length) where.actorType = { in: actorTypes };
      if (query.entityType) where.entityType = query.entityType;
      if (query.entityId) where.entityId = query.entityId;

      const dateConditions: Record<string, Date> = {};
      if (fromDate) dateConditions.gte = fromDate;
      if (toDate) dateConditions.lte = toDate;

      // Cursor condition: createdAt < cursorDate OR (= AND id < cursorId)
      const andClauses: Record<string, unknown>[] = [];
      if (cursorDate && cursorId) {
        andClauses.push({
          OR: [
            { createdAt: { lt: cursorDate } },
            { createdAt: cursorDate, id: { lt: cursorId } },
          ],
        });
      }
      if (Object.keys(dateConditions).length) andClauses.push({ createdAt: dateConditions });
      if (andClauses.length) where.AND = andClauses;

      if (search) {
        where.OR = [
          { action: { contains: search, mode: 'insensitive' } },
          { details: { string_contains: search } },
          { user: { fullName: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const logs = await prisma.activityLog.findMany({
        where: where as any,
        include: { user: { select: { id: true, fullName: true, email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });

      return {
        logs,
        nextCursor: logs.length === limit
          ? `${logs[logs.length - 1].createdAt.toISOString()}|${logs[logs.length - 1].id}`
          : null,
      };
    } catch (err) {
      logger.error('[audit-logs] Listing error:', err);
      return reply.status(500).send({ error: 'Failed to load audit logs' });
    }
  });

  // ── GET /api/v1/audit-logs/export — CSV download ─────────────────────────
  app.get('/api/v1/audit-logs/export', {
    preHandler: requireGrant('audit_log', 'view_all'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const query = request.query as {
        users?: string; categories?: string; actions?: string; actorTypes?: string;
        entityType?: string; entityId?: string;
        from?: string; to?: string; search?: string;
      };
      const userIds = csvList(query.users);
      const categories = csvList(query.categories);
      const actions = csvList(query.actions);
      const actorTypes = csvList(query.actorTypes)?.filter((t) =>
        ['user', 'bot', 'system'].includes(t),
      );
      const fromDate = parseDate(query.from);
      const toDate = parseDate(query.to);
      const search = (query.search || '').trim();

      const where: Record<string, unknown> = { orgId: user.orgId };
      if (userIds?.length) where.userId = { in: userIds };
      if (categories?.length) where.category = { in: categories };
      if (actions?.length) where.action = { in: actions };
      if (actorTypes?.length) where.actorType = { in: actorTypes };
      if (query.entityType) where.entityType = query.entityType;
      if (query.entityId) where.entityId = query.entityId;

      const dateConditions: Record<string, Date> = {};
      if (fromDate) dateConditions.gte = fromDate;
      if (toDate) dateConditions.lte = toDate;
      if (Object.keys(dateConditions).length) where.createdAt = dateConditions;

      if (search) {
        where.OR = [
          { action: { contains: search, mode: 'insensitive' } },
          { details: { string_contains: search } },
          { user: { fullName: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
        ];
      }

      // Cap 10K rows chống runaway query
      const rows = await prisma.activityLog.findMany({
        where: where as any,
        include: { user: { select: { fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10_000,
      });

      const header = ['Thời gian', 'Category', 'Action', 'Actor type', 'Actor name', 'Entity', 'Details'];
      const escape = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      const lines = [header.map(escape).join(',')];
      for (const r of rows) {
        const actorName = r.actorType === 'user'
          ? (r.user?.fullName || r.user?.email || '—')
          : r.actorType === 'bot' ? (r.botName || 'Bot')
          : (r.systemSource || 'System');
        lines.push([
          r.createdAt.toISOString(),
          r.category || '',
          r.action,
          r.actorType,
          actorName,
          r.entityType && r.entityId ? `${r.entityType}:${r.entityId}` : '',
          JSON.stringify(r.details),
        ].map(escape).join(','));
      }
      const csv = '﻿' + lines.join('\n'); // BOM cho Excel hiểu UTF-8

      const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csv);
    } catch (err) {
      logger.error('[audit-logs] Export error:', err);
      return reply.status(500).send({ error: 'Failed to export audit logs' });
    }
  });
}
