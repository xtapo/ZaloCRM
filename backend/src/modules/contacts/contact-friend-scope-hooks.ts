/**
 * contact-friend-scope-hooks.ts — Guard cấp root cho luồng "Mở chat" ở mục Khách hàng
 * (2026-08-14).
 *
 * Triệu chứng: KH hiện đúng là "đã kết bạn", bấm 💬 Mở chat thì URL đổi sang /chat/:convId
 * nhưng khung chat trắng, không có thông báo lỗi nào.
 *
 * Nguyên nhân:
 *   1. `GET /api/v1/contacts/:id` trả nguyên `friends[]` (AGGREGATE_INCLUDE) mà KHÔNG lọc theo
 *      scope nick — khác với `GET /api/v1/contacts/:id/friendships` (đã lọc bằng
 *      `scope.accessibleIds`). `ContactsView.goChat()` vì thế có thể chọn đúng một nick mà
 *      user không có quyền.
 *   2. `POST /api/v1/friends/:id/ensure-conversation` chỉ kiểm tra `orgId`, không kiểm tra
 *      scope/privacyMode → vẫn tạo + trả `conversationId`, frontend điều hướng sang
 *      /chat/:convId, rồi mọi request sau đó bị chặn: `GET /conversations/:id` +
 *      `POST /conversations/:id/mark-read` (chat-security-hooks → ZALO_SCOPE_FORBIDDEN) và
 *      `GET /conversations/:id/messages` (requireZaloAccess → PRIVACY_LOCKED / 403).
 *
 * Hook này:
 *   - Chặn `ensure-conversation` NGAY với 403 + `code` rõ ràng để frontend toast được.
 *   - Lọc `friends[]` trong contact detail theo scope, và gắn `chatLocked` cho nick đang bật
 *     `privacyMode = 'main'` mà viewer không phải chính chủ (UI có thể disable nút 💬).
 *
 * Phải gọi ở root instance, TRƯỚC mọi `app.register(...)` route (xem app.ts).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { getZaloScope } from '../zalo/zalo-scope.js';
import { logActivity } from '../activity/activity-logger.js';

const ENSURE_CONVERSATION_RE = /^\/api\/v1\/friends\/([^/]+)\/ensure-conversation$/;
const CONTACT_DETAIL_RE = /^\/api\/v1\/contacts\/([^/]+)$/;
const CONTACT_FRIENDSHIPS_RE = /^\/api\/v1\/contacts\/([^/]+)\/friendships$/;

/** Segment KHÔNG phải contactId trên `/api/v1/contacts/...` */
const RESERVED_CONTACT_SEGMENTS = new Set([
  'stats',
  'search',
  'duplicates',
  'parent-candidates',
  'export',
  'import',
  'merge',
  'backfill-missing-friends',
]);

/** Cùng cờ env với zalo-access-middleware để hành vi privacy nhất quán. */
const ALLOW_ADMIN_PRIVACY_BYPASS = process.env.PRIVACY_ALLOW_ADMIN_BYPASS === 'true';

interface RequestScope {
  accessibleIds: string[];
  isOrgAdmin: boolean;
}

interface AuthUser {
  userId?: string;
  id?: string;
  orgId: string;
  role: string;
}

function pathOf(request: FastifyRequest): string {
  return (request.raw.url ?? '').split('?')[0];
}

function userIdOf(user: AuthUser): string {
  return (user.userId ?? user.id) as string;
}

/**
 * Xác thực trong hook root (chạy trước authMiddleware của route).
 * Hỗ trợ cả Bearer token và cookie `auth_token` — frontend hiện dùng cookie.
 * Không bao giờ throw: token hỏng → trả null để route tự trả 401 như cũ.
 */
async function authenticate(app: FastifyInstance, request: FastifyRequest): Promise<AuthUser | null> {
  const anyRequest = request as any;
  if (anyRequest.user?.orgId) return anyRequest.user as AuthUser;

  try {
    await anyRequest.jwtVerify();
    if (anyRequest.user?.orgId) return anyRequest.user as AuthUser;
  } catch {
    // Không có/không hợp lệ Authorization header → thử cookie bên dưới.
  }

  const token = anyRequest.cookies?.auth_token;
  if (!token) return null;
  try {
    const payload = (app as any).jwt.verify(token) as AuthUser;
    if (payload?.orgId) {
      anyRequest.user = payload;
      return payload;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Scope nick, cache theo request để không query lặp. */
async function scopeFor(request: FastifyRequest, user: AuthUser): Promise<RequestScope> {
  const anyRequest = request as any;
  if (!anyRequest.__contactFriendScope) {
    const scope = await getZaloScope(userIdOf(user), user.orgId, user.role);
    anyRequest.__contactFriendScope = {
      accessibleIds: scope.accessibleIds ?? [],
      isOrgAdmin: !!scope.isOrgAdmin,
    } as RequestScope;
  }
  return anyRequest.__contactFriendScope as RequestScope;
}

interface FilterFriendsResult {
  visible: any[];
  hidden: number;
  locked: number;
}

/**
 * Lọc danh sách friend/friendship theo scope nick và gắn cờ chatLocked cho nick riêng tư.
 */
async function filterAndLockFriends(
  friends: any[],
  user: AuthUser,
  scope: RequestScope,
): Promise<FilterFriendsResult> {
  if (!Array.isArray(friends) || friends.length === 0) {
    return { visible: friends || [], hidden: 0, locked: 0 };
  }

  const userId = userIdOf(user);
  const accountIds = Array.from(
    new Set(friends.map((f: any) => f?.zaloAccountId).filter(Boolean)),
  ) as string[];

  if (accountIds.length === 0) {
    return { visible: friends, hidden: 0, locked: 0 };
  }

  const accounts = await prisma.zaloAccount.findMany({
    where: { id: { in: accountIds }, orgId: user.orgId },
    select: { id: true, privacyMode: true, ownerUserId: true },
  });
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const allowedIds = new Set(scope.accessibleIds);

  let hidden = 0;
  let locked = 0;
  const visible: any[] = [];

  for (const friend of friends) {
    const accountId = friend?.zaloAccountId;
    if (!accountId) {
      visible.push(friend);
      continue;
    }
    const account = accountById.get(accountId);
    const isOwnerOfNick = !!account?.ownerUserId && account.ownerUserId === userId;

    if (!scope.isOrgAdmin && !allowedIds.has(accountId) && !isOwnerOfNick) {
      hidden += 1;
      continue;
    }

    const chatLocked =
      account?.privacyMode === 'main' &&
      !isOwnerOfNick &&
      !(scope.isOrgAdmin && ALLOW_ADMIN_PRIVACY_BYPASS);

    if (chatLocked) {
      locked += 1;
      visible.push({ ...friend, chatLocked: true, chatLockedReason: 'PRIVACY_LOCKED' });
    } else {
      visible.push(friend);
    }
  }

  return { visible, hidden, locked };
}

export function installContactFriendScopeHooks(app: FastifyInstance): void {
  // ── 1. Chặn ensure-conversation trên nick ngoài quyền / nick riêng tư ────────
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method !== 'POST') return;
    const path = pathOf(request);
    const match = ENSURE_CONVERSATION_RE.exec(path);
    if (!match) return;
    const friendId = match[1];

    const user = await authenticate(app, request);
    if (!user?.orgId) return;
    const userId = userIdOf(user);

    const friend = await prisma.friend.findFirst({
      where: { id: friendId },
      select: {
        id: true,
        contactId: true,
        zaloAccountId: true,
        zaloAccount: { select: { orgId: true, privacyMode: true, ownerUserId: true } },
      },
    });
    // Không tồn tại / khác org → để route trả 404 như cũ.
    if (!friend || friend.zaloAccount?.orgId !== user.orgId) return;

    const isOwnerOfNick =
      !!friend.zaloAccount.ownerUserId && friend.zaloAccount.ownerUserId === userId;
    const scope = await scopeFor(request, user);
    const inScope =
      scope.isOrgAdmin || scope.accessibleIds.includes(friend.zaloAccountId) || isOwnerOfNick;

    if (!inScope) {
      logger.warn(
        `[contact-friend-scope] chặn ensure-conversation — user=${userId} không có quyền trên nick ${friend.zaloAccountId}`,
      );
      logActivity({
        orgId: user.orgId,
        action: 'security_scope_denied',
        userId,
        entityType: 'friend',
        entityId: friend.id,
        details: { path, zaloAccountId: friend.zaloAccountId, contactId: friend.contactId },
      });
      return reply.status(403).send({
        error: 'Bạn không có quyền mở chat từ nick Zalo này',
        code: 'ZALO_SCOPE_FORBIDDEN',
      });
    }

    const privacyLocked =
      friend.zaloAccount.privacyMode === 'main' &&
      !isOwnerOfNick &&
      !(scope.isOrgAdmin && ALLOW_ADMIN_PRIVACY_BYPASS);

    if (privacyLocked) {
      logActivity({
        orgId: user.orgId,
        action: 'privacy_locked_access',
        userId,
        entityType: 'friend',
        entityId: friend.id,
        details: { path, zaloAccountId: friend.zaloAccountId, contactId: friend.contactId },
      });
      return reply.status(403).send({
        error: 'Nick này đang bật chế độ riêng tư — chỉ chính chủ mới mở được hội thoại',
        code: 'PRIVACY_LOCKED',
      });
    }
  });

  // ── 2. Lọc friends[]/friendships[] theo scope nick và gắn chatLocked ──────────
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (request.method !== 'GET') return payload;
    if (typeof payload !== 'string') return payload;
    if (reply.statusCode < 200 || reply.statusCode >= 300) return payload;

    const path = pathOf(request);
    const isFriendships = CONTACT_FRIENDSHIPS_RE.test(path);
    const isContactDetail = !isFriendships && CONTACT_DETAIL_RE.test(path);

    if (!isContactDetail && !isFriendships) return payload;

    if (isContactDetail) {
      const match = CONTACT_DETAIL_RE.exec(path);
      if (match && RESERVED_CONTACT_SEGMENTS.has(match[1])) return payload;
    }

    const user = await authenticate(app, request);
    if (!user?.orgId) return payload;
    const userId = userIdOf(user);

    let data: any;
    try {
      data = JSON.parse(payload);
    } catch {
      return payload;
    }
    if (!data || typeof data !== 'object') return payload;

    const scope = await scopeFor(request, user);

    // Endpoint GET /api/v1/contacts/:id/friendships:
    // data có thể là array hoặc { friendships: [...] }
    if (isFriendships) {
      const targetList = Array.isArray(data) ? data : data.friendships;
      if (!Array.isArray(targetList) || targetList.length === 0) return payload;

      const { visible, hidden, locked } = await filterAndLockFriends(targetList, user, scope);
      if (hidden === 0 && locked === 0) return payload;

      let nextData: any;
      if (Array.isArray(data)) {
        nextData = visible;
      } else {
        data.friendships = visible;
        nextData = data;
      }
      const next = JSON.stringify(nextData);
      reply.header('content-length', Buffer.byteLength(next));
      return next;
    }

    // Endpoint GET /api/v1/contacts/:id
    if (isContactDetail) {
      if (!Array.isArray(data?.friends) || data.friends.length === 0) return payload;

      const { visible, hidden, locked } = await filterAndLockFriends(data.friends, user, scope);
      if (hidden === 0 && locked === 0) return payload;

      data.friends = visible;
      data.friendsHiddenByScope = hidden;
      if (hidden > 0 && typeof data.childrenCount === 'number') {
        data.childrenCount = Math.max(0, data.childrenCount - hidden);
      }
      if (hidden > 0) {
        logger.debug(
          `[contact-friend-scope] ẩn ${hidden} friend ngoài phạm vi khỏi ${path} (user=${userId})`,
        );
      }

      const next = JSON.stringify(data);
      reply.header('content-length', Buffer.byteLength(next));
      return next;
    }

    return payload;
  });

  logger.info('[contact-friend-scope] Contact/friend scope hooks installed');
}
