/**
 * audit-middleware.ts — Auto-log mọi mutation HTTP thành công vào ActivityLog.
 *
 * Fastify onResponse hook: với request POST/PUT/PATCH/DELETE trên /api/v1/** trả 2xx/3xx
 * và có request.user (đã auth) → log 1 row với action `<resource>_<method>`, resource =
 * segment đầu sau /api/v1/. KHÔNG log request body (tránh PII) — chỉ path + entityId.
 *
 * Skip-list:
 * - /api/v1/auth/*          → log thủ công Phase auth (ngữ nghĩa riêng login/logout/failed)
 * - /api/v1/messages*, chat → high-frequency, đã có message audit riêng (message_edit_audit)
 * - webhook/callback/public → caller không phải user đã auth
 * - Route có header x-audit-logged (logActivity thủ công đã ghi) → tránh double-log
 *
 * Fire-and-forget: lỗi log KHÔNG ảnh hưởng response.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { categoryOf } from './action-types.js';
import { AUDIT_LOGGED_HEADER, auditContext } from './activity-logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const METHOD_SUFFIX: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

function isSkipped(url: string): boolean {
  // Bỏ query string trước khi match path
  const path = url.split('?')[0];
  if (!path.startsWith('/api/v1/')) return true;
  if (path.startsWith('/api/v1/auth/') || path === '/api/v1/auth') return true;
  if (path.startsWith('/api/v1/messages')) return true;
  if (path.includes('/webhook') || path.includes('/callback')) return true;
  if (path.startsWith('/api/v1/public/')) return true;
  if (path.startsWith('/api/v1/zinstant')) return true; // proxy nội bộ zalo
  return false;
}

export function installAuditMiddleware(app: FastifyInstance): void {
  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
      if (!isSkipped(request.url)) {
        const statusCode = reply.statusCode;
        if (statusCode < 200 || statusCode >= 400) return;
        if (reply.getHeader(AUDIT_LOGGED_HEADER)) return; // manual log đã ghi

        const user = (request as { user?: { orgId?: string; userId?: string; id?: string } }).user;
        const orgId = user?.orgId;
        const userId = user?.userId ?? user?.id;
        if (!orgId || !userId) return; // unauthenticated mutation — không phải audit user action

        const path = request.url.split('?')[0];
        const segments = path.replace(/^\/api\/v1\//, '').split('/').filter(Boolean);
        const resource = segments[0] || 'unknown';
        const action = `${resource}_${METHOD_SUFFIX[request.method] ?? request.method.toLowerCase()}`;

        // entityId = param :id nếu là UUID ở segment thứ 2
        const maybeId = segments[1];
        const entityId = maybeId && UUID_RE.test(maybeId) ? maybeId : null;

        void prisma.activityLog.create({
          data: {
            orgId,
            userId,
            actorType: 'user',
            category: categoryOf(action) ?? null,
            action,
            entityType: resource,
            entityId,
            details: { method: request.method, path },
            ...auditContext(request),
          },
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[audit-middleware] Failed to log ${action}: ${msg}`);
        });
      }
    } catch (err) {
      logger.warn('[audit-middleware] Hook error:', err);
    }
  });
}
