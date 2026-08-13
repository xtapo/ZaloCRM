import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireZaloAccess } from '../src/modules/zalo/zalo-access-middleware.js';
import { prisma } from '../src/shared/database/prisma-client.js';

const mockScope = { accessibleIds: ['acc1'], isOrgAdmin: false, ownedIds: new Set(['acc1']) };

vi.mock('../src/modules/zalo/zalo-scope.js', () => ({
  getZaloScope: vi.fn(() => Promise.resolve(mockScope))
}));
vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    zaloAccount: { findFirst: vi.fn() },
    zaloAccountAccess: { findFirst: vi.fn() },
    conversation: { findFirst: vi.fn() }
  }
}));

describe('zalo-access-middleware', () => {
  let req: any, reply: any;
  beforeEach(() => {
    vi.clearAllMocks();
    mockScope.accessibleIds = ['acc1'];
    mockScope.ownedIds = new Set(['acc1']);
    mockScope.isOrgAdmin = false;
    req = { user: { id: 'u1', orgId: 'o1', role: 'member' }, params: { zaloAccountId: 'acc1' }, query: {}, body: {} };
    reply = { status: vi.fn(() => reply), send: vi.fn() };
  });

  it('Owner without ZaloAccountAccess row passes (read)', async () => {
    vi.mocked(prisma.zaloAccount.findFirst).mockResolvedValue({ id: 'acc1', orgId: 'o1', ownerUserId: 'u1', privacyMode: 'normal' } as any);
    const mw = requireZaloAccess('read');
    await mw(req, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('Leader can read nick of member (in scope, no explicit row)', async () => {
    mockScope.ownedIds = new Set();
    req.user.role = 'leader';
    vi.mocked(prisma.zaloAccount.findFirst).mockResolvedValue({ id: 'acc1', orgId: 'o1', ownerUserId: 'u2', privacyMode: 'normal' } as any);
    const mw = requireZaloAccess('read');
    await mw(req, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('Chat/admin permission still explicit', async () => {
    mockScope.ownedIds = new Set();
    vi.mocked(prisma.zaloAccount.findFirst).mockResolvedValue({ id: 'acc1', orgId: 'o1', ownerUserId: 'u2', privacyMode: 'normal' } as any);
    vi.mocked(prisma.zaloAccountAccess.findFirst).mockResolvedValue(null);
    const mw = requireZaloAccess('chat');
    await mw(req, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it('privacyMode main + admin + no bypass -> 403 PRIVACY_LOCKED', async () => {
    mockScope.isOrgAdmin = true;
    mockScope.ownedIds = new Set();
    process.env.PRIVACY_ALLOW_ADMIN_BYPASS = 'false';
    vi.mocked(prisma.zaloAccount.findFirst).mockResolvedValue({ id: 'acc1', orgId: 'o1', ownerUserId: 'u2', privacyMode: 'main' } as any);
    const mw = requireZaloAccess('read');
    await mw(req, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'PRIVACY_LOCKED' }));
  });
});
