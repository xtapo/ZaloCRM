import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../src/shared/database/prisma-client.js';
import { installChatSecurityHooks } from '../src/modules/chat/chat-security-hooks.js';

const mockScope = { accessibleIds: ['acc1'], isOrgAdmin: false };

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: { conversation: { findFirst: vi.fn() } }
}));
vi.mock('../src/modules/zalo/zalo-scope.js', () => ({
  getZaloScope: vi.fn(() => Promise.resolve(mockScope))
}));
vi.mock('../src/modules/privacy/redact.js', () => ({
  buildPrivacyContext: vi.fn().mockResolvedValue({ privacyUnlocked: false }),
  canSeeConversationContent: vi.fn((c, ctx) => ctx.privacyUnlocked),
  redactContact: vi.fn((c) => ({ ...c, redacted: true })),
  PRIVACY_BLUR_TOKEN: 'BLURRED'
}));
vi.mock('../src/modules/activity/activity-logger.js', () => ({
  logActivity: vi.fn()
}));
import { logActivity } from '../src/modules/activity/activity-logger.js';

describe('chat-security-hooks', () => {
  let app: any;
  beforeEach(async () => {
    vi.clearAllMocks();
    mockScope.accessibleIds = ['acc1'];
    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (req: any) => { req.user = { id: 'u1', orgId: 'o1', role: 'member' }; req.jwtVerify = vi.fn().mockResolvedValue({}); });
    installChatSecurityHooks(app);
    app.get('/api/v1/conversations/:id', async () => ({ contact: { id: 1 }, lastMessageContent: 'secret', friendship: { aliasInNick: 'alias' } }));
    app.get('/api/v1/conversations', async () => ({ conversations: [{ id: '1', zaloAccountId: 'acc2' }, { id: '2', zaloAccountId: 'acc1' }], total: 2 }));
    app.post('/api/v1/conversations/:id/mark-read', async () => ({ success: true }));
    app.get('/api/v1/conversations/counts', async () => ({ unread: 1 })); // RESERVED SEGMENTS test
    await app.ready();
  });

  it('GET out of scope -> 403 ZALO_SCOPE_FORBIDDEN', async () => {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue({ zaloAccountId: 'acc2', zaloAccount: {} } as any);
    const res = await app.inject({ method: 'GET', url: '/api/v1/conversations/123' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ZALO_SCOPE_FORBIDDEN');
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'security_scope_denied',
      entityType: 'conversation'
    }));
  });

  it('GET private nick by someone else -> 200 but redacted', async () => {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue({ zaloAccountId: 'acc1', zaloAccount: { privacyMode: 'main', ownerUserId: 'u2' } } as any);
    const res = await app.inject({ method: 'GET', url: '/api/v1/conversations/123' });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.redacted).toBe(true);
    expect(json.lastMessageContent).toBe('BLURRED');
  });

  it('POST mark-read by someone else -> 403 PRIVACY_LOCKED', async () => {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue({ zaloAccountId: 'acc1', zaloAccount: { privacyMode: 'main', ownerUserId: 'u2' } } as any);
    const res = await app.inject({ method: 'POST', url: '/api/v1/conversations/123/mark-read' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('PRIVACY_LOCKED');
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'privacy_locked_access',
      entityType: 'conversation'
    }));
  });

  it('POST mark-read by OWNER (not unlocked) -> allows', async () => {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue({ zaloAccountId: 'acc1', zaloAccount: { privacyMode: 'main', ownerUserId: 'u1' } } as any);
    const res = await app.inject({ method: 'POST', url: '/api/v1/conversations/123/mark-read' });
    expect(res.statusCode).toBe(200);
  });

  it('Path /counts is not confused as conversation id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/conversations/counts' });
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(prisma.conversation.findFirst)).not.toHaveBeenCalled();
  });

  it('GET list with removed items -> logs REGRESSION', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/conversations' });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.conversations.length).toBe(1); // acc2 removed
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'security_scope_regression',
      details: expect.objectContaining({ removed: 1 })
    }));
  });
});
