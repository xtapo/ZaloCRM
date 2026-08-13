/**
 * socket-privacy.ts — Realtime privacy guard cho Socket.IO (2026-08-13).
 *
 * VẤN ĐỀ TRƯỚC FIX
 *   chat-routes.ts và zalo-listener-factory.ts gọi `io.emit('chat:message', { message, _privacyMeta })`
 *   → broadcast TOÀN CỤC tới mọi socket đang kết nối, kèm nội dung tin nhắn GỐC chưa redact.
 *   Việc blur bị phó mặc cho frontend đọc `_privacyMeta`, nên chỉ cần mở DevTools (hoặc một
 *   socket client tự viết) là đọc được toàn bộ tin nhắn của nick người khác.
 *
 * SAU FIX
 *   - `io.emit` và `io.to(...).emit` được bọc lại. Các event nhạy cảm được giao TỪNG SOCKET
 *     sau khi kiểm tra: cùng org → có quyền trên nick (getZaloScope) → privacyMode của nick.
 *   - Nick `privacyMode = 'main'`: chỉ chính chủ (ownerUserId) nhận nội dung thật; mọi viewer
 *     khác — kể cả admin org — nhận bản đã redact ở SERVER.
 *   - Socket chưa xác thực (client cũ chưa gửi token/cookie) chỉ nhận bản đã redact.
 *   - `_privacyMeta` không bao giờ rời server nữa.
 *
 * Danh tính socket lấy từ (theo thứ tự): handshake.auth.token → handshake.query.token →
 * header Authorization → cookie `crm_session` (được chat-security-hooks.ts set tự động).
 */
import type { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { prisma } from '../database/prisma-client.js';
import { logger } from '../utils/logger.js';
import { getZaloScope } from '../../modules/zalo/zalo-scope.js';
import { redactMessage } from '../../modules/privacy/redact.js';

export interface SocketUser {
  id: string;
  orgId: string;
  role: string;
  tokenVersion: number;
}

/** Event mang nội dung tin nhắn — viewer không đủ quyền vẫn nhận nhưng ĐÃ redact. */
const CONTENT_EVENTS = new Set<string>(['chat:message']);

/** Event chỉ chứa metadata — bỏ qua nếu viewer đã đăng nhập mà không có quyền trên nick. */
const SCOPED_EVENTS = new Set<string>([
  'chat:deleted',
  'zalo:typing',
  'zalo:message-status',
]);

/** Event nhạy cảm ngang credential (QR đăng nhập) — socket ẩn danh bị chặn hoàn toàn. */
const RESTRICTED_EVENTS = new Set<string>(['zalo:qr', 'zalo:login-success']);

const GUARDED_EVENTS = new Set<string>([
  ...Array.from(CONTENT_EVENTS),
  ...Array.from(SCOPED_EVENTS),
  ...Array.from(RESTRICTED_EVENTS),
]);

const SESSION_COOKIE = 'crm_session';
const CACHE_TTL_MS = 30_000;

interface CachedScope {
  at: number;
  accessibleIds: Set<string>;
  isOrgAdmin: boolean;
}

interface CachedAccount {
  at: number;
  orgId: string | null;
  privacyMode: string | null;
  ownerUserId: string | null;
}

const scopeCache = new Map<string, CachedScope>();
const accountCache = new Map<string, CachedAccount>();

interface CachedUser {
  at: number;
  isActive: boolean;
  orgId: string | null;
  tokenVersion: number;
}
const userCache = new Map<string, CachedUser>();

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function extractToken(socket: Socket): string | null {
  const handshake: any = socket.handshake || {};
  const fromAuth = handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth) return fromAuth.replace(/^Bearer\s+/i, '');

  const fromQuery = handshake.query?.token;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery.replace(/^Bearer\s+/i, '');

  const authHeader = handshake.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const cookies = parseCookieHeader(handshake.headers?.cookie);
  return cookies['auth_token'] || cookies[SESSION_COOKIE] || null;
}

function resolveSocketUser(socket: Socket): SocketUser | null {
  const token = extractToken(socket);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret) as Record<string, any>;
    const id = String(payload.userId ?? payload.id ?? '');
    const orgId = String(payload.orgId ?? '');
    const tokenVersion = Number(payload.tokenVersion ?? 0);
    if (!id || !orgId) return null;
    return { id, orgId, role: String(payload.role ?? 'member'), tokenVersion };
  } catch {
    return null;
  }
}

async function loadScope(user: SocketUser): Promise<CachedScope> {
  const key = `${user.id}:${user.orgId}`;
  const cached = scopeCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;

  const scope = await getZaloScope(user.id, user.orgId, user.role);
  const entry: CachedScope = {
    at: Date.now(),
    accessibleIds: new Set(scope.accessibleIds ?? []),
    isOrgAdmin: !!scope.isOrgAdmin,
  };
  scopeCache.set(key, entry);
  return entry;
}

async function loadAccount(accountId: string): Promise<CachedAccount> {
  const cached = accountCache.get(accountId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;

  const account = await prisma.zaloAccount.findUnique({
    where: { id: accountId },
    select: { orgId: true, privacyMode: true, ownerUserId: true },
  });
  const entry: CachedAccount = {
    at: Date.now(),
    orgId: account?.orgId ?? null,
    privacyMode: account?.privacyMode ?? null,
    ownerUserId: account?.ownerUserId ?? null,
  };
  accountCache.set(accountId, entry);
  return entry;
}

/** Xoá cache khi phân quyền / privacyMode vừa đổi (gọi từ route grant access hoặc toggle privacy). */
export function invalidateSocketPrivacyCache(input: { userId?: string; accountId?: string } = {}): void {
  if (input.accountId) accountCache.delete(input.accountId);
  if (input.userId) {
    userCache.delete(input.userId);
    for (const key of Array.from(scopeCache.keys())) {
      if (key.startsWith(`${input.userId}:`)) scopeCache.delete(key);
    }
  }
  if (!input.userId && !input.accountId) {
    scopeCache.clear();
    accountCache.clear();
    userCache.clear();
  }
}

function redactPayload(payload: any): any {
  if (!payload || typeof payload !== 'object' || !payload.message) return payload;
  try {
    const forcedPrivate = { zaloAccount: { privacyMode: 'main', ownerUserId: '__no-viewer__' } };
    const redacted = redactMessage(payload.message, forcedPrivate as any, {
      viewerUserId: null,
      orgId: null,
      privacyUnlocked: false,
    } as any);
    return { ...payload, message: redacted, redacted: true };
  } catch (err) {
    logger.warn('[socket-privacy] redact failed, dropping payload', err);
    return null;
  }
}

type EmittableSocket = { data?: any; emit: (event: string, ...args: any[]) => unknown };

async function deliverGuarded(event: string, rawPayload: any, sockets: EmittableSocket[]): Promise<void> {
  const payload = rawPayload && typeof rawPayload === 'object' ? { ...rawPayload } : rawPayload;
  const meta = payload && typeof payload === 'object' ? payload._privacyMeta : undefined;
  if (payload && typeof payload === 'object') delete payload._privacyMeta;

  const accountId: string | null =
    payload && typeof payload === 'object' && typeof payload.accountId === 'string'
      ? payload.accountId
      : null;

  const account = accountId ? await loadAccount(accountId) : null;
  const privacyMode = meta?.privacyMode ?? account?.privacyMode ?? null;
  const ownerUserId = meta?.ownerUserId ?? account?.ownerUserId ?? null;
  const accountOrgId = account?.orgId ?? null;

  const isContent = CONTENT_EVENTS.has(event);
  const isRestricted = RESTRICTED_EVENTS.has(event);
  const redacted = isContent ? redactPayload(payload) : null;

  for (const socket of sockets) {
    const user: SocketUser | null = socket.data?.user ?? null;

    // Socket chưa xác thực (client cũ): không bao giờ nhận nội dung thật.
    if (!user) {
      if (isRestricted) continue;
      if (isContent) {
        if (redacted) socket.emit(event, redacted);
        continue;
      }
      socket.emit(event, payload);
      continue;
    }

    if (accountOrgId && user.orgId !== accountOrgId) continue;

    if (accountId) {
      const scope = await loadScope(user);
      const allowed =
        scope.isOrgAdmin || scope.accessibleIds.has(accountId) || ownerUserId === user.id;
      if (!allowed) continue;
    }

    // Nick riêng tư: chỉ chính chủ thấy nội dung, kể cả admin org.
    if (isContent && privacyMode === 'main' && ownerUserId !== user.id) {
      if (redacted) socket.emit(event, redacted);
      continue;
    }

    socket.emit(event, payload);
  }
}

/**
 * Bọc Socket.IO server để mọi broadcast nhạy cảm đi qua kiểm tra quyền + privacy.
 * Gọi MỘT LẦN trong app.ts, ngay sau khi tạo `io` và trước khi bất kỳ listener nào emit.
 */
export function installSocketPrivacyGuard(io: Server): void {
  if ((io as any).__privacyGuardInstalled) return;
  (io as any).__privacyGuardInstalled = true;

  // Nhận diện viewer ở handshake. KHÔNG reject socket ẩn danh để không làm vỡ client cũ —
  // họ chỉ nhận payload đã redact.
  io.use(async (socket, next) => {
    try {
      const user = resolveSocketUser(socket);
      if (user) {
        let cached = userCache.get(user.id);
        if (!cached || Date.now() - cached.at > CACHE_TTL_MS) {
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { isActive: true, orgId: true, tokenVersion: true },
          });
          cached = {
            at: Date.now(),
            isActive: !!dbUser?.isActive,
            orgId: dbUser?.orgId ?? null,
            tokenVersion: dbUser?.tokenVersion ?? 0,
          };
          userCache.set(user.id, cached);
        }
        
        if (!cached.isActive || cached.orgId !== user.orgId || cached.tokenVersion !== user.tokenVersion) {
          socket.data.user = null;
        } else {
          socket.data.user = user;
        }
      } else {
        socket.data.user = null;
      }
    } catch {
      socket.data.user = null;
    }
    next();
  });

  const originalEmit = io.emit.bind(io);
  (io as any).emit = (event: string, ...args: any[]) => {
    if (!GUARDED_EVENTS.has(event)) return (originalEmit as any)(event, ...args);
    void deliverGuarded(event, args[0], Array.from(io.sockets.sockets.values())).catch((err) => {
      logger.error(`[socket-privacy] deliver '${event}' failed:`, err);
    });
    return true;
  };

  const patchOperator = (operator: any) => {
    if (!operator || operator.__privacyPatched) return operator;
    operator.__privacyPatched = true;
    const operatorEmit = operator.emit.bind(operator);
    operator.emit = (event: string, ...args: any[]) => {
      if (!GUARDED_EVENTS.has(event)) return operatorEmit(event, ...args);
      void (async () => {
        const sockets = await operator.fetchSockets();
        await deliverGuarded(event, args[0], sockets as EmittableSocket[]);
      })().catch((err: unknown) => {
        logger.error(`[socket-privacy] room deliver '${event}' failed:`, err);
      });
      return true;
    };
    return operator;
  };

  const originalTo = io.to.bind(io);
  (io as any).to = (room: any) => patchOperator(originalTo(room));

  const originalIn = io.in.bind(io);
  (io as any).in = (room: any) => patchOperator(originalIn(room));

  logger.info('[socket-privacy] Realtime privacy guard installed');
}
