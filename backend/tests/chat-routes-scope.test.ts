import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../src/shared/database/prisma-client.js';

const mockUser = { id: 'u1', orgId: 'o1', role: 'member' };
const mockScope = { accessibleIds: ['acc1'], isOrgAdmin: false };

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    conversation: { findMany: vi.fn(), count: vi.fn() },
    zaloAccount: { findUnique: vi.fn() }
  }
}));

vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = mockUser; },
}));

vi.mock('../src/modules/chat/chat-security-hooks.js', () => ({
  getRequestZaloScope: vi.fn(() => Promise.resolve(mockScope)),
}));

describe('chat-routes scope filters', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockUser.role = 'member';
    mockScope.accessibleIds = ['acc1'];
    mockScope.isOrgAdmin = false;

    app = Fastify();
    const { chatRoutes } = await import('../src/modules/chat/chat-routes.js');
    app.register(chatRoutes);
    await app.ready();
  });

  it('accessibleIds empty -> /conversations returns empty, total 0', async () => {
    mockScope.accessibleIds = [];
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([]);
    vi.mocked(prisma.conversation.count).mockResolvedValue(0);

    const res = await app.inject({ method: 'GET', url: '/api/v1/conversations' });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.conversations).toEqual([]);
    expect(json.total).toBe(0);
    expect(vi.mocked(prisma.conversation.findMany).mock.calls[0][0].where.zaloAccountId).toEqual({ in: [] });
  });

  it('user with role NOT member and NOT org admin -> filtered by scope', async () => {
    mockUser.role = 'manager';
    mockScope.accessibleIds = ['acc2'];
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/api/v1/conversations' });
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(prisma.conversation.findMany).mock.calls[0][0].where.zaloAccountId).toEqual({ in: ['acc2'] });
  });

  it('out of scope accountId to /conversations -> 403', async () => {
    mockScope.accessibleIds = ['acc1'];
    const res = await app.inject({ method: 'GET', url: '/api/v1/conversations?accountId=acc2' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ZALO_SCOPE_FORBIDDEN');
  });

  it('out of scope accountId to /counts -> 403', async () => {
    mockScope.accessibleIds = ['acc1'];
    const res = await app.inject({ method: 'GET', url: '/api/v1/conversations/counts?accountId=acc2' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ZALO_SCOPE_FORBIDDEN');
  });
});
