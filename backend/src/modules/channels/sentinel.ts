/**
 * sentinel.ts — ZaloAccount placeholder per-org cho conv channel (2026-08-26).
 *
 * conversations.zalo_account_id là NOT NULL FK (52 file đang đọc nó). Conv channel
 * (provider != 'zalo') không có nick Zalo thật → trỏ sentinel row:
 *   zalo_uid = 'SENTINEL:<orgId>' — unique, idempotent.
 *
 * Code path mới LUÔN resolve account qua conv.provider/channelAccount; chỉ code legacy
 * chưa phân nhánh provider có thể chạm zaloAccount — với sentinel thì thấy
 * status='disconnected' + displayName '— Channel placeholder —', vô hại.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export const SENTINEL_PREFIX = 'SENTINEL:';

export function sentinelUidFor(orgId: string): string {
  return `${SENTINEL_PREFIX}${orgId}`;
}

/**
 * Get-or-create sentinel cho org. Cache in-process theo orgId (sentinel gần như
 * bất biến; nếu bị xóa ngoài luồng thì cache stale 5 phút — chấp nhận được vì
 * mọi write path đều gọi hàm này trước khi tạo conv).
 */
const cache = new Map<string, { id: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60_000;

export async function getOrCreateSentinelAccount(orgId: string): Promise<string> {
  const cached = cache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.id;

  const uid = sentinelUidFor(orgId);
  const existing = await prisma.zaloAccount.findUnique({
    where: { zaloUid: uid },
    select: { id: true },
  });
  if (existing) {
    cache.set(orgId, { id: existing.id, expiresAt: Date.now() + CACHE_TTL_MS });
    return existing.id;
  }

  // Owner đầu tiên của org (role='owner'), fallback user bất kỳ.
  const owner = await prisma.user.findFirst({
    where: { orgId, role: 'owner' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  }) ?? await prisma.user.findFirst({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (!owner) {
    throw new Error(`Cannot create channel sentinel for org ${orgId}: no users in org`);
  }

  const created = await prisma.zaloAccount.create({
    data: {
      id: randomUUID(),
      orgId,
      ownerUserId: owner.id,
      zaloUid: uid,
      displayName: '— Channel placeholder —',
      status: 'disconnected',
      privacyMode: 'sub',
    },
    select: { id: true },
  }).catch(async (err) => {
    // Race: org khác vừa tạo — re-query. Lỗi khác → throw tiếp.
    logger.warn('[channel-sentinel] create raced, re-querying:', err);
    const again = await prisma.zaloAccount.findUnique({ where: { zaloUid: uid }, select: { id: true } });
    if (!again) throw err;
    return again;
  });

  cache.set(orgId, { id: created.id, expiresAt: Date.now() + CACHE_TTL_MS });
  return created.id;
}
