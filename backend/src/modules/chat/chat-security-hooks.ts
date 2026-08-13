/**
 * chat-security-hooks.ts — Guard cấp root cho các endpoint hội thoại (2026-08-13).
 *
 * Vá các lỗ hổng:
 *   1. `GET /api/v1/conversations/:id` trước đây KHÔNG có `requireZaloAccess` và không redact
 *      → bất kỳ user nào trong org, chỉ cần biết id, là đọc được contact PII + preview tin
 *      nhắn của nick người khác.
 *   2. `POST /api/v1/conversations/:id/mark-read` không guard → ai cũng reset unread nick khác.
 *   3. `GET /api/v1/conversations` chỉ lọc theo ZaloAccountAccess khi `user.role === 'member'`;
 *      các role khác (leader/manager/legacy) nhìn thấy toàn bộ hội thoại của org.
 *      Hook lọc lại payload theo `getZaloScope` — không phụ thuộc chuỗi role nữa.
 *
 * Kèm theo: set cookie phiên `crm_session` (HttpOnly) từ Bearer token, để Socket.IO handshake
 * nhận diện được viewer (xem shared/realtime/socket-privacy.ts). Frontend KHÔNG phải sửa gì:
 * cookie được cấp ở request API đã xác thực đầu tiên sau khi đăng nhập.
 *
 * Phải gọi ở root instance, TRƯỚC mọi `app.register(...)` route.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { config } from '../../config/index.js';
import { getZaloScope } from '../zalo/zalo-scope.js';
import {
  buildPrivacyContext,
  canSeeConversationContent,
  redactContact,
  PRIVACY_BLUR_TOKEN,
} from '../privacy/redact.js';

const CONV_DETAIL_RE = /^\/api\/v1\/conversations\/([^/]+)$/;
const CONV_MARK_READ_RE = /^\/api\/v1\/conversations\/([^/]+)\/mark-read$/;
const CONV_LIST_PATH = '/api/v1/conversations';
const RESERVED_SEGMENTS = new Set(['counts', 'search', 'unread']);

const SESSION_COOKIE = 'crm_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

interface GuardState {
  scope?: { accessibleIds: string[]; isOrgAdmin: boolean };
  redactContent?: boolean;
}

function stateOf(request: FastifyRequest): GuardState {
  const anyRequest = request as any;
  if (!anyRequest.__chatGuard) anyRequest.__chatGuard = {} as GuardState;
  return anyRequest.__chatGuard as GuardState;
}

function pathOf(request: FastifyRequest): string {
  return (request.raw.url ?? '').split('?')[0];
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function ensureSessionCookie(request: FastifyRequest, reply: FastifyReply): void {
  const header = request.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) return;
  const token = header.slice(7).trim();
  if (!token) return;
  if (readCookie(request.headers.cookie, SESSION_COOKIE) === token) return;

  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (config.isProduction) parts.push('Secure');
  reply.header('Set-Cookie', parts.join('; '));
}

async function scopeFor(request: FastifyRequest) {
  const user = (request as any).user;
  if (!user?.orgId) return null;
  const state = stateOf(request);
  if (!state.scope) {
    const scope = await getZaloScope(user.userId ?? user.id, user.orgId, user.role);
    state.scope = { accessibleIds: scope.accessibleIds ?? [], isOrgAdmin: !!scope.isOrgAdmin };
  }
  return state.scope;
}

function conversationIdFrom(path: string, method: string): string | null {
  if (method === 'GET') {
    const detail = CONV_DETAIL_RE.exec(path);
    if (detail && !RESERVED_SEGMENTS.has(detail[1])) return detail[1];
    return null;
  }
  if (method === 'POST') {
    const markRead = CONV_MARK_READ_RE.exec(path);
    if (markRead) return markRead[1];
  }
  return null;
}

export function installChatSecurityHooks(app: FastifyInstance): void {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = pathOf(request);
    if (!path.startsWith('/api/v1/conversations')) return;

    // Tự xác thực (hook root chạy trước authMiddleware của route).
    // Token hỏng → im lặng, để route trả 401 như cũ.
    try {
      await (request as any).jwtVerify();
    } catch {
      return;
    }

    ensureSessionCookie(request, reply);

    const user = (request as any).user;
    if (!user?.orgId) return;
    const userId = user.userId ?? user.id;

    const conversationId = conversationIdFrom(path, request.method);
    if (!conversationId) return;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, orgId: user.orgId },
      select: {
        id: true,
        zaloAccountId: true,
        zaloAccount: { select: { privacyMode: true, ownerUserId: true } },
      },
    });
    // Không tìm thấy / khác org → để route xử lý 404 như cũ.
    if (!conversation) return;

    const scope = await scopeFor(request);
    const allowed =
      !!scope &&
      (scope.isOrgAdmin ||
        scope.accessibleIds.includes(conversation.zaloAccountId) ||
        conversation.zaloAccount?.ownerUserId === userId);

    if (!allowed) {
      logger.warn(
        `[chat-security] chặn ${request.method} ${path} — user=${userId} không có quyền trên nick ${conversation.zaloAccountId}`,
      );
      return reply.status(403).send({
        error: 'Bạn không có quyền truy cập hội thoại của nick Zalo này',
        code: 'ZALO_SCOPE_FORBIDDEN',
      });
    }

    const privacyContext = await buildPrivacyContext(request as any);
    const canSeeContent = canSeeConversationContent(conversation as any, privacyContext);
    if (!canSeeContent) {
      // Đọc chi tiết → trả bản đã redact ở onSend. Ghi (mark-read) → chặn hẳn.
      if (request.method !== 'GET') {
        return reply.status(403).send({
          error: 'Nick này đang bật chế độ riêng tư — chỉ chính chủ mới thao tác được',
          code: 'PRIVACY_LOCKED',
        });
      }
      stateOf(request).redactContent = true;
    }
  });

  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (typeof payload !== 'string') return payload;
    if (request.method !== 'GET') return payload;
    if (reply.statusCode < 200 || reply.statusCode >= 300) return payload;

    const path = pathOf(request);
    if (!path.startsWith('/api/v1/conversations')) return payload;

    const isList = path === CONV_LIST_PATH;
    const state = stateOf(request);
    if (!isList && !state.redactContent) return payload;

    let data: any;
    try {
      data = JSON.parse(payload);
    } catch {
      return payload;
    }

    if (isList) {
      const scope = await scopeFor(request);
      if (!scope || scope.isOrgAdmin) return payload;
      if (!Array.isArray(data?.conversations)) return payload;

      const allowedIds = new Set(scope.accessibleIds);
      const before = data.conversations.length;
      data.conversations = data.conversations.filter(
        (row: any) => !row?.zaloAccountId || allowedIds.has(row.zaloAccountId),
      );
      const removed = before - data.conversations.length;
      if (removed === 0) return payload;
      if (typeof data.total === 'number') data.total = Math.max(0, data.total - removed);
      logger.warn(`[chat-security] lọc ${removed} hội thoại ngoài phạm vi khỏi ${CONV_LIST_PATH}`);
    } else {
      // Chi tiết hội thoại của nick riêng tư → che PII + preview nội dung.
      if (data?.contact) data.contact = redactContact(data.contact);
      if ('lastMessageContent' in (data ?? {})) data.lastMessageContent = PRIVACY_BLUR_TOKEN;
      if (data?.friendship?.aliasInNick) data.friendship.aliasInNick = PRIVACY_BLUR_TOKEN;
      if (data) data.redacted = true;
    }

    const next = JSON.stringify(data);
    reply.header('content-length', Buffer.byteLength(next));
    return next;
  });

  logger.info('[chat-security] Conversation security hooks installed');
}
