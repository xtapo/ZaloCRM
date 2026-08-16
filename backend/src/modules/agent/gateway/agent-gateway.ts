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
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/database/prisma-client.js';
import { PRIVACY_MODE_MAIN } from '../../privacy/redact.js';

export interface AgentSessionContext {
  /** orgId bắt buộc từ AgentSession — không tin tưởng input từ LLM */
  orgId: string;
  sessionId?: string;
  taskId?: string;
}

/**
 * Allow-list tường minh các trường Contact an toàn cho Agent.
 * Loại bỏ hoàn toàn nội dung tin nhắn preview, ghi chú, và toàn bộ dữ liệu nhân khẩu học nhạy cảm.
 */
export const SAFE_CONTACT_SELECT = {
  id: true,
  orgId: true,
  fullName: true,
  crmName: true,
  phone: true,
  phoneNormalized: true,
  email: true,
  zaloUid: true,
  zaloGlobalId: true,
  zaloUsername: true,
  avatarUrl: true,
  source: true,
  sourceDate: true,
  firstContactDate: true,
  status: true,
  statusId: true,
  nextAppointment: true,
  assignedUserId: true,
  tags: true,
  leadScore: true,
  priorityScore: true,
  engagementScore: true,
  engagementPattern: true,
  engagementTrend: true,
  lastActivity: true,
  hasZalo: true,
  consentStatus: true,
  mergedInto: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ContactSelect;

export const SAFE_FRIEND_SELECT = {
  id: true,
  zaloDisplayName: true,
  zaloAvatarUrl: true,
  zaloGlobalId: true,
  zaloUsername: true,
  aliasInNick: true,
  crmTagsPerNick: true,
  friendshipStatus: true,
  becameFriendAt: true,
} as const satisfies Prisma.FriendSelect;


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
        privacyMode: PRIVACY_MODE_MAIN,
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

  // Query Contact kèm tenant scoping, loại bỏ contact bị khóa PIN và áp dụng allow-list select
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      orgId: ctx.orgId,
      friends: {
        none: {
          zaloAccount: {
            privacyMode: PRIVACY_MODE_MAIN,
          },
        },
      },
    },
    select: {
      ...SAFE_CONTACT_SELECT,
      friends: {
        where: { orgId: ctx.orgId },
        select: SAFE_FRIEND_SELECT,
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

  const whereConditions: Prisma.ContactWhereInput = {
    orgId: ctx.orgId,
    friends: {
      none: {
        zaloAccount: {
          privacyMode: PRIVACY_MODE_MAIN,
        },
      },
    },
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

  return prisma.contact.findMany({
    where: whereConditions,
    select: SAFE_CONTACT_SELECT,
    take: limit,
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Đọc lịch sử tin nhắn an toàn cho Agent.
 * Bắt buộc phải có ít nhất conversationId hoặc contactId (fail-closed).
 * Tự động loại trừ tin nhắn thuộc các cuộc hội thoại gắn với tài khoản riêng tư (`privacyMode = 'main'`).
 * Trả về `limit` tin nhắn MỚI NHẤT theo thứ tự thời gian tăng dần.
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

  // Lỗi 1: Bắt buộc phải có ít nhất một trong conversationId hoặc contactId. Không có thì throw.
  if (!params.conversationId && !params.contactId) {
    throw new Error('Either conversationId or contactId is required for getSafeMessagesForAgent');
  }

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  // Lỗi 1 & Lỗi 2: Query messages loại trừ tài khoản riêng tư ngay trong DB query,
  // lấy `limit` tin nhắn mới nhất (sentAt: 'desc'), rồi reverse để giữ thứ tự thời gian tăng dần.
  const rawMessages = await prisma.message.findMany({
    where: {
      conversation: {
        orgId: ctx.orgId,
        ...(params.conversationId ? { id: params.conversationId } : {}),
        ...(params.contactId ? { contactId: params.contactId } : {}),
        zaloAccount: {
          orgId: ctx.orgId,
          privacyMode: { not: PRIVACY_MODE_MAIN },
        },
      },
      isDeleted: false,
    },
    orderBy: { sentAt: 'desc' },
    take: limit,
  });

  return [...rawMessages].reverse();
}
