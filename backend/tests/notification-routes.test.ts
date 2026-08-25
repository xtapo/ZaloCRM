/**
 * Tests cho notification routes (persistent model 2026-08-25).
 *
 * Route GET giờ: compute → syncNotifications (upsert DB) → list + unreadCount.
 * prisma.notification được mock in-memory theo hành vi thật của service để test
 * trọn đường compute→sync→list mà không cần DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../src/shared/database/prisma-client.js';
import { notificationRoutes } from '../src/modules/notifications/notification-routes.js';
import { zaloPool } from '../src/modules/zalo/zalo-pool.js';
import { getRequestZaloScope } from '../src/modules/chat/chat-security-hooks.js';
import { getDownSinceBatch } from '../src/modules/zalo/status-log-service.js';
import { PRIVACY_BLUR_TOKEN } from '../src/modules/privacy/redact.js';

vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: vi.fn(async () => {})
}));

// In-memory giả lập delegate `notification` — đủ create/findMany/updateMany/count
// cho sync + list + mark của notification-service.
const notifDb: any[] = [];
let notifSeq = 0;

function resetNotifDb(): void {
  notifDb.length = 0;
  notifSeq = 0;
}

function makeNotificationDelegate() {
  return {
    findMany: vi.fn(async ({ where, select }: any) => {
      let rows = notifDb.filter((r) =>
        r.userId === where.userId &&
        (where.resolvedAt === null ? r.resolvedAt === null : true),
      );
      if (where.readAt === null) rows = rows.filter((r) => r.readAt === null);
      return rows.map((r) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : { ...r }));
    }),
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: `n${++notifSeq}`,
        readAt: null,
        resolvedAt: null,
        link: null,
        ...data,
      };
      notifDb.push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = notifDb.find((r) => r.id === where.id);
      Object.assign(row, data);
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of notifDb) {
        if (where.id?.in && !where.id.in.includes(row.id)) continue;
        if (typeof where.id === 'string' && row.id !== where.id) continue;
        if (where.userId !== undefined && row.userId !== where.userId) continue;
        if (where.resolvedAt === null && row.resolvedAt !== null) continue;
        if (where.readAt === null && row.readAt !== null) continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    }),
    count: vi.fn(async ({ where }: any) => {
      return notifDb.filter(
        (r) => r.userId === where.userId && r.resolvedAt === null && r.readAt === null,
      ).length;
    }),
  };
}

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    conversation: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    appointment: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    zaloAccount: { findMany: vi.fn().mockResolvedValue([]) },
    activityLog: { groupBy: vi.fn().mockResolvedValue([]) },
    // Nguồn #6 — nhóm được gán phụ trách có tin chưa xử lý (tính năng quản lý nhóm CRM)
    groupCrmProfile: { findMany: vi.fn().mockResolvedValue([]) },
    // Bảng persistent notifications — mock gắn vào notifDb ở beforeEach
    get notification() {
      return currentDelegate;
    },
  }
}));

let currentDelegate: ReturnType<typeof makeNotificationDelegate>;

vi.mock('../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: { getStatus: vi.fn().mockReturnValue('connected') }
}));

vi.mock('../src/modules/chat/chat-security-hooks.js', () => ({
  getRequestZaloScope: vi.fn()
}));

vi.mock('../src/modules/zalo/status-log-service.js', () => ({
  getDownSinceBatch: vi.fn()
}));

const MINUTE = 60 * 1000;

describe('notification-routes', () => {
  let app: any;

  let currentRole = 'member';
  beforeEach(async () => {
    vi.clearAllMocks();
    currentRole = 'member';
    resetNotifDb();
    currentDelegate = makeNotificationDelegate();

    // Mặc định: member có scope 1 nick, nick đang connected, chưa có episode rớt.
    vi.mocked(prisma.conversation.count).mockResolvedValue(0);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.appointment.count).mockResolvedValue(0);
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('connected' as any);
    vi.mocked(getRequestZaloScope).mockResolvedValue({ accessibleIds: ['acc1'], isOrgAdmin: false });
    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map());

    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (req: any) => {
      req.user = { id: 'u1', orgId: 'o1', role: currentRole };
    });
    await notificationRoutes(app);
    await app.ready();
  });

  const get = async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications' });
    expect(res.statusCode).toBe(200);
    return res.json();
  };

  it('trả về kèm unreadCount khớp số item chưa đọc', async () => {
    currentRole = 'admin';
    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([
      { action: 'security_scope_denied', _count: { action: 5 }, _max: { createdAt: new Date() } }
    ] as any);

    const first = await get();
    expect(first.unreadCount).toBe(first.notifications.length);
    expect(first.notifications.length).toBeGreaterThan(0);

    // Poll lần 2 — cùng nguồn → không nhân đôi item, unread giữ nguyên
    const second = await get();
    expect(second.notifications.length).toBe(first.notifications.length);
    expect(second.unreadCount).toBe(first.unreadCount);
  });

  it('item hết điều kiện -> resolvedAt, biến mất khỏi danh sách nhưng giữ row trong DB', async () => {
    // Lượt 1: có lịch hẹn hôm nay
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      { id: 'aptX', appointmentDate: new Date(), appointmentTime: '09:00', notes: null, contact: { fullName: 'KH A' } },
    ] as any);

    const withApt = await get();
    expect(withApt.notifications.some((n: any) => n.dedupeKey === 'apt-aptX')).toBe(true);

    // Lượt 2: hẹn bị huỷ → compute không còn → resolve
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as any);
    const after = await get();
    expect(after.notifications.some((n: any) => n.dedupeKey === 'apt-aptX')).toBe(false);
    // Row vẫn nằm trong "DB" với resolvedAt
    const row = notifDb.find((r: any) => r.dedupeKey === 'apt-aptX');
    expect(row).toBeTruthy();
    expect(row.resolvedAt).not.toBeNull();
  });

  it('PATCH /notifications/:id/read -> readAt set, unreadCount giảm; read-all -> về 0', async () => {
    currentRole = 'admin';
    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([
      { action: 'security_scope_denied', _count: { action: 5 }, _max: { createdAt: new Date() } },
      { action: 'security_scope_regression', _count: { action: 2 }, _max: { createdAt: new Date() } }
    ] as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      { id: 'aptY', appointmentDate: new Date(), appointmentTime: '', notes: null, contact: { fullName: 'KH B' } },
    ] as any);

    const initial = await get();
    expect(initial.unreadCount).toBe(3);

    const target = initial.notifications[0];
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/notifications/${target.id}/read` });
    expect(res.statusCode).toBe(204);

    const afterOne = await get();
    expect(afterOne.unreadCount).toBe(initial.unreadCount - 1);

    const resAll = await app.inject({ method: 'POST', url: '/api/v1/notifications/read-all' });
    expect(resAll.statusCode).toBe(204);

    const afterAll = await get();
    expect(afterAll.unreadCount).toBe(0);
    expect(afterAll.notifications.length).toBe(3); // vẫn hiện, chỉ là đã đọc
  });

  it('readAt bảo toàn qua các lần sync (poll lại không đánh dấu lại là mới)', async () => {
    currentRole = 'admin';
    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([
      { action: 'security_scope_denied', _count: { action: 5 }, _max: { createdAt: new Date() } }
    ] as any);

    const first = await get();
    await app.inject({ method: 'POST', url: '/api/v1/notifications/read-all' });

    const second = await get();
    expect(second.unreadCount).toBe(0);
    expect(second.notifications.length).toBe(first.notifications.length);
    expect(notifDb.every((r: any) => r.readAt !== null)).toBe(true);
  });

  it('member -> không có security items', async () => {
    const data = await get();
    expect(prisma.activityLog.groupBy).not.toHaveBeenCalled();
    expect(data.notifications.some((n: any) => n.dedupeKey?.startsWith('sec-'))).toBe(false);
  });

  it('admin -> có security items nếu recent, kèm link điều hướng', async () => {
    currentRole = 'admin';

    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([
      { action: 'security_scope_denied', _count: { action: 5 } },
      { action: 'security_scope_regression', _count: { action: 2 } }
    ] as any);

    const data = await get();
    expect(prisma.activityLog.groupBy).toHaveBeenCalled();
    const secNotifications = data.notifications.filter((n: any) => n.dedupeKey.startsWith('sec-'));
    expect(secNotifications.length).toBe(2);
    expect(secNotifications.some((n: any) => n.title.includes('CẢNH BÁO'))).toBe(true);
    expect(secNotifications.some((n: any) => n.title.includes('5 lượt'))).toBe(true);
    expect(secNotifications.every((n: any) => n.link === '/security-events')).toBe(true);
  });

  it('dedupeKey sec-* tất định giữa các lần poll và createdAt theo mốc sự kiện', async () => {
    currentRole = 'admin';
    const latest = new Date('2026-08-14T03:21:00.000Z');
    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([
      { action: 'security_scope_denied', _count: { action: 5 }, _max: { createdAt: latest } },
      { action: 'security_scope_regression', _count: { action: 2 }, _max: { createdAt: latest } }
    ] as any);

    const keysOf = (data: any) =>
      data.notifications.filter((n: any) => n.dedupeKey.startsWith('sec-'))
        .map((n: any) => n.dedupeKey).sort();

    const first = await get();
    const second = await get();

    expect(keysOf(first)).toEqual([
      `sec-reg-${latest.getTime()}`,
      `sec-security_scope_denied-${latest.getTime()}`,
    ]);
    expect(keysOf(second)).toEqual(keysOf(first));

    const item = first.notifications.find((n: any) => n.dedupeKey.startsWith('sec-security_scope_denied-'));
    expect(new Date(item.createdAt).toISOString()).toBe(latest.toISOString());
  });

  it('có sự kiện bảo mật mới -> dedupeKey đổi để hiện lại như thông báo mới', async () => {
    currentRole = 'admin';
    const older = new Date('2026-08-14T03:00:00.000Z');
    const newer = new Date('2026-08-14T03:30:00.000Z');

    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([
      { action: 'security_scope_denied', _count: { action: 5 }, _max: { createdAt: older } }
    ] as any);
    const before = await get();
    // Đọc hết rồi mới tới sự kiện mới
    await app.inject({ method: 'POST', url: '/api/v1/notifications/read-all' });

    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([
      { action: 'security_scope_denied', _count: { action: 6 }, _max: { createdAt: newer } }
    ] as any);
    const mid = await get();
    // Key cũ resolved, key mới insert → unread lại
    expect(mid.notifications.some((n: any) => n.dedupeKey.endsWith(`${newer.getTime()}`))).toBe(true);
    expect(mid.unreadCount).toBeGreaterThan(0);

    const keyOf = (data: any) => data.notifications.find((n: any) => n.dedupeKey.startsWith('sec-'))?.dedupeKey;
    expect(keyOf(before)).toBe(`sec-security_scope_denied-${older.getTime()}`);
    expect(keyOf(mid)).toBe(`sec-security_scope_denied-${newer.getTime()}`);
  });

  it('member -> chỉ truy vấn nick trong accessibleIds', async () => {
    vi.mocked(getRequestZaloScope).mockResolvedValue({ accessibleIds: ['acc1', 'acc2'], isOrgAdmin: false });

    await get();

    expect(prisma.zaloAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: 'o1', id: { in: ['acc1', 'acc2'] } }),
      }),
    );
  });

  it('org admin -> không giới hạn theo id, chỉ theo orgId', async () => {
    currentRole = 'admin';
    vi.mocked(getRequestZaloScope).mockResolvedValue({ accessibleIds: [], isOrgAdmin: true });

    await get();

    const arg = vi.mocked(prisma.zaloAccount.findMany).mock.calls[0][0] as any;
    expect(arg.where.orgId).toBe('o1');
    expect(arg.where.id).toBeUndefined();
  });

  it('fail-closed: scope null hoặc rỗng -> không query nick, không có item zalo', async () => {
    vi.mocked(getRequestZaloScope).mockResolvedValue(null);

    const data = await get();

    expect(prisma.zaloAccount.findMany).not.toHaveBeenCalled();
    expect(data.notifications.some((n: any) => n.dedupeKey?.startsWith('zalo-'))).toBe(false);
  });

  it('rớt kết nối 5 phút -> chưa báo; 20 phút -> báo', async () => {
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', displayName: 'Nick 1', privacyMode: 'sub', ownerUserId: 'u1' }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected' as any);

    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map([['acc1', Date.now() - 5 * MINUTE]]));
    const early = await get();
    expect(early.notifications.some((n: any) => n.dedupeKey === 'zalo-acc1')).toBe(false);

    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map([['acc1', Date.now() - 20 * MINUTE]]));
    const late = await get();
    const item = late.notifications.find((n: any) => n.dedupeKey === 'zalo-acc1');
    expect(item).toBeTruthy();
    expect(item.title).toContain('Nick 1');
    expect(item.priority).toBe('high');
  });

  it('batch downSince -> chỉ 1 query cho nhiều nick', async () => {
    currentRole = 'admin';
    vi.mocked(getRequestZaloScope).mockResolvedValue({ accessibleIds: [], isOrgAdmin: true });
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', displayName: 'Nick 1', privacyMode: 'sub', ownerUserId: 'u1' },
      { id: 'acc2', displayName: 'Nick 2', privacyMode: 'sub', ownerUserId: 'u1' }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected' as any);
    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map([['acc2', Date.now() - 20 * MINUTE]]));

    const data = await get();

    expect(getDownSinceBatch).toHaveBeenCalledTimes(1);
    expect(getDownSinceBatch).toHaveBeenCalledWith(['acc1', 'acc2']);
    expect(data.notifications.some((n: any) => n.dedupeKey === 'zalo-acc1')).toBe(false);
    expect(data.notifications.some((n: any) => n.dedupeKey === 'zalo-acc2')).toBe(true);
  });

  it('qr_pending -> báo ngay dù chưa đủ 15 phút', async () => {
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', displayName: 'Nick 1', privacyMode: 'sub', ownerUserId: 'u1' }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('qr_pending' as any);
    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map());

    const data = await get();
    const item = data.notifications.find((n: any) => n.dedupeKey === 'zalo-acc1');
    expect(item).toBeTruthy();
    expect(item.title).toContain('quét QR');
  });

  it("nick privacyMode 'main' của người khác -> che tên trong cảnh báo", async () => {
    currentRole = 'admin';
    vi.mocked(getRequestZaloScope).mockResolvedValue({ accessibleIds: [], isOrgAdmin: true });
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc9', displayName: 'Nick Bí Mật', privacyMode: 'main', ownerUserId: 'u2' }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected' as any);
    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map([['acc9', Date.now() - 20 * MINUTE]]));

    const data = await get();
    const item = data.notifications.find((n: any) => n.dedupeKey === 'zalo-acc9');
    expect(item).toBeTruthy();
    expect(item.title).not.toContain('Nick Bí Mật');
    expect(item.title).toContain(PRIVACY_BLUR_TOKEN);
  });

  it("nick 'sub' của người khác -> VẪN hiện tên, không che oan", async () => {
    currentRole = 'admin';
    vi.mocked(getRequestZaloScope).mockResolvedValue({ accessibleIds: [], isOrgAdmin: true });
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc8', displayName: 'Nick Chung', privacyMode: 'sub', ownerUserId: 'u2' }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected' as any);
    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map([['acc8', Date.now() - 20 * MINUTE]]));

    const data = await get();
    const item = data.notifications.find((n: any) => n.dedupeKey === 'zalo-acc8');
    expect(item).toBeTruthy();
    expect(item.title).toContain('Nick Chung');
    expect(item.title).not.toContain(PRIVACY_BLUR_TOKEN);
  });

  it('trạng thái connecting -> không báo động', async () => {
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', displayName: 'Nick 1', privacyMode: 'sub', ownerUserId: 'u1' }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('connecting' as any);
    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map([['acc1', Date.now() - 60 * MINUTE]]));

    const data = await get();
    expect(data.notifications.some((n: any) => n.dedupeKey === 'zalo-acc1')).toBe(false);
  });
});
