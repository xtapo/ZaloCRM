import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../src/shared/database/prisma-client.js';

const mockUser = { id: 'u1', orgId: 'o1', role: 'member' };
const mockScope = { accessibleIds: ['acc1'], isOrgAdmin: false };
const mockPrivacyCtx = { viewerUserId: 'u1', orgId: 'o1', privacyUnlocked: false };

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    contact: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
    friend: { findMany: vi.fn(), findFirst: vi.fn() },
    duplicateGroup: { findMany: vi.fn(), count: vi.fn() },
    parentCandidate: { findMany: vi.fn(), count: vi.fn() },
  }
}));

vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = mockUser; },
}));

vi.mock('../src/modules/chat/chat-security-hooks.js', () => ({
  getRequestZaloScope: vi.fn(() => Promise.resolve(mockScope)),
}));

vi.mock('../src/modules/privacy/redact.js', () => {
  return {
    buildPrivacyContext: vi.fn(() => Promise.resolve(mockPrivacyCtx)),
    getRedactableContactIds: vi.fn(() => Promise.resolve(new Set())),
    shouldRedactContactPii: vi.fn(() => Promise.resolve(false)),
    redactContact: vi.fn((c) => ({ ...c, friends: undefined, redacted: true, fullName: '▒▒▒▒▒▒▒▒', phone: undefined })),
    PRIVACY_BLUR_TOKEN: '▒▒▒▒▒▒▒▒'
  };
});

describe('contact-routes scope and privacy', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockUser.role = 'member';
    mockScope.accessibleIds = ['acc1'];
    mockScope.isOrgAdmin = false;

    app = Fastify();
    const { contactRoutes } = await import('../src/modules/contacts/contact-routes.js');
    app.register(contactRoutes);
    await app.ready();
  });

  // 1. List: contact chỉ có Friend ngoài scope → KHÔNG xuất hiện; total không tính nó.
  it('List filters out contacts with no friends/convs in scope', async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([]);
    vi.mocked(prisma.contact.count).mockResolvedValue(0);

    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts' });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
    const where = vi.mocked(prisma.contact.findMany).mock.calls[0][0].where;
    expect(where.AND[0].OR).toContainEqual({ friends: { some: { zaloAccountId: { in: ['acc1'] } } } });
    expect(where.AND[0].OR).toContainEqual({ friends: { none: {} } });
  });

  // 2. List: contact tạo tay (friends rỗng) → vẫn xuất hiện.
  // Covered by the WHERE clause containing { friends: { none: {} } } verified in test #1.

  // 3. List: contact có Friend trong scope + Friend trên nick main của người khác → xuất hiện với redacted: true
  // 5. Chống N+1: list 50 contact chỉ phát sinh ĐÚNG 1 query kiểm tra redact (mock count).
  it('List redacts PII for off-limits main nick contacts in batch', async () => {
    const { getRedactableContactIds } = await import('../src/modules/privacy/redact.js');
    vi.mocked(getRedactableContactIds).mockResolvedValue(new Set(['c1']));
    
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      { id: 'c1', fullName: 'Real Name', phone: '0901234567', friends: [{ relationshipKind: 'friend' }] } as any,
      { id: 'c2', fullName: 'Normal Contact' } as any
    ]);
    vi.mocked(prisma.contact.count).mockResolvedValue(2);

    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts' });
    const json = res.json();
    
    expect(vi.mocked(getRedactableContactIds)).toHaveBeenCalledTimes(1);
    expect(json.contacts.length).toBe(2);
    
    const c1 = json.contacts.find((c: any) => c.id === 'c1');
    expect(c1.redacted).toBe(true);
    expect(c1.fullName).toBe('▒▒▒▒▒▒▒▒');
    expect(c1.phone).toBeUndefined();
    expect(c1.friends).toBeUndefined();
    
    const c2 = json.contacts.find((c: any) => c.id === 'c2');
    expect(c2.redacted).toBeUndefined();
    expect(c2.fullName).toBe('Normal Contact');
  });

  // 4. List: org admin thấy tất cả nhưng contact gắn nick main người khác vẫn redacted.
  it('Org admin sees all contacts but still gets redacted', async () => {
    mockScope.isOrgAdmin = true;
    const { getRedactableContactIds } = await import('../src/modules/privacy/redact.js');
    vi.mocked(getRedactableContactIds).mockResolvedValue(new Set(['c1']));
    
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      { id: 'c1', fullName: 'Real Name' } as any
    ]);
    vi.mocked(prisma.contact.count).mockResolvedValue(1);

    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts' });
    const json = res.json();
    
    const where = vi.mocked(prisma.contact.findMany).mock.calls[0][0].where;
    expect(where.AND).toBeUndefined();
    
    expect(json.contacts[0].redacted).toBe(true);
  });

  // 6. Detail: contact thuộc hẳn nick người khác → 403 ZALO_SCOPE_FORBIDDEN.
  it('Detail returns 403 if contact has friends but none in scope', async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({
      id: 'c1', _count: { friends: 1, conversations: 0 }
    } as any);
    vi.mocked(prisma.contact.count).mockResolvedValue(0); // inScopeCount = 0

    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts/c1' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ZALO_SCOPE_FORBIDDEN');
  });

  // 7. Detail: contact tạo tay → xem bình thường.
  it('Detail allows access to manual contact (friends: 0)', async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({
      id: 'c1', _count: { friends: 0, conversations: 0 }
    } as any);
    
    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts/c1' });
    expect(res.statusCode).toBe(200);
  });

  // 8. Stats: user thường nhận số đếm theo scope; admin nhận số toàn cục.
  it('Stats filters by scope for member', async () => {
    vi.mocked(prisma.contact.count).mockResolvedValue(5);
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: 'c1', _count: { friends: 3 } }] as any);
    
    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts/stats' });
    expect(res.statusCode).toBe(200);
    
    const where = vi.mocked(prisma.contact.count).mock.calls[0][0].where;
    expect(where.AND).toBeDefined();
  });
  
  it('Stats skips scope filter for admin', async () => {
    mockScope.isOrgAdmin = true;
    vi.mocked(prisma.contact.count).mockResolvedValue(10);
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: 'c1', _count: { friends: 3 } }] as any);
    
    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts/stats' });
    expect(res.statusCode).toBe(200);
    
    const where = vi.mocked(prisma.contact.count).mock.calls[0][0].where;
    expect(where.AND).toBeUndefined();
  });

  // 9. Friendships: chỉ trả rows thuộc nick trong scope.
  it('Friendships filters by scope.accessibleIds', async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: 'c1' } as any);
    vi.mocked(prisma.friend.findMany).mockResolvedValue([]);
    
    await app.inject({ method: 'GET', url: '/api/v1/contacts/c1/friendships' });
    
    const where = vi.mocked(prisma.friend.findMany).mock.calls[0][0].where;
    expect(where.zaloAccountId).toEqual({ in: ['acc1'] });
  });

  // 10. Duplicates/parent-candidates: member → 403; admin → 200.
  it('Duplicates and parent-candidates block member role', async () => {
    let res = await app.inject({ method: 'GET', url: '/api/v1/contacts/duplicates' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('RBAC_FORBIDDEN');
    
    res = await app.inject({ method: 'GET', url: '/api/v1/contacts/parent-candidates' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('RBAC_FORBIDDEN');
  });
  
  it('Duplicates and parent-candidates allow admin role', async () => {
    mockUser.role = 'admin';
    vi.mocked(prisma.duplicateGroup.findMany).mockResolvedValue([]);
    vi.mocked(prisma.duplicateGroup.count).mockResolvedValue(0);
    
    let res = await app.inject({ method: 'GET', url: '/api/v1/contacts/duplicates' });
    expect(res.statusCode).toBe(200);
    
    vi.mocked(prisma.parentCandidate.findMany).mockResolvedValue([]);
    res = await app.inject({ method: 'GET', url: '/api/v1/contacts/parent-candidates' });
    expect(res.statusCode).toBe(200);
  });
});
