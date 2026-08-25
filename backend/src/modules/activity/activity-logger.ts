/**
 * activity-logger.ts — Helper `logActivity()` fire-and-forget.
 *
 * - KHÔNG await: log async background, không block response chính.
 * - Auto-derive category từ action via ACTION_CATEGORY map.
 * - Catch error silently (log.warn) — log fail không được crash main flow.
 */
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { categoryOf, type ActorType, type ActivityCategory } from './action-types.js';

export interface LogActivityInput {
  orgId: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown>;
  // Actor — chỉ truyền 1 trong 3:
  userId?: string | null;
  botName?: string | null;
  systemSource?: string | null;
  // Audit context (IP hash + device) — dùng auditContext(request) để extract
  ipHash?: string | null;
  userAgent?: string | null;
  // Optional override category nếu action chưa có trong map
  category?: ActivityCategory | null;
}

/**
 * Fire-and-forget log. Caller KHÔNG cần await. Errors logged but never throw.
 *
 * Usage:
 *   logActivity({ orgId, userId: user.id, action: 'status_change',
 *     entityType: 'contact', entityId: contact.id,
 *     details: { old: 'new', new: 'interested' } });
 */
export function logActivity(input: LogActivityInput): void {
  const actorType: ActorType = input.botName ? 'bot' : input.systemSource ? 'system' : 'user';
  const category = input.category ?? categoryOf(input.action);

  // Fire-and-forget — không await, không block.
  // Promise.resolve() wrap để cả lỗi đồng bộ (prisma client chưa init, mock trả
  // undefined...) cũng bị nuốt — log fail không được crash main flow.
  void Promise.resolve()
    .then(() =>
      prisma.activityLog.create({
        data: {
          orgId: input.orgId,
          userId: actorType === 'user' ? input.userId ?? null : null,
          actorType,
          botName: actorType === 'bot' ? input.botName ?? null : null,
          systemSource: actorType === 'system' ? input.systemSource ?? null : null,
          category,
          action: input.action,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          details: (input.details ?? {}) as object,
          ipHash: input.ipHash ?? null,
          userAgent: input.userAgent ?? null,
        },
      }),
    )
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[activity-log] Failed to log "${input.action}": ${msg}`);
    });
}

/**
 * Extract audit context từ Fastify request:
 * - ipHash: sha256(request.ip).slice(0,32) — không reversible, vẫn trace cross-user được.
 * - userAgent: header user-agent, cắt 255 ký tự.
 *
 * Usage:
 *   logActivity({ orgId, userId, action: 'auth_login', ...auditContext(request) });
 */
export function auditContext(
  request: FastifyRequest,
): { ipHash: string | null; userAgent: string | null } {
  const ip = request.ip || '';
  const ua = request.headers['user-agent'];
  return {
    ipHash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null,
  };
}

/** Header flag đánh dấu "đã log thủ công" — audit-middleware đọc để tránh double-log. */
export const AUDIT_LOGGED_HEADER = 'x-audit-logged';

/**
 * Helper compute diff cho update operations.
 * Trả object chỉ chứa fields đổi với { old, new } pairs.
 * Skip nếu old === new.
 */
export function computeDiff<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: (keyof T)[],
): Record<string, { old: unknown; new: unknown }> {
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  for (const f of fields) {
    const o = before[f];
    const n = after[f];
    // Deep equal cho array/object đơn giản
    if (Array.isArray(o) && Array.isArray(n)) {
      if (o.length !== n.length || o.some((v, i) => v !== n[i])) {
        diff[String(f)] = { old: o, new: n };
      }
      continue;
    }
    if (o !== n) diff[String(f)] = { old: o, new: n };
  }
  return diff;
}
