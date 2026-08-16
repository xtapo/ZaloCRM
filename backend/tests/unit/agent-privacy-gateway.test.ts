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
    mockPrisma.contact.findFirst.mockResolvedValueOnce(null);

    const result = await getSafeContactForAgent('contact-1', { orgId: 'org-1' });

    // Contact must be completely invisible (null) — not even masked metadata
    expect(result).toBeNull();
    expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'contact-1',
          orgId: 'org-1',
          friends: {
            none: {
              zaloAccount: {
                privacyMode: 'main',
              },
            },
          },
        },
      }),
    );
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
        friends: {
          none: {
            zaloAccount: {
              privacyMode: 'main',
            },
          },
        },
      },
      select: expect.objectContaining({
        id: true,
        fullName: true,
        friends: expect.anything(),
      }),
    });
  });

  it('filters out locked contacts from search results and uses allow-list select (Bug 3)', async () => {
    mockPrisma.contact.findMany.mockResolvedValueOnce([
      { id: 'c-public', orgId: 'org-1', fullName: 'Khách Thường', leadScore: 50 },
    ]);

    const results = await findSafeContactsForAgent({ query: 'Khách' }, { orgId: 'org-1' });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('c-public');
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith({
      where: {
        orgId: 'org-1',
        friends: {
          none: {
            zaloAccount: {
              privacyMode: 'main',
            },
          },
        },
        OR: [
          { fullName: { contains: 'Khách', mode: 'insensitive' } },
          { phone: { contains: 'Khách' } },
          { zaloUsername: { contains: 'Khách', mode: 'insensitive' } },
        ],
      },
      select: expect.objectContaining({
        id: true,
        fullName: true,
        phone: true,
      }),
      take: 20,
      orderBy: { updatedAt: 'desc' },
    });

    // Verify allow-list does NOT contain sensitive message previews or notes
    const callSelect = mockPrisma.contact.findMany.mock.calls[0][0].select;
    expect(callSelect.lastInboundPreview).toBeUndefined();
    expect(callSelect.lastOutboundPreview).toBeUndefined();
    expect(callSelect.lastInteractionPayload).toBeUndefined();
    expect(callSelect.notes).toBeUndefined();
    expect(callSelect.metadata).toBeUndefined();
    expect(callSelect.gender).toBeUndefined();
    expect(callSelect.birthYear).toBeUndefined();
    expect(callSelect.addressLine).toBeUndefined();
  });

  it('ensures getSafeContactForAgent uses allow-list select without sensitive fields (Bug 3)', async () => {
    mockPrisma.contact.findFirst.mockResolvedValueOnce({
      id: 'contact-safe-1',
      orgId: 'org-1',
      fullName: 'Khách A',
      phone: '0901112222',
      friends: [],
    });

    const contact = await getSafeContactForAgent('contact-safe-1', { orgId: 'org-1' });

    expect(contact).not.toBeNull();
    const callSelect = mockPrisma.contact.findFirst.mock.calls[0][0].select;
    expect(callSelect.lastInboundPreview).toBeUndefined();
    expect(callSelect.lastOutboundPreview).toBeUndefined();
    expect(callSelect.notes).toBeUndefined();
    expect(callSelect.metadata).toBeUndefined();
    expect(callSelect.gender).toBeUndefined();
    expect(callSelect.incomeRange).toBeUndefined();
  });

  it('fails closed and throws if neither conversationId nor contactId is provided (Bug 1 reproduction)', async () => {
    // Calling getSafeMessagesForAgent without conversationId or contactId must throw immediately
    await expect(getSafeMessagesForAgent({}, { orgId: 'org-1' })).rejects.toThrow(
      /conversationId or contactId is required/i,
    );
  });

  it('queries messages with inline exclusion of main privacy mode and returns newest messages in asc order (Bug 1 & 2)', async () => {
    const msgOlder = { id: 'm1', content: 'Chào bạn', sentAt: new Date('2026-08-16T07:00:00Z') };
    const msgNewer = { id: 'm2', content: 'Tôi cần hỗ trợ', sentAt: new Date('2026-08-16T08:00:00Z') };

    // DB returns in desc order (newest first)
    mockPrisma.message.findMany.mockResolvedValueOnce([msgNewer, msgOlder]);

    const messages = await getSafeMessagesForAgent(
      { conversationId: 'conv-1', limit: 50 },
      { orgId: 'org-1' },
    );

    // Verify DB query filters out privacyMode: 'main' directly in conversation
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith({
      where: {
        conversation: {
          orgId: 'org-1',
          id: 'conv-1',
          zaloAccount: {
            orgId: 'org-1',
            privacyMode: { not: 'main' },
          },
        },
        isDeleted: false,
      },
      orderBy: { sentAt: 'desc' },
      take: 50,
    });

    // Verify results are reversed back to chronological order (oldest to newest)
    expect(messages).toEqual([msgOlder, msgNewer]);
    expect(messages[0].id).toBe('m1');
    expect(messages[1].id).toBe('m2');
  });

  it('queries messages by contactId with privacyMode excluded (Bug 1 & 2)', async () => {
    mockPrisma.message.findMany.mockResolvedValueOnce([]);

    await getSafeMessagesForAgent(
      { contactId: 'contact-1' },
      { orgId: 'org-1' },
    );

    expect(mockPrisma.message.findMany).toHaveBeenCalledWith({
      where: {
        conversation: {
          orgId: 'org-1',
          contactId: 'contact-1',
          zaloAccount: {
            orgId: 'org-1',
            privacyMode: { not: 'main' },
          },
        },
        isDeleted: false,
      },
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
  });
});



