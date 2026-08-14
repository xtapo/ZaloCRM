import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../src/shared/database/prisma-client.js';
import { notificationRoutes } from '../src/modules/notifications/notification-routes.js';
import { zaloPool } from '../src/modules/zalo/zalo-pool.js';
import { getRequestZaloScope } from '../src/modules/chat/chat-security-hooks.js';
import { getDownSinceBatch } from '../src/modules/zalo/status-log-service.js';

vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: vi.fn(async () => {})
}));

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    conversation: { count: vi.fn().mockResolvedValue(0) },
    appointment: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    zaloAccount: { findMany: vi.fn().mockResolvedValue([]) },
    activityLog: { groupBy: vi.fn().mockResolvedValue([]) },
  }
}));

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

  it('GET /notifications with role member -> no security items', async () => {
    const data = await get();
    expect(prisma.activityLog.groupBy).not.toHaveBeenCalled();
    expect(data.notifications.some((n: any) => n.id.startsWith('sec-'))).toBe(false);
  });

  it('GET /notifications with role admin -> has security items if recent', async () => {
    currentRole = 'admin';

    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([
      { action: 'security_scope_denied', _count: { action: 5 } },
      { action: 'security_scope_regression', _count: { action: 2 } }
    ] as any);

    const data = await get();
    expect(prisma.activityLog.groupBy).toHaveBeenCalled();
    const secNotifications = data.notifications.filter((n: any) => n.id.startsWith('sec-'));
    expect(secNotifications.length).toBe(2);
    expect(secNotifications.some((n: any) => n.title.includes('CẢNH BÁO'))).toBe(true);
    expect(secNotifications.some((n: any) => n.title.includes('5 lượt'))).toBe(true);
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
    expect(data.notifications.some((n: any) => n.id.startsWith('zalo-'))).toBe(false);
  });

  it('rớt kết nối 5 phút -> chưa báo; 20 phút -> báo', async () => {
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', displayName: 'Nick 1', privacyMode: false, ownerUserId: 'u1' }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected' as any);

    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map([['acc1', Date.now() - 5 * MINUTE]]));
    const early = await get();
    expect(early.notifications.some((n: any) => n.id === 'zalo-acc1')).toBe(false);

    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map([['acc1', Date.now() - 20 * MINUTE]]));
    const late = await get();
    const item = late.notifications.find((n: any) => n.id === 'zalo-acc1');
    expect(item).toBeTruthy();
    expect(item.title).toContain('Nick 1');
    expect(item.priority).toBe('high');
  });

  it('batch downSince -> chỉ 1 query cho nhiều nick', async () => {
    currentRole = 'admin';
    vi.mocked(getRequestZaloScope).mockResolvedValue({ accessibleIds: [], isOrgAdmin: true });
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', displayName: 'Nick 1', privacyMode: false, ownerUserId: 'u1' },
      { id: 'acc2', displayName: 'Nick 2', privacyMode: false, ownerUserId: 'u1' }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected' as any);
    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map([['acc2', Date.now() - 20 * MINUTE]]));

    const data = await get();

    expect(getDownSinceBatch).toHaveBeenCalledTimes(1);
    expect(getDownSinceBatch).toHaveBeenCalledWith(['acc1', 'acc2']);
    expect(data.notifications.some((n: any) => n.id === 'zalo-acc1')).toBe(false);
    expect(data.notifications.some((n: any) => n.id === 'zalo-acc2')).toBe(true);
  });

  it('qr_pending -> báo ngay dù chưa đủ 15 phút', async () => {
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', displayName: 'Nick 1', privacyMode: false, ownerUserId: 'u1' }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('qr_pending' as any);
    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map());

    const data = await get();
    const item = data.notifications.find((n: any) => n.id === 'zalo-acc1');
    expect(item).toBeTruthy();
    expect(item.title).toContain('quét QR');
  });

  it('nick privacyMode của người khác -> che tên trong cảnh báo', async () => {
    currentRole = 'admin';
    vi.mocked(getRequestZaloScope).mockResolvedValue({ accessibleIds: [], isOrgAdmin: true });
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc9', displayName: 'Nick Bí Mật', privacyMode: true, ownerUserId: 'u2' }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('disconnected' as any);
    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map([['acc9', Date.now() - 20 * MINUTE]]));

    const data = await get();
    const item = data.notifications.find((n: any) => n.id === 'zalo-acc9');
    expect(item).toBeTruthy();
    expect(item.title).not.toContain('Nick Bí Mật');
  });

  it('trạng thái connecting -> không báo động', async () => {
    vi.mocked(prisma.zaloAccount.findMany).mockResolvedValue([
      { id: 'acc1', displayName: 'Nick 1', privacyMode: false, ownerUserId: 'u1' }
    ] as any);
    vi.mocked(zaloPool.getStatus).mockReturnValue('connecting' as any);
    vi.mocked(getDownSinceBatch).mockResolvedValue(new Map([['acc1', Date.now() - 60 * MINUTE]]));

    const data = await get();
    expect(data.notifications.some((n: any) => n.id === 'zalo-acc1')).toBe(false);
  });
});
