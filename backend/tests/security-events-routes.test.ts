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

  it('(c) filter khoảng ngày cắt đúng biên (from, to, actions)', async () => {
    currentUserRole = 'admin';
    const fromStr = '2026-08-10T00:00:00.000Z';
    const toStr = '2026-08-14T23:59:59.000Z';

    await getEvents({
      from: fromStr,
      to: toStr,
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
          },
        }),
        take: 25,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

  it('(e) nick privacyMode === main của người khác -> tên nick trong details bị che bằng PRIVACY_BLUR_TOKEN', async () => {
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

  /* ── A. Phân trang cursor composite không mất bản ghi ───────────────── */
  it('(A.1) cursor composite phân trang 5 bản ghi cùng createdAt, limit=2 không trùng không thiếu', async () => {
    const sameDate = new Date('2026-08-14T10:00:00.000Z');
    // 5 bản ghi cùng millisecond
    const allDbRecords = [
      { id: 'sec-5', orgId: 'org-1', category: 'security', action: 'zalo_session_down', createdAt: sameDate, details: {} },
      { id: 'sec-4', orgId: 'org-1', category: 'security', action: 'zalo_session_down', createdAt: sameDate, details: {} },
      { id: 'sec-3', orgId: 'org-1', category: 'security', action: 'zalo_session_down', createdAt: sameDate, details: {} },
      { id: 'sec-2', orgId: 'org-1', category: 'security', action: 'zalo_session_down', createdAt: sameDate, details: {} },
      { id: 'sec-1', orgId: 'org-1', category: 'security', action: 'zalo_session_down', createdAt: sameDate, details: {} },
    ];

    // Mô phỏng query Prisma lọc theo composite condition
    vi.mocked(prisma.activityLog.findMany).mockImplementation(async (args: any) => {
      let filtered = [...allDbRecords];
      const andClauses = args?.where?.AND;
      if (andClauses && andClauses[0]?.OR) {
        const orList = andClauses[0].OR;
        const ltDate = orList[0]?.createdAt?.lt;
        const eqDate = orList[1]?.createdAt;
        const ltId = orList[1]?.id?.lt;

        filtered = filtered.filter((row) => {
          if (row.createdAt < ltDate) return true;
          if (row.createdAt.getTime() === eqDate.getTime() && row.id < ltId) return true;
          return false;
        });
      }
      return filtered.slice(0, args.take || 50) as any;
    });

    const collectedIds: string[] = [];

    // Trang 1
    const res1 = await getEvents({ limit: '2' });
    expect(res1.statusCode).toBe(200);
    const data1 = res1.json();
    expect(data1.events).toHaveLength(2);
    expect(data1.events.map((e: any) => e.id)).toEqual(['sec-5', 'sec-4']);
    expect(data1.nextCursor).toBe(`${sameDate.toISOString()}|sec-4`);
    collectedIds.push(...data1.events.map((e: any) => e.id));

    // Trang 2
    const res2 = await getEvents({ limit: '2', cursor: data1.nextCursor });
    expect(res2.statusCode).toBe(200);
    const data2 = res2.json();
    expect(data2.events).toHaveLength(2);
    expect(data2.events.map((e: any) => e.id)).toEqual(['sec-3', 'sec-2']);
    expect(data2.nextCursor).toBe(`${sameDate.toISOString()}|sec-2`);
    collectedIds.push(...data2.events.map((e: any) => e.id));

    // Trang 3
    const res3 = await getEvents({ limit: '2', cursor: data2.nextCursor });
    expect(res3.statusCode).toBe(200);
    const data3 = res3.json();
    expect(data3.events).toHaveLength(1);
    expect(data3.events.map((e: any) => e.id)).toEqual(['sec-1']);
    expect(data3.nextCursor).toBeNull();
    collectedIds.push(...data3.events.map((e: any) => e.id));

    // Assert đúng 5 ID không trùng không thiếu
    expect(collectedIds).toEqual(['sec-5', 'sec-4', 'sec-3', 'sec-2', 'sec-1']);
    expect(new Set(collectedIds).size).toBe(5);
  });

  it('(A.2) cursor sai định dạng -> 400 INVALID_CURSOR', async () => {
    const resMalformed1 = await getEvents({ cursor: 'invalid-no-pipe' });
    expect(resMalformed1.statusCode).toBe(400);
    expect(resMalformed1.json()).toEqual(expect.objectContaining({ code: 'INVALID_CURSOR' }));

    const resMalformed2 = await getEvents({ cursor: 'not-a-date|id-1' });
    expect(resMalformed2.statusCode).toBe(400);
    expect(resMalformed2.json()).toEqual(expect.objectContaining({ code: 'INVALID_CURSOR' }));
  });

  /* ── B. Test cho search & where.OR ───────────────────────────────────── */
  it('(B.1) search có giá trị (không có hidden nick) -> dựng đúng where.OR với path và mode insensitive', async () => {
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([]);
    await getEvents({ search: 'Alpha' });

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { action: { contains: 'Alpha', mode: 'insensitive' } },
            { systemSource: { contains: 'Alpha', mode: 'insensitive' } },
            { details: { path: ['reason'], string_contains: 'Alpha' } },
            { details: { path: ['path'], string_contains: 'Alpha' } },
            { user: { fullName: { contains: 'Alpha', mode: 'insensitive' } } },
            { user: { email: { contains: 'Alpha', mode: 'insensitive' } } },
            {
              OR: [
                { details: { path: ['displayName'], string_contains: 'Alpha' } },
                { details: { path: ['accountName'], string_contains: 'Alpha' } },
              ],
            },
          ],
        }),
      }),
    );
  });

  it('(B.2) search rỗng -> KHÔNG có where.OR', async () => {
    await getEvents({ search: '   ' });

    const calls = vi.mocked(prisma.activityLog.findMany).mock.calls;
    const lastCallWhere = calls[calls.length - 1][0]?.where;
    expect(lastCallWhere?.OR).toBeUndefined();
  });

  it('(B.3.a) chủ nick main search đúng tên nick của mình -> THẤY dòng, tên hiện bình thường', async () => {
    currentUserRole = 'owner';
    currentUserId = 'u-boss-1';

    // Nick main của u-boss-1
    vi.mocked(prisma.zaloAccount.findMany).mockImplementation(async (args: any) => {
      // Khi tìm hiddenNicks (ownerUserId != u-boss-1) -> trả rỗng vì u-boss-1 là chủ nick
      if (args?.where?.ownerUserId) return [];
      // Khi tìm privacyAccounts sau fetch -> trả thông tin nick
      return [{ id: 'acc-boss', privacyMode: 'main', ownerUserId: 'u-boss-1', displayName: 'Nick Vip Boss' } as any];
    });

    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([
      {
        id: 'log-1',
        orgId: 'org-1',
        userId: 'u-boss-1',
        actorType: 'user',
        category: 'security',
        action: 'zalo_session_down',
        entityType: 'zalo_account',
        entityId: 'acc-boss',
        details: { displayName: 'Nick Vip Boss', accountId: 'acc-boss' },
        createdAt: new Date(),
        user: null,
      } as any,
    ]);

    const res = await getEvents({ search: 'Vip Boss' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].details.displayName).toBe('Nick Vip Boss'); // Tên hiện bình thường vì là chủ nick
  });

  it('(B.3.b) admin KHÔNG phải chủ nick main search tên nick đó -> KHÔNG tìm thấy dòng nào qua tên', async () => {
    currentUserRole = 'admin';
    currentUserId = 'u-admin-other';

    // Nick main thuộc về u-boss-1 khác u-admin-other
    vi.mocked(prisma.zaloAccount.findMany).mockImplementation(async (args: any) => {
      if (args?.where?.ownerUserId) {
        return [{ id: 'acc-boss' } as any]; // hiddenMatchIds = ['acc-boss']
      }
      return [{ id: 'acc-boss', privacyMode: 'main', ownerUserId: 'u-boss-1', displayName: 'Nick Vip Boss' } as any];
    });

    // Khi query activityLog với NOT condition loại trừ acc-boss, DB trả rỗng
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([]);

    const res = await getEvents({ search: 'Vip Boss' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.events).toHaveLength(0); // 0 kết quả

    // Assert query contains NOT clause with hiddenMatchId
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: [
                expect.objectContaining({
                  OR: [
                    { details: { path: ['displayName'], string_contains: 'Vip Boss' } },
                    { details: { path: ['accountName'], string_contains: 'Vip Boss' } },
                  ],
                }),
                expect.objectContaining({
                  NOT: {
                    OR: [
                      { entityType: 'zalo_account', entityId: { in: ['acc-boss'] } },
                      { details: { path: ['accountId'], equals: 'acc-boss' } },
                    ],
                  },
                }),
              ],
            }),
          ]),
        }),
      }),
    );
  });

  it('(B.3.c) search tên nick sub của người khác -> VẪN thấy, tên hiện bình thường', async () => {
    currentUserRole = 'admin';
    currentUserId = 'u-admin-other';

    // Nick sub của người khác: hiddenNicks trả rỗng vì privacyMode != 'main'
    vi.mocked(prisma.zaloAccount.findMany).mockImplementation(async (args: any) => {
      if (args?.where?.ownerUserId) return [];
      return [{ id: 'acc-sub', privacyMode: 'sub', ownerUserId: 'u-boss-1', displayName: 'Nick Sub Cong Khai' } as any];
    });

    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([
      {
        id: 'log-sub',
        orgId: 'org-1',
        userId: 'u-boss-1',
        actorType: 'user',
        category: 'security',
        action: 'zalo_session_down',
        entityType: 'zalo_account',
        entityId: 'acc-sub',
        details: { displayName: 'Nick Sub Cong Khai', accountId: 'acc-sub' },
        createdAt: new Date(),
        user: null,
      } as any,
    ]);

    const res = await getEvents({ search: 'Sub Cong Khai' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].details.displayName).toBe('Nick Sub Cong Khai');
  });

  it('(B.3.d) search theo details.reason vẫn hoạt động độc lập không bị chặn', async () => {
    currentUserRole = 'admin';
    currentUserId = 'u-admin-other';

    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([]);
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([
      {
        id: 'log-reason',
        orgId: 'org-1',
        userId: 'u-boss-1',
        actorType: 'user',
        category: 'security',
        action: 'security_scope_denied',
        details: { reason: 'Unauthorized access token' },
        createdAt: new Date(),
        user: null,
      } as any,
    ]);

    const res = await getEvents({ search: 'Unauthorized' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].details.reason).toBe('Unauthorized access token');
  });

  /* ── D. Chặn limit âm / clamp ────────────────────────────────────────── */
  it('(D) limit=-5 hoặc limit=0 -> clamp về take hợp lệ, không âm', async () => {
    await getEvents({ limit: '-5' });
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 }),
    );

    await getEvents({ limit: '0' });
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 }),
    );

    await getEvents({ limit: '999' });
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  /* ── E. Lọc actions không hợp lệ trả về rỗng ─────────────────────────── */
  it('(E) actions chứa toàn chuỗi không hợp lệ -> trả mảng rỗng', async () => {
    const res = await getEvents({ actions: 'chuoi_khong_hop_le,action_gia' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data).toEqual({ events: [], nextCursor: null });
    expect(prisma.activityLog.findMany).not.toHaveBeenCalled();
  });
});
