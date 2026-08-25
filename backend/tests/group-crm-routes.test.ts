/**
 * group-crm-routes.test.ts — Integration tests for group CRM profiles & stats.
 * Covers all handlers in group-crm-routes.ts via Fastify inject().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { mockUser } from './test-helpers.js';

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    zaloAccount: { findFirst: vi.fn() },
    zaloAccountAccess: { findFirst: vi.fn() },
    groupCrmProfile: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    user: { findFirst: vi.fn() },
    conversation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    message: {
      groupBy: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = mockUser(); },
}));
vi.mock('../src/modules/activity/activity-logger.js', () => ({
  logActivity: vi.fn(),
}));
vi.mock('../src/modules/zalo/zalo-route-helpers.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue({ id: 'za-1', orgId: 'org-1' }),
  checkAccess: vi.fn().mockResolvedValue(true),
  handleError: vi.fn().mockImplementation((reply: any, err: any, _op: string) => {
    reply.status(500).send({ error: err?.message ?? 'Error' });
  }),
}));

const { prisma } = await import('../src/shared/database/prisma-client.js');
const { logActivity } = await import('../src/modules/activity/activity-logger.js');
const { checkAccess } = await import('../src/modules/zalo/zalo-route-helpers.js');
const { groupCrmRoutes } = await import('../src/modules/zalo/group-crm-routes.js');

const BASE = '/api/v1/zalo-accounts/za-1/groups';

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(groupCrmRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // checkAccess default allow
  (checkAccess as any).mockResolvedValue(true);
});

// ─── GET /crm-profiles ────────────────────────────────────────────────────────
describe('GET .../crm-profiles', () => {
  it('returns all profiles for account', async () => {
    (prisma.groupCrmProfile.findMany as any).mockResolvedValueOnce([
      { id: 'p1', externalGroupId: 'g1', crmName: 'Nhóm MKT', notes: null, tags: ['mkt'], assignedUserId: null, updatedAt: new Date() },
    ]);
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/crm-profiles` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0]).toMatchObject({ crmName: 'Nhóm MKT' });
    // No filter → where only scoped by account
    expect(prisma.groupCrmProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { zaloAccountId: 'za-1' } }),
    );
  });

  it('filters by assignedUserId when provided', async () => {
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/crm-profiles?assignedUserId=user-9` });
    expect(res.statusCode).toBe(200);
    expect(prisma.groupCrmProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { zaloAccountId: 'za-1', assignedUserId: 'user-9' } }),
    );
  });

  it("'none' filters unassigned groups", async () => {
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/crm-profiles?assignedUserId=none` });
    expect(res.statusCode).toBe(200);
    expect(prisma.groupCrmProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { zaloAccountId: 'za-1', assignedUserId: null } }),
    );
  });

  it("'all' skips assignment filter", async () => {
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/crm-profiles?assignedUserId=all` });
    expect(res.statusCode).toBe(200);
    expect(prisma.groupCrmProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { zaloAccountId: 'za-1' } }),
    );
  });

  it('returns empty list when no profiles', async () => {
    (prisma.groupCrmProfile.findMany as any).mockResolvedValueOnce([]);
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/crm-profiles` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ profiles: [] });
  });
});

// ─── GET /:groupId/crm-profile ────────────────────────────────────────────────
describe('GET .../:groupId/crm-profile', () => {
  it('returns profile when exists', async () => {
    (prisma.groupCrmProfile.findUnique as any).mockResolvedValueOnce({
      id: 'p1', externalGroupId: 'g1', crmName: 'Sales', notes: 'note', tags: [], assignedUserId: 'u2', updatedAt: new Date(),
    });
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/g1/crm-profile` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ profile: { crmName: 'Sales' } });
    expect(prisma.groupCrmProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { zaloAccountId_externalGroupId: { zaloAccountId: 'za-1', externalGroupId: 'g1' } },
      }),
    );
  });

  it('returns null profile when not found', async () => {
    (prisma.groupCrmProfile.findUnique as any).mockResolvedValueOnce(null);
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/g404/crm-profile` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ profile: null });
  });
});

// ─── PUT /:groupId/crm-profile ────────────────────────────────────────────────
describe('PUT .../:groupId/crm-profile', () => {
  it('happy path — upserts and logs activity', async () => {
    (prisma.user.findFirst as any).mockResolvedValueOnce({ id: 'u2' });
    (prisma.groupCrmProfile.upsert as any).mockResolvedValueOnce({
      id: 'p1', externalGroupId: 'g1', crmName: 'New name', notes: null, tags: ['a'], assignedUserId: 'u2', updatedAt: new Date(),
    });
    const res = await buildApp().inject({
      method: 'PUT', url: `${BASE}/g1/crm-profile`,
      payload: { crmName: 'New name', tags: ['a'], assignedUserId: 'u2' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ profile: { crmName: 'New name' } });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'group_assign_owner' }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'group_update_profile' }),
    );
  });

  it('rejects non-array tags with 400', async () => {
    const res = await buildApp().inject({
      method: 'PUT', url: `${BASE}/g1/crm-profile`,
      payload: { tags: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'tags must be an array of strings' });
  });

  it('rejects payload without valid fields with 400', async () => {
    const res = await buildApp().inject({
      method: 'PUT', url: `${BASE}/g1/crm-profile`,
      payload: { evilField: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'No valid fields to update' });
  });

  it('rejects assignedUserId outside org with 400', async () => {
    (prisma.user.findFirst as any).mockResolvedValueOnce(null);
    const res = await buildApp().inject({
      method: 'PUT', url: `${BASE}/g1/crm-profile`,
      payload: { assignedUserId: 'outsider' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'assignedUserId phải là user hợp lệ trong org' });
    expect(prisma.groupCrmProfile.upsert).not.toHaveBeenCalled();
  });

  it('mass-assignment guard — unknown fields never reach upsert', async () => {
    (prisma.groupCrmProfile.upsert as any).mockResolvedValueOnce({
      id: 'p1', externalGroupId: 'g1', crmName: null, notes: null, tags: [], assignedUserId: null, updatedAt: new Date(),
    });
    await buildApp().inject({
      method: 'PUT', url: `${BASE}/g1/crm-profile`,
      payload: { crmName: 'ok', orgId: 'hacked-org', zaloAccountId: 'other-account' } as Record<string, unknown>,
    });
    const call = (prisma.groupCrmProfile.upsert as any).mock.calls[0][0];
    expect(call.create).not.toHaveProperty('evilField');
    expect(call.create.orgId).toBe('org-1'); // từ mockUser, không phải body
    expect(call.create.zaloAccountId).toBe('za-1');
  });

  it('does not log assign activity when assignedUserId unchanged field absent', async () => {
    (prisma.groupCrmProfile.upsert as any).mockResolvedValueOnce({
      id: 'p1', externalGroupId: 'g1', crmName: 'x', notes: null, tags: [], assignedUserId: null, updatedAt: new Date(),
    });
    await buildApp().inject({
      method: 'PUT', url: `${BASE}/g1/crm-profile`,
      payload: { crmName: 'x' },
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'group_update_profile' }),
    );
  });
});

// ─── GET /stats ───────────────────────────────────────────────────────────────
describe('GET .../stats', () => {
  function setupStatsMocks() {
    const now = Date.now();
    (prisma.conversation.findMany as any).mockResolvedValue([
      {
        id: 'c1', externalThreadId: 'g1', groupName: 'Group One',
        groupAvatarUrl: null, groupMembersCount: 5,
        lastMessageAt: new Date(now - 1 * 24 * 3600 * 1000), unreadCount: 0, isReplied: true,
      },
      {
        id: 'c2', externalThreadId: 'g2', groupName: 'Group Two',
        groupAvatarUrl: null, groupMembersCount: 3,
        lastMessageAt: new Date(now - 7 * 24 * 3600 * 1000), unreadCount: 4, isReplied: false,
      },
      {
        id: 'c3', externalThreadId: 'g3', groupName: 'Old Group',
        groupAvatarUrl: null, groupMembersCount: 10,
        lastMessageAt: new Date(now - 30 * 24 * 3600 * 1000), unreadCount: 0, isReplied: true,
      },
    ]);
    (prisma.groupCrmProfile.findMany as any).mockResolvedValue([
      { externalGroupId: 'g1', crmName: 'CRM One', notes: null, tags: ['t'], assignedUserId: 'user-1' },
    ]);
    (prisma.message.groupBy as any)
      // Lần gọi 1: counts7d — trả c1 có tin trong 7 ngày
      .mockImplementationOnce(async () => [{ conversationId: 'c1', _count: { id: 12 } }])
      // Lần gọi 2: counts30d
      .mockImplementationOnce(async () => [
        { conversationId: 'c1', _count: { id: 20 } },
        { conversationId: 'c2', _count: { id: 5 } },
      ])
      // Lần gọi 3: memberRows 30d
      .mockImplementationOnce(async () => [
        { conversationId: 'c1', senderUid: 'u1', senderName: 'An', _count: { id: 8 } },
        { conversationId: 'c1', senderUid: 'u2', senderName: 'Bình', _count: { id: 3 } },
        { conversationId: 'c2', senderUid: 'u3', senderName: 'Cường', _count: { id: 6 } },
      ]);
  }

  it('merges conversations + profiles + counts into stats rows', async () => {
    setupStatsMocks();
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/stats` });
    expect(res.statusCode).toBe(200);
    const { stats } = JSON.parse(res.body, (k, v) => v); // dates ISO strings
    expect(stats).toHaveLength(3);

    const g1 = stats.find((s: any) => s.groupId === 'g1');
    expect(g1).toMatchObject({
      crmName: 'CRM One', assignedUserId: 'user-1',
      messages30d: 20, activeMembers30d: 2,
    });
    expect(g1.messages7d).toBeGreaterThan(0);
    expect(g1.topSenders30d[0]).toMatchObject({ name: 'An', count: 8 }); // sorted desc
    expect(g1.status).toBe('active'); // 1 ngày idle

    const g2 = stats.find((s: any) => s.groupId === 'g2');
    expect(g2).toMatchObject({ crmName: null, messages30d: 5, status: 'quiet' }); // 7 ngày idle
    const g3 = stats.find((s: any) => s.groupId === 'g3');
    expect(g3.status).toBe('silent'); // 30 ngày idle
  });

  it('returns empty stats when account has no group conversations', async () => {
    (prisma.conversation.findMany as any).mockResolvedValue([]);
    (prisma.groupCrmProfile.findMany as any).mockResolvedValue([]);
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/stats` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ stats: [] });
    // Early return trước khi query messages
    expect(prisma.message.groupBy).not.toHaveBeenCalled();
  });
});

// ─── GET /:groupId/stats ──────────────────────────────────────────────────────
describe('GET .../:groupId/stats', () => {
  it('returns detail stats with dailyActivity + topSenders', async () => {
    (prisma.conversation.findFirst as any).mockResolvedValueOnce({
      id: 'c1', externalThreadId: 'g1', groupName: 'Group One', groupAvatarUrl: null,
      groupMembersCount: 5, lastMessageAt: new Date(), unreadCount: 0, isReplied: true,
    });
    (prisma.groupCrmProfile.findUnique as any).mockResolvedValueOnce({
      crmName: 'CRM One', notes: 'n', tags: ['x'], assignedUserId: 'user-1',
    });
    (prisma.$queryRaw as any).mockResolvedValueOnce([
      { day: new Date('2026-08-20'), count: 4n },
      { day: new Date('2026-08-21'), count: 7n },
    ]);
    (prisma.message.groupBy as any).mockResolvedValueOnce([
      { senderUid: 'u1', senderName: 'An', _count: { id: 9 } },
    ]);

    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/g1/stats` });
    expect(res.statusCode).toBe(200);
    const { stats } = JSON.parse(res.body);
    expect(stats).toMatchObject({ groupId: 'g1', crmName: 'CRM One' });
    expect(stats.dailyActivity).toEqual([
      { date: '2026-08-20T00:00:00.000Z', count: 4 },
      { date: '2026-08-21T00:00:00.000Z', count: 7 },
    ]); // bigint → Number
    expect(stats.topSenders[0]).toMatchObject({ senderName: 'An', count: 9 });
  });

  it('404 when conversation not found', async () => {
    (prisma.conversation.findFirst as any).mockResolvedValueOnce(null);
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/g404/stats` });
    expect(res.statusCode).toBe(404);
  });
});
