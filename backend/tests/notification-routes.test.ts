import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../src/shared/database/prisma-client.js';
import { notificationRoutes } from '../src/modules/notifications/notification-routes.js';
import { zaloPool } from '../src/modules/zalo/zalo-pool.js';

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

describe('notification-routes', () => {
  let app: any;

  let currentRole = 'member';
  beforeEach(async () => {
    vi.clearAllMocks();
    currentRole = 'member';
    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (req: any) => { 
      req.user = { id: 'u1', orgId: 'o1', role: currentRole };
    });
    await notificationRoutes(app);
    await app.ready();
  });

  it('GET /notifications with role member -> no security items', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(prisma.activityLog.groupBy).not.toHaveBeenCalled();
    expect(data.notifications.some((n: any) => n.id.startsWith('sec-'))).toBe(false);
  });

  it('GET /notifications with role admin -> has security items if recent', async () => {
    currentRole = 'admin';

    vi.mocked(prisma.activityLog.groupBy).mockResolvedValue([
      { action: 'security_scope_denied', _count: { action: 5 } },
      { action: 'security_scope_regression', _count: { action: 2 } }
    ] as any);

    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(prisma.activityLog.groupBy).toHaveBeenCalled();
    const secNotifications = data.notifications.filter((n: any) => n.id.startsWith('sec-'));
    expect(secNotifications.length).toBe(2);
    expect(secNotifications.some((n: any) => n.title.includes('CẢNH BÁO'))).toBe(true);
    expect(secNotifications.some((n: any) => n.title.includes('5 lượt'))).toBe(true);
  });
});
