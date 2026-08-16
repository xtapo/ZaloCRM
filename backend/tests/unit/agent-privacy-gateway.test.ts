/**
 * agent-privacy-gateway.test.ts — Unit tests for Phase 8 Agent Tool Gateway
 *
 * Kiểm tra các ràng buộc:
 * 1. Contact khóa PIN -> hoàn toàn vô hình với Agent (trả null/empty, loại bỏ metadata).
 * 2. Agent org A không đọc được contact của org B (Multi-tenant isolation).
 * 3. Không có siêu dữ liệu nào lọt qua gateway khi bị khóa PIN.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => {
  return {
    mockPrisma: {
      friend: {
        findMany: vi.fn(),
      },
      contact: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      conversation: {
        findFirst: vi.fn(),
      },
      message: {
        findMany: vi.fn(),
      },
    },
  };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: mockPrisma,
}));

import {
  getSafeContactForAgent,
  findSafeContactsForAgent,
  getSafeMessagesForAgent,
  getAgentLockedContactIds,
} from '../../src/modules/agent/gateway/agent-gateway.js';

describe('Agent Privacy & Tenant Gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('identifies contact locked by Privacy PIN when linked to main privacy account', async () => {
    mockPrisma.friend.findMany.mockResolvedValueOnce([
      { contactId: 'contact-locked-1' },
    ]);

    const lockedSet = await getAgentLockedContactIds(
      ['contact-locked-1', 'contact-public-2'],
      'org-1',
    );

    expect(lockedSet.has('contact-locked-1')).toBe(true);
    expect(lockedSet.has('contact-public-2')).toBe(false);
  });

  it('returns null and completely excludes contact if locked by PIN (no metadata leak)', async () => {
    mockPrisma.friend.findMany.mockResolvedValueOnce([
      { contactId: 'contact-1' },
    ]);

    const result = await getSafeContactForAgent('contact-1', { orgId: 'org-1' });

    // Contact must be completely invisible (null) — not even masked metadata
    expect(result).toBeNull();
  });

  it('returns contact details when not locked by PIN within same org', async () => {
    mockPrisma.friend.findMany.mockResolvedValueOnce([]);
    mockPrisma.contact.findFirst.mockResolvedValueOnce({
      id: 'contact-public-1',
      orgId: 'org-1',
      fullName: 'Nguyễn Văn A',
      phone: '0912345678',
      leadScore: 85,
      priorityScore: 90,
      friends: [],
    });

    const result = await getSafeContactForAgent('contact-public-1', { orgId: 'org-1' });

    expect(result).not.toBeNull();
    expect(result?.fullName).toBe('Nguyễn Văn A');
    expect(result?.leadScore).toBe(85);
  });

  it('prevents cross-tenant access: Agent in org-A cannot read contact from org-B', async () => {
    mockPrisma.friend.findMany.mockResolvedValueOnce([]);
    mockPrisma.contact.findFirst.mockResolvedValueOnce(null);

    const result = await getSafeContactForAgent('contact-org-b', { orgId: 'org-A' });

    expect(result).toBeNull();
    expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'contact-org-b',
        orgId: 'org-A',
      },
      include: expect.anything(),
    });
  });

  it('filters out locked contacts from search results (excluding metadata entirely)', async () => {
    mockPrisma.contact.findMany.mockResolvedValueOnce([
      { id: 'c-locked', orgId: 'org-1', fullName: 'Khách VIP 1', leadScore: 100 },
      { id: 'c-public', orgId: 'org-1', fullName: 'Khách Thường', leadScore: 50 },
    ]);
    mockPrisma.friend.findMany.mockResolvedValueOnce([
      { contactId: 'c-locked' },
    ]);

    const results = await findSafeContactsForAgent({ query: 'Khách' }, { orgId: 'org-1' });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('c-public');
    expect(results.some((c) => c.id === 'c-locked')).toBe(false);
  });

  it('returns empty message list if conversation belongs to main privacy account', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      orgId: 'org-1',
      zaloAccount: { privacyMode: 'main' },
    });

    const messages = await getSafeMessagesForAgent(
      { conversationId: 'conv-1' },
      { orgId: 'org-1' },
    );

    expect(messages).toEqual([]);
  });

  it('returns empty message list if target contact is locked by PIN', async () => {
    mockPrisma.friend.findMany.mockResolvedValueOnce([
      { contactId: 'c-locked' },
    ]);

    const messages = await getSafeMessagesForAgent(
      { contactId: 'c-locked' },
      { orgId: 'org-1' },
    );

    expect(messages).toEqual([]);
  });
});
