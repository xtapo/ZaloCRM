/**
 * group-crm-routes.ts — CRM metadata, stats, and assignment for Zalo groups.
 * Routes: /api/v1/zalo-accounts/:accountId/groups
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { resolveAccount, checkAccess, handleError } from './zalo-route-helpers.js';
import { logActivity } from '../activity/activity-logger.js';

// ─── Types ────────────────────────────────────────────────────────────────

interface CrmProfilePayload {
  crmName?: string | null;
  notes?: string | null;
  tags?: string[];
  assignedUserId?: string | null;
}

// ─── Route registration ──────────────────────────────────────────────────

export async function groupCrmRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  const BASE = '/api/v1/zalo-accounts/:accountId/groups';

  // ─── 1. Lấy tất cả CRM profiles cho một account ─────────────────────
  app.get<{ Params: { accountId: string }; Querystring: { assignedUserId?: string } }>(
    `${BASE}/crm-profiles`,
    async (request, reply) => {
      const { accountId } = request.params;
      const { assignedUserId } = request.query;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'read'))) return;

        const where: Record<string, unknown> = { zaloAccountId: accountId };
        if (assignedUserId === 'none') {
          where.assignedUserId = null;
        } else if (assignedUserId && assignedUserId !== 'all') {
          where.assignedUserId = assignedUserId;
        }

        const profiles = await prisma.groupCrmProfile.findMany({
          where,
          select: {
            id: true,
            externalGroupId: true,
            crmName: true,
            notes: true,
            tags: true,
            assignedUserId: true,
            updatedAt: true,
          },
        });
        return reply.send({ profiles });
      } catch (err) {
        return handleError(reply, err, 'getCrmProfiles');
      }
    },
  );

  // ─── 2. Lấy profile của một nhóm cụ thể ─────────────────────────────
  app.get<{ Params: { accountId: string; groupId: string } }>(
    `${BASE}/:groupId/crm-profile`,
    async (request, reply) => {
      const { accountId, groupId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'read'))) return;

        const profile = await prisma.groupCrmProfile.findUnique({
          where: {
            zaloAccountId_externalGroupId: {
              zaloAccountId: accountId,
              externalGroupId: groupId,
            },
          },
          select: {
            id: true,
            externalGroupId: true,
            crmName: true,
            notes: true,
            tags: true,
            assignedUserId: true,
            updatedAt: true,
          },
        });
        return reply.send({ profile: profile ?? null });
      } catch (err) {
        return handleError(reply, err, 'getCrmProfile');
      }
    },
  );

  // ─── 3. Upsert CRM profile ───────────────────────────────────────────
  app.put<{ Params: { accountId: string; groupId: string }; Body: CrmProfilePayload }>(
    `${BASE}/:groupId/crm-profile`,
    async (request, reply) => {
      const { accountId, groupId } = request.params;
      const payload = request.body ?? {};
      const user = request.user!;

      try {
        await resolveAccount(accountId, user.orgId);
        if (!(await checkAccess(request, reply, accountId, 'admin'))) return;

        if (payload.tags !== undefined && !Array.isArray(payload.tags)) {
          return reply.status(400).send({ error: 'tags must be an array of strings' });
        }
        // Chỉ cho phép field đã khai báo — tránh mass-assignment
        const allowedFields = ['crmName', 'notes', 'tags', 'assignedUserId'] as const;
        const updatedFields = allowedFields.filter(f => payload[f] !== undefined);
        if (updatedFields.length === 0) {
          return reply.status(400).send({ error: 'No valid fields to update' });
        }

        // Validate assignedUserId thuộc cùng org
        if (payload.assignedUserId) {
          const targetUser = await prisma.user.findFirst({
            where: { id: payload.assignedUserId, orgId: user.orgId, isActive: true },
            select: { id: true },
          });
          if (!targetUser) {
            return reply.status(400).send({ error: 'assignedUserId phải là user hợp lệ trong org' });
          }
        }

        const data: Record<string, unknown> = {
          orgId: user.orgId,
          zaloAccountId: accountId,
          externalGroupId: groupId,
        };
        for (const f of updatedFields) data[f] = payload[f];

        const profile = await prisma.groupCrmProfile.upsert({
          where: {
            zaloAccountId_externalGroupId: {
              zaloAccountId: accountId,
              externalGroupId: groupId,
            },
          },
          create: data as never,
          update: data as never,
          select: {
            id: true,
            externalGroupId: true,
            crmName: true,
            notes: true,
            tags: true,
            assignedUserId: true,
            updatedAt: true,
          },
        });

        // Fire-and-forget activity log — đổi người phụ trách log riêng cho rõ
        if (updatedFields.includes('assignedUserId')) {
          logActivity({
            orgId: user.orgId,
            userId: user.id,
            action: 'group_assign_owner',
            entityType: 'group_crm_profile',
            entityId: profile.id,
            details: { externalGroupId: groupId, assignedUserId: profile.assignedUserId },
          });
        }
        if (updatedFields.some(f => f !== 'assignedUserId')) {
          logActivity({
            orgId: user.orgId,
            userId: user.id,
            action: 'group_update_profile',
            entityType: 'group_crm_profile',
            entityId: profile.id,
            details: { externalGroupId: groupId, fields: updatedFields.filter(f => f !== 'assignedUserId') },
          });
        }

        return reply.send({ profile });
      } catch (err) {
        return handleError(reply, err, 'upsertCrmProfile');
      }
    },
  );

  // ─── 4. Thống kê tổng quan toàn bộ nhóm của account ─────────────────
  app.get<{ Params: { accountId: string } }>(`${BASE}/stats`, async (request, reply) => {
    const { accountId } = request.params;
    const user = request.user!;
    try {
      await resolveAccount(accountId, user.orgId);
      if (!(await checkAccess(request, reply, accountId, 'read'))) return;

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const groupConvs = await prisma.conversation.findMany({
        where: { zaloAccountId: accountId, threadType: 'group' },
        select: {
          id: true,
          externalThreadId: true,
          groupName: true,
          groupAvatarUrl: true,
          groupMembersCount: true,
          lastMessageAt: true,
          unreadCount: true,
          isReplied: true,
        },
      });
      const convIds = groupConvs.map(c => c.id);

      const profiles = await prisma.groupCrmProfile.findMany({
        where: { zaloAccountId: accountId },
        select: { externalGroupId: true, crmName: true, notes: true, tags: true, assignedUserId: true },
      });
      const profileMap = new Map(profiles.map(p => [p.externalGroupId, p]));

      if (convIds.length === 0) return reply.send({ stats: [] });

      const [counts7d, counts30d] = await Promise.all([
        prisma.message.groupBy({
          by: ['conversationId'],
          where: { conversationId: { in: convIds }, sentAt: { gte: sevenDaysAgo } },
          _count: { id: true },
        }),
        prisma.message.groupBy({
          by: ['conversationId'],
          where: { conversationId: { in: convIds }, sentAt: { gte: thirtyDaysAgo } },
          _count: { id: true },
        }),
      ]);
      const map7d = new Map(counts7d.map(r => [r.conversationId, r._count.id]));
      const map30d = new Map(counts30d.map(r => [r.conversationId, r._count.id]));

      // Thành viên hoạt động + top senders — 1 query duy nhất, gom ở app layer
      const memberRows = await prisma.message.groupBy({
        by: ['conversationId', 'senderUid', 'senderName'],
        where: {
          conversationId: { in: convIds },
          sentAt: { gte: thirtyDaysAgo },
          senderType: 'contact',
          senderUid: { not: null },
        },
        _count: { id: true },
      });

      const perConvMembers = new Map<string, { uid: string; name: string; count: number }[]>();
      for (const row of memberRows) {
        const list = perConvMembers.get(row.conversationId) ?? [];
        list.push({ uid: row.senderUid!, name: row.senderName || 'Unknown', count: row._count.id });
        perConvMembers.set(row.conversationId, list);
      }

      const stats = groupConvs.map(conv => {
        const profile = profileMap.get(conv.externalThreadId ?? '');
        const members = (perConvMembers.get(conv.id) ?? [])
          .sort((a, b) => b.count - a.count);
        const lastActive = conv.lastMessageAt;
        const idleMs = lastActive ? Date.now() - lastActive.getTime() : Infinity;
        const status = idleMs < 3 * 24 * 60 * 60 * 1000 ? 'active'
          : idleMs < 14 * 24 * 60 * 60 * 1000 ? 'quiet'
          : 'silent';

        return {
          groupId: conv.externalThreadId,
          groupName: conv.groupName,
          groupAvatarUrl: conv.groupAvatarUrl,
          membersCount: conv.groupMembersCount ?? 0,
          lastMessageAt: conv.lastMessageAt,
          unreadCount: conv.unreadCount,
          isReplied: conv.isReplied,
          crmName: profile?.crmName ?? null,
          notes: profile?.notes ?? null,
          tags: profile?.tags ?? [],
          assignedUserId: profile?.assignedUserId ?? null,
          messages7d: map7d.get(conv.id) ?? 0,
          messages30d: map30d.get(conv.id) ?? 0,
          activeMembers30d: members.length,
          topSenders30d: members.slice(0, 5),
          status,
        };
      });

      return reply.send({ stats });
    } catch (err) {
      return handleError(reply, err, 'getGroupStats');
    }
  });

  // ─── 5. Thống kê chi tiết 1 nhóm (daily chart + top senders đầy đủ) ──
  app.get<{ Params: { accountId: string; groupId: string } }>(
    `${BASE}/:groupId/stats`,
    async (request, reply) => {
      const { accountId, groupId } = request.params;
      const user = request.user!;
      try {
        await resolveAccount(accountId, user.orgId);
        if (!(await checkAccess(request, reply, accountId, 'read'))) return;

        const conv = await prisma.conversation.findFirst({
          where: { zaloAccountId: accountId, externalThreadId: groupId, threadType: 'group' },
          select: {
            id: true,
            externalThreadId: true,
            groupName: true,
            groupAvatarUrl: true,
            groupMembersCount: true,
            lastMessageAt: true,
            unreadCount: true,
            isReplied: true,
          },
        });
        if (!conv) return reply.status(404).send({ error: 'Không tìm thấy hội thoại nhóm' });

        const [profile, dailyRaw, topSenders] = await Promise.all([
          prisma.groupCrmProfile.findUnique({
            where: {
              zaloAccountId_externalGroupId: {
                zaloAccountId: accountId,
                externalGroupId: groupId,
              },
            },
            select: { crmName: true, notes: true, tags: true, assignedUserId: true },
          }),
          prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
            SELECT DATE(sent_at AT TIME ZONE 'UTC') AS day, COUNT(*) AS count
            FROM messages
            WHERE conversation_id = ${conv.id}
              AND sent_at >= NOW() - INTERVAL '14 days'
            GROUP BY 1 ORDER BY 1 ASC
          `,
          prisma.message.groupBy({
            by: ['senderUid', 'senderName'],
            where: {
              conversationId: conv.id,
              sentAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              senderType: 'contact',
              senderUid: { not: null },
            },
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 10,
          }),
        ]);

        return reply.send({
          stats: {
            groupId: conv.externalThreadId,
            groupName: conv.groupName,
            groupAvatarUrl: conv.groupAvatarUrl,
            membersCount: conv.groupMembersCount ?? 0,
            lastMessageAt: conv.lastMessageAt,
            unreadCount: conv.unreadCount,
            isReplied: conv.isReplied,
            crmName: profile?.crmName ?? null,
            notes: profile?.notes ?? null,
            tags: profile?.tags ?? [],
            assignedUserId: profile?.assignedUserId ?? null,
            dailyActivity: dailyRaw.map(d => ({ date: d.day, count: Number(d.count) })),
            topSenders: topSenders.map(s => ({
              senderUid: s.senderUid,
              senderName: s.senderName || 'Unknown',
              count: s._count.id,
            })),
          },
        });
      } catch (err) {
        return handleError(reply, err, 'getGroupDetailStats');
      }
    },
  );
}
