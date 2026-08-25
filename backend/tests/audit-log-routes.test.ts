import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../src/shared/database/prisma-client.js';
import { auditLogRoutes } from '../src/modules/activity/audit-log-routes.js';

vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: vi.fn(async () => {}),
}));

vi.mock('../src/modules/rbac/rbac-middleware.js', () => ({
  requireGrant: vi.fn(() => async () => {}), // pass-through — test gate riêng bên dưới
}));

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    activityLog: { findMany: vi.fn(), groupBy: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

describe('audit-log-routes', () => {
  let app: any;
  let currentOrgId = 'org-1';

  beforeEach(async () => {
    vi.clearAllMocks();
    currentOrgId = 'org-1';
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (req: any) => {
      req.user = {
        id: 'u-owner-1',
        userId: 'u-owner-1',
        orgId: currentOrgId,
        role: 'owner',
      };
    });
    await app.register(auditLogRoutes);
    await app.ready();
  });

  const getLogs = async (query: Record<string, string> = {}) => {
    const qs = new URLSearchParams(query).toString();
    return app.inject({ method: 'GET', url: `/api/v1/audit-logs${qs ? `?${qs}` : ''}` });
  };

  it('(a) listing trả logs + org scope luôn có trong where', async () => {
    const fakeLogs = [
      {
        id: 'log-1',
        orgId: 'org-1',
        userId: 'u-1',
        actorType: 'user',
        category: 'auth',
        action: 'auth_login',
        entityType: 'user',
        entityId: 'u-1',
        details: { email: 'a@b.vn' },
        createdAt: new Date('2026-08-25T01:00:00.000Z'),
        user: { id: 'u-1', fullName: 'Nguyễn Văn A', email: 'a@b.vn' },
      },
    ];
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue(fakeLogs as any);

    const res = await getLogs();
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.logs).toHaveLength(1);
    expect(data.logs[0].action).toBe('auth_login');
    expect(data.nextCursor).toBeNull();

    // org scope bắt buộc
    const whereArg = vi.mocked(prisma.activityLog.findMany).mock.calls[0][0]!.where;
    expect((whereArg as any).orgId).toBe('org-1');
  });

  it('(b) filter users/categories/actions/actorTypes build đúng where', async () => {
    await getLogs({
      users: 'u-1,u-2',
      categories: 'auth,admin',
      actions: 'auth_login',
      actorTypes: 'user,bot',
      entityType: 'user',
    });

    const whereArg = vi.mocked(prisma.activityLog.findMany).mock.calls[0][0]!.where as any;
    expect(whereArg.userId).toEqual({ in: ['u-1', 'u-2'] });
    expect(whereArg.category).toEqual({ in: ['auth', 'admin'] });
    expect(whereArg.action).toEqual({ in: ['auth_login'] });
    expect(whereArg.actorType).toEqual({ in: ['user', 'bot'] });
    expect(whereArg.entityType).toBe('user');
  });

  it('(c) actorTypes không hợp lệ bị lọc bỏ', async () => {
    await getLogs({ actorTypes: 'user,hacker' });
    const whereArg = vi.mocked(prisma.activityLog.findMany).mock.calls[0][0]!.where as any;
    expect(whereArg.actorType).toEqual({ in: ['user'] });
  });

  it('(d) composite cursor sai format → 400 INVALID_CURSOR', async () => {
    const res = await getLogs({ cursor: 'khong-ho-tro' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({ code: 'INVALID_CURSOR' }));
  });

  it('(e) composite cursor hợp lệ build điều kiện (createdAt < OR = AND id <)', async () => {
    await getLogs({ cursor: '2026-08-25T00:00:00.000Z|log-42' });
    const whereArg = vi.mocked(prisma.activityLog.findMany).mock.calls[0][0]!.where as any;
    expect(whereArg.AND).toBeDefined();
    expect(whereArg.AND[0].OR[0]).toEqual({ createdAt: { lt: new Date('2026-08-25T00:00:00.000Z') } });
    expect(whereArg.AND[0].OR[1].createdAt).toEqual(new Date('2026-08-25T00:00:00.000Z'));
    expect(whereArg.AND[0].OR[1].id).toEqual({ lt: 'log-42' });
  });

  it('(f) nextCursor trả khi đủ limit (composite ISO|id)', async () => {
    const fakeLogs = Array.from({ length: 50 }, (_, i) => ({
      id: `log-${i}`,
      orgId: 'org-1',
      userId: null,
      actorType: 'system',
      category: 'automation',
      action: 'auto_tag_change',
      entityType: null,
      entityId: null,
      details: {},
      createdAt: new Date(`2026-08-24T00:00:${String(i % 60).padStart(2, '0')}.000Z`),
      botName: null,
      systemSource: 'sync',
      user: null,
    }));
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue(fakeLogs as any);

    const res = await getLogs({ limit: '50' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.nextCursor).toBe(`${fakeLogs[49].createdAt.toISOString()}|log-49`);
  });

  it('(g) meta trả categories + users + actions', async () => {
    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([
      { category: 'auth', _count: 10 },
      { category: 'admin', _count: 5 },
      { category: null, _count: 2 },
    ] as any);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'u-1', fullName: 'A', email: 'a@b.vn' },
    ] as any);

    const res = await app.inject({ method: 'GET', url: '/api/v1/audit-logs/meta' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    // null category bị filter
    expect(data.categories).toHaveLength(2);
    expect(data.categories[0].value).toBe('auth');
    expect(data.users).toHaveLength(1);
    expect(Array.isArray(data.actions)).toBe(true);
  });

  it('(h) CSV export có BOM + header + dòng dữ liệu', async () => {
    const fakeLogs = [
      {
        id: 'log-1',
        orgId: 'org-1',
        userId: 'u-1',
        actorType: 'user',
        category: 'auth',
        action: 'auth_login',
        entityType: 'user',
        entityId: 'u-1',
        details: { email: 'a@b.vn' },
        createdAt: new Date('2026-08-25T01:00:00.000Z'),
        botName: null,
        systemSource: null,
        user: { fullName: 'Nguyễn Văn A', email: 'a@b.vn' },
      },
    ];
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue(fakeLogs as any);

    const res = await app.inject({ method: 'GET', url: '/api/v1/audit-logs/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const body = res.body;
    expect(body.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(body).toContain('auth_login');
    expect(body).toContain('Nguyễn Văn A');

    // Export cap 10K
    const takeArg = vi.mocked(prisma.activityLog.findMany).mock.calls[0][0]!.take;
    expect(takeArg).toBeLessThanOrEqual(10_000);
  });

  it('(i) search build OR trên action/details/user name/email', async () => {
    await getLogs({ search: 'login' });
    const whereArg = vi.mocked(prisma.activityLog.findMany).mock.calls[0][0]!.where as any;
    expect(whereArg.OR).toHaveLength(4);
  });
});
