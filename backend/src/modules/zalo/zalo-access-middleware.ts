/**
 * Zalo access middleware — kiểm tra user có đủ quyền trên một nick Zalo hay không.
 * Thang quyền: admin > chat > read.
 *
 * FIX 2026-08-13 — hết lệch giữa 2 nguồn sự thật:
 *   Trước đây middleware chỉ tra bảng `ZaloAccountAccess`, trong khi danh sách nick
 *   (`GET /zalo-accounts`) lại dựng từ `getZaloScope` (chính chủ + cascade phòng ban + grant).
 *   Hệ quả: leader/deputy thấy nick trong danh sách nhưng bấm vào là 403; nick tạo trước
 *   bản vá Bug A (thiếu row access cho owner) khiến CHÍNH CHỦ bị khoá khỏi nick của mình.
 *   Nay: scope là nguồn sự thật cho quyền `read`; `chat`/`admin` vẫn cần grant tường minh
 *   (hoặc là chính chủ nick / admin org).
 *
 * FIX 2026-08-13 — nick riêng tư:
 *   `privacyMode = 'main'` giờ chặn TẤT CẢ viewer khác chính chủ, kể cả owner/admin org.
 *   Đặt env `PRIVACY_ALLOW_ADMIN_BYPASS=true` nếu muốn giữ hành vi cũ (admin xem được).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { getZaloScope } from './zalo-scope.js';

type Permission = 'read' | 'chat' | 'admin';

const hierarchy: Record<Permission, number> = { read: 1, chat: 2, admin: 3 };

const ALLOW_ADMIN_PRIVACY_BYPASS = process.env.PRIVACY_ALLOW_ADMIN_BYPASS === 'true';

// Factory: returns a preHandler that checks the user has at least minPermission on the Zalo account
export function requireZaloAccess(minPermission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const userId = (user as any).userId ?? user.id;

    const params = request.params as Record<string, string>;
    let zaloAccountId = params.zaloAccountId || params.id;

    // If accessing via conversation, look up the Zalo account from the conversation
    if (params.id && !params.zaloAccountId) {
      try {
        const conv = await prisma.conversation.findFirst({
          where: { id: params.id, orgId: user.orgId },
          select: { zaloAccountId: true },
        });
        if (conv) zaloAccountId = conv.zaloAccountId;
      } catch {
        return reply.status(500).send({ error: 'Internal error checking access' });
      }
    }

    if (!zaloAccountId) return reply.status(404).send({ error: 'Not found' });

    try {
      const account = await prisma.zaloAccount.findFirst({
        where: { id: zaloAccountId, orgId: user.orgId },
        select: { id: true, ownerUserId: true, privacyMode: true },
      });
      if (!account) return reply.status(404).send({ error: 'Not found' });

      const isOwnerOfNick = !!account.ownerUserId && account.ownerUserId === userId;
      const isOrgAdmin = ['owner', 'admin'].includes(user.role);

      // Nick riêng tư: chỉ chính chủ mới đi tiếp (PIN unlock vẫn do lớp privacy xử lý).
      if (account.privacyMode === 'main' && !isOwnerOfNick) {
        if (!(isOrgAdmin && ALLOW_ADMIN_PRIVACY_BYPASS)) {
          logger.warn(
            `[zalo-access] chặn user=${userId} truy cập nick riêng tư ${zaloAccountId} (owner=${account.ownerUserId})`,
          );
          return reply.status(403).send({
            error: 'Nick này đang bật chế độ riêng tư — chỉ chính chủ mới truy cập được',
            code: 'PRIVACY_LOCKED',
          });
        }
      }

      // Chính chủ nick và admin org: toàn quyền trên nick (sau khi đã qua cửa riêng tư).
      if (isOwnerOfNick || isOrgAdmin) return;

      const scope = await getZaloScope(userId, user.orgId, user.role);
      const inScope = (scope.accessibleIds ?? []).includes(zaloAccountId);
      if (!inScope) {
        return reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' });
      }

      // Nằm trong scope là đủ để ĐỌC. Gửi tin / quản trị vẫn cần grant tường minh.
      if (minPermission === 'read') return;

      const access = await prisma.zaloAccountAccess.findFirst({
        where: { zaloAccountId, userId },
      });

      const userLevel = access ? hierarchy[access.permission as Permission] ?? 0 : 0;
      if (userLevel < hierarchy[minPermission]) {
        return reply.status(403).send({ error: 'Không đủ quyền' });
      }
    } catch (err) {
      logger.error('[zalo-access] error checking access:', err);
      return reply.status(500).send({ error: 'Internal error checking access' });
    }
  };
}
