/**
 * agent-gateway.ts — Phase 8 Privacy & Multi-tenant Gateway for Agent Tools
 *
 * Ràng buộc kiến trúc:
 * 1. Mọi tool của Agent đều PHẢI đi qua Gateway này để truy xuất dữ liệu (Single Enforcement Point).
 * 2. `orgId` BẮT BUỘC lấy từ AgentSession context, TUYỆT ĐỐI KHÔNG nhận từ tham số LLM sinh ra.
 * 3. Contact bị khóa PIN (gắn với ZaloAccount có privacyMode = 'main') là HOÀN TOÀN VÔ HÌNH đối với Agent:
 *    - Bị LOẠI BỎ HOÀN TOÀN khỏi kết quả (không chỉ mask/che).
 *    - Không lọt PII, không lọt content, không lọt metadata (leadScore, priorityScore, timestamps, counts).
 */
import { prisma } from '../../../shared/database/prisma-client.js';

export interface AgentSessionContext {
  /** orgId bắt buộc từ AgentSession — không tin tưởng input từ LLM */
  orgId: string;
  sessionId?: string;
  taskId?: string;
}

/**
 * Kiểm tra xem 1 hoặc nhiều contactIds có bị khóa bởi Privacy PIN hay không.
 * Contact bị coi là khóa PIN nếu có ít nhất 1 Friend row liên kết với ZaloAccount có `privacyMode = 'main'`.
 * Vì Agent là worker tự động chạy nền, Agent không sở hữu PIN session và không được xem contact riêng tư.
 */
export async function getAgentLockedContactIds(
  contactIds: string[],
  orgId: string,
): Promise<Set<string>> {
  if (!contactIds || contactIds.length === 0 || !orgId) {
    return new Set();
  }

  const lockedFriends = await prisma.friend.findMany({
    where: {
      orgId,
      contactId: { in: contactIds },
      zaloAccount: {
        orgId,
        privacyMode: 'main',
      },
    },
    select: { contactId: true },
  });

  return new Set(lockedFriends.map((f) => f.contactId).filter((id): id is string => !!id));
}

/**
 * Lấy chi tiết 1 Contact an toàn cho Agent.
 * - Trả về null nếu contact không tồn tại hoặc khác orgId (Multi-tenant check).
 * - Trả về null (loại bỏ hoàn toàn) nếu contact bị khóa PIN (Privacy PIN check).
 */
export async function getSafeContactForAgent(
  contactId: string,
  ctx: AgentSessionContext,
) {
  if (!contactId || !ctx?.orgId) return null;

  // 1. Kiểm tra khóa PIN trước (Fail-closed)
  const lockedIds = await getAgentLockedContactIds([contactId], ctx.orgId);
  if (lockedIds.has(contactId)) {
    return null; // Vô hình hoàn toàn với agent
  }

  // 2. Query Contact kèm tenant scoping
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      orgId: ctx.orgId,
    },
    include: {
      friends: {
        where: { orgId: ctx.orgId },
        select: {
          id: true,
          zaloDisplayName: true,
          zaloAvatarUrl: true,
          zaloGlobalId: true,
          zaloUsername: true,
          aliasInNick: true,
          crmTagsPerNick: true,
          friendshipStatus: true,
          becameFriendAt: true,
        },
      },
    },
  });

  return contact;
}

/**
 * Tìm kiếm danh sách Contact an toàn cho Agent.
 * Tự động lọc bỏ toàn bộ contact khác org và contact bị khóa Privacy PIN.
 */
export async function findSafeContactsForAgent(
  params: {
    query?: string;
    phoneNormalized?: string;
    zaloGlobalId?: string;
    limit?: number;
  },
  ctx: AgentSessionContext,
) {
  if (!ctx?.orgId) return [];

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

  const whereConditions: any = {
    orgId: ctx.orgId,
  };

  if (params.phoneNormalized) {
    whereConditions.phoneNormalized = params.phoneNormalized;
  } else if (params.zaloGlobalId) {
    whereConditions.zaloGlobalId = params.zaloGlobalId;
  } else if (params.query) {
    whereConditions.OR = [
      { fullName: { contains: params.query, mode: 'insensitive' } },
      { phone: { contains: params.query } },
      { zaloUsername: { contains: params.query, mode: 'insensitive' } },
    ];
  }

  const rawContacts = await prisma.contact.findMany({
    where: whereConditions,
    take: limit * 2, // Lấy dư để trừ hao contact bị lọc PIN
    orderBy: { updatedAt: 'desc' },
  });

  if (rawContacts.length === 0) return [];

  // Lọc Privacy PIN
  const contactIds = rawContacts.map((c) => c.id);
  const lockedIds = await getAgentLockedContactIds(contactIds, ctx.orgId);

  // Chỉ giữ lại contact không bị khóa PIN
  const visible = rawContacts.filter((c) => !lockedIds.has(c.id));
  return visible.slice(0, limit);
}

/**
 * Đọc lịch sử tin nhắn an toàn cho Agent.
 * Nếu cuộc hội thoại hoặc contact liên quan thuộc tài khoản riêng tư (`privacyMode = 'main'`),
 * trả về danh sách rỗng `[]`.
 */
export async function getSafeMessagesForAgent(
  params: {
    conversationId?: string;
    contactId?: string;
    limit?: number;
  },
  ctx: AgentSessionContext,
) {
  if (!ctx?.orgId) return [];

  // 1. Nếu có contactId, kiểm tra PIN trước
  if (params.contactId) {
    const locked = await getAgentLockedContactIds([params.contactId], ctx.orgId);
    if (locked.has(params.contactId)) {
      return [];
    }
  }

  // 2. Nếu có conversationId, kiểm tra conversation thuộc account main hay không
  if (params.conversationId) {
    const conv = await prisma.conversation.findFirst({
      where: {
        id: params.conversationId,
        orgId: ctx.orgId,
      },
      include: {
        zaloAccount: {
          select: { privacyMode: true },
        },
      },
    });

    if (!conv || conv.zaloAccount?.privacyMode === 'main') {
      return []; // Vô hình với agent
    }
  }

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  return prisma.message.findMany({
    where: {
      orgId: ctx.orgId,
      ...(params.conversationId ? { conversationId: params.conversationId } : {}),
      ...(params.contactId ? { contactId: params.contactId } : {}),
      isDeleted: false,
    },
    orderBy: { sentAt: 'asc' },
    take: limit,
  });
}
