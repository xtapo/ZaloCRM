import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../src/shared/database/prisma-client.js';
import { securityEventsRoutes } from '../src/modules/activity/security-events-routes.js';
import { PRIVACY_BLUR_TOKEN } from '../src/modules/privacy/redact.js';

vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: vi.fn(async () => {}),
}));

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    activityLog: { findMany: vi.fn() },
    zaloAccount: { findMany: vi.fn() },
  },
}));

describe('security-events-routes', () => {
  let app: any;
  let currentUserRole = 'owner';
  let currentUserId = 'u-owner-1';
  let currentOrgId = 'org-1';

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUserRole = 'owner';
    currentUserId = 'u-owner-1';
    currentOrgId = 'org-1';

    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([]);

    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (req: any) => {
      req.user = {
        id: currentUserId,
        userId: currentUserId,
        orgId: currentOrgId,
        role: currentUserRole,
      };
    });
    await app.register(securityEventsRoutes);
    await app.ready();
  });

  const getEvents = async (query: Record<string, string> = {}) => {
    const qs = new URLSearchParams(query).toString();
    const url = `/api/v1/security-events${qs ? `?${qs}` : ''}`;
    return app.inject({ method: 'GET', url });
  };

  it('(a) member/leader gọi -> 403 Forbidden', async () => {
    currentUserRole = 'member';
    const resMember = await getEvents();
    expect(resMember.statusCode).toBe(403);
    expect(resMember.json()).toEqual(expect.objectContaining({ code: 'FORBIDDEN' }));

    currentUserRole = 'leader';
    const resLeader = await getEvents();
    expect(resLeader.statusCode).toBe(403);
    expect(resLeader.json()).toEqual(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('(b) owner gọi -> đúng dữ liệu và format', async () => {
    currentUserRole = 'owner';
    const fakeEvents = [
      {
        id: 'sec-log-1',
        orgId: 'org-1',
        userId: 'u-owner-1',
        actorType: 'user',
        botName: null,
        systemSource: null,
        category: 'security',
        action: 'security_scope_denied',
        entityType: 'zalo_account',
        entityId: 'acc-1',
        details: { reason: 'denied', displayName: 'Nick 1' },
        createdAt: new Date('2026-08-14T03:00:00.000Z'),
        user: { id: 'u-owner-1', fullName: 'Huỳnh Quang Nhân', email: 'nhan@crm.vn' },
      },
    ];
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue(fakeEvents as any);
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc-1', privacyMode: 'sub', ownerUserId: 'u-owner-1', displayName: 'Nick 1' } as any,
    ]);

    const res = await getEvents();
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].id).toBe('sec-log-1');
    expect(data.events[0].action).toBe('security_scope_denied');
    expect(data.events[0].details.displayName).toBe('Nick 1');
    expect(data.events[0].user.fullName).toBe('Huỳnh Quang Nhân');
  });

  it('(c) filter khoảng ngày cắt đúng biên (from, to, cursor, actions)', async () => {
    currentUserRole = 'admin';
    const fromStr = '2026-08-10T00:00:00.000Z';
    const toStr = '2026-08-14T23:59:59.000Z';
    const cursorStr = '2026-08-13T12:00:00.000Z';

    await getEvents({
      from: fromStr,
      to: toStr,
      cursor: cursorStr,
      actions: 'zalo_session_down,zalo_session_recovered',
      limit: '25',
    });

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: 'org-1',
          category: 'security',
          action: { in: ['zalo_session_down', 'zalo_session_recovered'] },
          createdAt: {
            gte: new Date(fromStr),
            lte: new Date(toStr),
            lt: new Date(cursorStr),
          },
        }),
        take: 25,
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('(d) không bao giờ tin orgId từ ngoài, chỉ query theo user.orgId', async () => {
    currentOrgId = 'org-real-tenant';
    await getEvents({ orgId: 'hacker-org-id' } as any);

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: 'org-real-tenant',
        }),
      }),
    );
  });

  it('(e) nick privacyMode của người khác -> tên nick trong details bị che bằng PRIVACY_BLUR_TOKEN', async () => {
    currentUserRole = 'admin';
    currentUserId = 'u-admin-1';

    const eventsWithPrivateNick = [
      {
        id: 'sec-log-priv',
        orgId: 'org-1',
        userId: 'u-other-user',
        actorType: 'user',
        botName: null,
        systemSource: null,
        category: 'security',
        action: 'privacy_locked_access',
        entityType: 'zalo_account',
        entityId: 'acc-secret-9',
        details: { displayName: 'Nick Tối Mật Của Sếp', accountId: 'acc-secret-9' },
        createdAt: new Date('2026-08-14T05:00:00.000Z'),
        user: null,
      },
    ];

    vi.mocked(prisma.activityLog.findMany).mockResolvedValue(eventsWithPrivateNick as any);
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      {
        id: 'acc-secret-9',
        privacyMode: 'main',
        ownerUserId: 'u-boss-999', // Không phải u-admin-1
        displayName: 'Nick Tối Mật Của Sếp',
      } as any,
    ]);

    const res = await getEvents();
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.events[0].details.displayName).toBe(PRIVACY_BLUR_TOKEN);
  });
});
