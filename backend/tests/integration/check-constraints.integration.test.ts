/**
 * check-constraints.integration.test.ts — Real DB Integration Tests for CHECK constraints
 *
 * Kiểm tra 4 CHECK constraints:
 * 1. facts.strength IN ('strong', 'medium', 'weak')
 * 2. facts.source <> 'zalo.bank-card' (cưỡng chế quyết định 0.3)
 * 3. fact_suggestions.status IN ('pending', 'accepted', 'rejected')
 * 4. agent_tasks.status IN ('pending', 'running', 'completed', 'dead')
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../src/shared/database/prisma-client.js';

describe('Database CHECK Constraints Integration Tests', () => {
  const TEST_PREFIX = `check_test_${Date.now()}`;
  const orgId = `${TEST_PREFIX}_org`;
  const contactId = `${TEST_PREFIX}_contact`;

  beforeAll(async () => {
    // Tạo Organization và Contact phục vụ test
    await prisma.organization.create({
      data: {
        id: orgId,
        name: 'CHECK Constraints Test Org',
        agentTokenBudgetMonthly: 10_000,
      },
    });

    await prisma.contact.create({
      data: {
        id: contactId,
        orgId,
        fullName: 'Test Contact',
      },
    });
  });

  afterAll(async () => {
    await prisma.factEvidence.deleteMany({ where: { orgId } });
    await prisma.factSuggestion.deleteMany({ where: { orgId } });
    await prisma.fact.deleteMany({ where: { orgId } });
    await prisma.agentTask.deleteMany({ where: { orgId } });
    await prisma.contact.deleteMany({ where: { id: contactId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  // ── CHECK 1: facts.strength IN ('strong', 'medium', 'weak') ────────────────
  it('1. CHECK facts.strength: từ chối INSERT giá trị strength không hợp lệ', async () => {
    // Hợp lệ: 'strong', 'medium', 'weak'
    const validFact = await prisma.fact.create({
      data: {
        id: `${TEST_PREFIX}_fact_valid`,
        orgId,
        contactId,
        field: 'budget',
        value: '100tr',
        source: 'zalo.chat',
        strength: 'strong',
      },
    });
    expect(validFact.id).toBeDefined();

    // Không hợp lệ: 'super_strong' -> Database từ chối
    await expect(
      prisma.fact.create({
        data: {
          id: `${TEST_PREFIX}_fact_invalid_strength`,
          orgId,
          contactId,
          field: 'budget',
          value: '100tr',
          source: 'zalo.chat',
          strength: 'super_strong',
        },
      })
    ).rejects.toThrow();
  });

  // ── CHECK 2: facts.source <> 'zalo.bank-card' (Quyết định 0.3) ──────────────
  it('2. CHECK facts.source: từ chối INSERT fact có nguồn là zalo.bank-card (cưỡng chế quyết định 0.3)', async () => {
    // Không hợp lệ: 'zalo.bank-card' -> Database từ chối
    await expect(
      prisma.fact.create({
        data: {
          id: `${TEST_PREFIX}_fact_bank_card`,
          orgId,
          contactId,
          field: 'bank_account',
          value: '999999999',
          source: 'zalo.bank-card',
          strength: 'strong',
        },
      })
    ).rejects.toThrow();
  });

  // ── CHECK 3: fact_suggestions.status IN ('pending', 'accepted', 'rejected') ──
  it('3. CHECK fact_suggestions.status: từ chối INSERT suggestion có status không hợp lệ', async () => {
    // Hợp lệ: 'pending'
    const validSuggestion = await prisma.factSuggestion.create({
      data: {
        id: `${TEST_PREFIX}_sug_valid`,
        orgId,
        contactId,
        field: 'interest',
        proposedValue: 'Bất động sản',
        source: 'zalo.chat',
        strength: 'medium',
        reason: 'Khách nhắc tới mua nhà',
        excerpt: 'Tôi muốn mua nhà ở Q7',
        status: 'pending',
      },
    });
    expect(validSuggestion.id).toBeDefined();

    // Không hợp lệ: 'auto_approved' -> Database từ chối
    await expect(
      prisma.factSuggestion.create({
        data: {
          id: `${TEST_PREFIX}_sug_invalid_status`,
          orgId,
          contactId,
          field: 'interest',
          proposedValue: 'Bất động sản',
          source: 'zalo.chat',
          strength: 'medium',
          reason: 'Lỗi',
          excerpt: 'Lỗi',
          status: 'auto_approved',
        },
      })
    ).rejects.toThrow();
  });

  // ── CHECK 4: agent_tasks.status IN ('pending', 'running', 'completed', 'dead')
  it('4. CHECK agent_tasks.status: từ chối INSERT task có status không hợp lệ', async () => {
    // Hợp lệ: 'pending', 'running', 'completed', 'dead'
    const validTask = await prisma.agentTask.create({
      data: {
        id: `${TEST_PREFIX}_task_valid`,
        orgId,
        kind: 'noop',
        subjectType: 'contact',
        subjectId: contactId,
        dueAt: new Date(),
        status: 'pending',
      },
    });
    // Không hợp lệ: 'in_review' -> Database từ chối
    await expect(
      prisma.agentTask.create({
        data: {
          id: `${TEST_PREFIX}_task_invalid_status`,
          orgId,
          kind: 'noop',
          subjectType: 'contact',
          subjectId: contactId,
          dueAt: new Date(),
          status: 'in_review',
        },
      })
    ).rejects.toThrow();
  });

  // ── CHECK 5: fact_suggestions.source <> 'zalo.bank-card' (Quyết định 0.3) ────
  it('5. CHECK fact_suggestions.source: từ chối INSERT suggestion có source là zalo.bank-card', async () => {
    // Không hợp lệ: 'zalo.bank-card' -> Database từ chối
    await expect(
      prisma.factSuggestion.create({
        data: {
          id: `${TEST_PREFIX}_sug_bank_card`,
          orgId,
          contactId,
          field: 'bank_card',
          proposedValue: '1234-5678-9012-3456',
          source: 'zalo.bank-card',
          strength: 'strong',
          reason: 'Trích xuất thẻ ngân hàng',
          excerpt: 'STK 12345678',
          status: 'pending',
        },
      })
    ).rejects.toThrow();
  });

  // ── CHECK 6: contacts.merged_into IS DISTINCT FROM id (chống tự merge chính mình) ──
  it('6. CHECK contacts.merged_into: từ chối UPDATE/INSERT contact tự trỏ mergedInto vào chính mình', async () => {
    const selfMergeContactId = `${TEST_PREFIX}_self_merge_contact`;

    // Tạo contact bình thường
    await prisma.contact.create({
      data: {
        id: selfMergeContactId,
        orgId,
        fullName: 'Self Merge Candidate',
      },
    });

    // Cố tình update mergedInto = chính nó -> Database từ chối
    await expect(
      prisma.contact.update({
        where: { id: selfMergeContactId },
        data: {
          mergedInto: selfMergeContactId,
        },
      })
    ).rejects.toThrow();
  });
});
