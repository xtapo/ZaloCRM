/**
 * merge-chain.integration.test.ts — Real DB Integration Tests for Merge Chain Traversal (Decision 0.7)
 *
 * Kiểm tra 4 kịch bản bắt buộc:
 * 1. 3 cấp thẳng hàng (C -> B -> A)
 * 2. Vòng lặp (A -> B -> A)
 * 3. Độ sâu vượt giới hạn (> 25 cấp)
 * 4. Cô lập Tenant (Node trỏ sang Org khác)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../src/shared/database/prisma-client.js';
import {
  resolveCanonicalContactId,
  collectMergedContactIds,
  MAX_MERGE_CHAIN_DEPTH,
} from '../../src/modules/agent/contacts/merge-chain.js';

describe('Contact Merge Chain Integration Tests (Real DB without mock)', () => {
  const TEST_PREFIX = `merge_test_${Date.now()}`;
  const orgAId = `${TEST_PREFIX}_org_a`;
  const orgBId = `${TEST_PREFIX}_org_b`;

  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        { id: orgAId, name: 'Merge Org A', agentTokenBudgetMonthly: 10_000 },
        { id: orgBId, name: 'Merge Org B', agentTokenBudgetMonthly: 10_000 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.contact.deleteMany({
      where: { orgId: { in: [orgAId, orgBId] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } },
    });
  });

  // ── 1. 3 cấp thẳng hàng: C -> B -> A ────────────────────────────────────────
  it('1. Chuỗi thẳng hàng 3 cấp: C trỏ B, B trỏ A -> resolve ra A và collect ra [B, C]', async () => {
    const contactA = `${TEST_PREFIX}_linear_A`;
    const contactB = `${TEST_PREFIX}_linear_B`;
    const contactC = `${TEST_PREFIX}_linear_C`;

    // A là root canonical (mergedInto = null)
    await prisma.contact.create({
      data: { id: contactA, orgId: orgAId, fullName: 'Linear Contact A' },
    });

    // B merged vào A
    await prisma.contact.create({
      data: { id: contactB, orgId: orgAId, fullName: 'Linear Contact B', mergedInto: contactA },
    });

    // C merged vào B
    await prisma.contact.create({
      data: { id: contactC, orgId: orgAId, fullName: 'Linear Contact C', mergedInto: contactB },
    });

    // 1. Đi LÊN: resolveCanonicalContactId
    const canonicalFromC = await resolveCanonicalContactId({ orgId: orgAId, contactId: contactC });
    expect(canonicalFromC).toBe(contactA);

    const canonicalFromB = await resolveCanonicalContactId({ orgId: orgAId, contactId: contactB });
    expect(canonicalFromB).toBe(contactA);

    const canonicalFromA = await resolveCanonicalContactId({ orgId: orgAId, contactId: contactA });
    expect(canonicalFromA).toBe(contactA);

    // 2. Đi XUỐNG: collectMergedContactIds
    const mergedUnderA = await collectMergedContactIds({ orgId: orgAId, canonicalId: contactA });
    expect(mergedUnderA).toHaveLength(2);
    expect(new Set(mergedUnderA)).toEqual(new Set([contactB, contactC]));
  });

  // ── 2. Vòng lặp: A -> B -> A ────────────────────────────────────────────────
  it('2. Vòng lặp A -> B -> A: dừng nhánh an toàn và không bao giờ ném ngoại lệ (throw)', async () => {
    const contactLoopA = `${TEST_PREFIX}_loop_A`;
    const contactLoopB = `${TEST_PREFIX}_loop_B`;

    await prisma.contact.create({
      data: { id: contactLoopA, orgId: orgAId, fullName: 'Loop Contact A' },
    });

    await prisma.contact.create({
      data: { id: contactLoopB, orgId: orgAId, fullName: 'Loop Contact B', mergedInto: contactLoopA },
    });

    // Cập nhật contactLoopA trỏ sang contactLoopB để tạo chu trình A -> B -> A
    await prisma.contact.update({
      where: { id: contactLoopA },
      data: { mergedInto: contactLoopB },
    });

    // Đi LÊN không bị treo vòng lặp vô tận, không ném exception
    const canonicalRes = await resolveCanonicalContactId({ orgId: orgAId, contactId: contactLoopA });
    expect([contactLoopA, contactLoopB]).toContain(canonicalRes);

    // Đi XUỐNG không bị treo vô tận, không ném exception
    const mergedRes = await collectMergedContactIds({ orgId: orgAId, canonicalId: contactLoopA });
    expect(Array.isArray(mergedRes)).toBe(true);
  });

  // ── 3. Độ sâu vượt giới hạn (> 25 node) ─────────────────────────────────────
  it('3. Độ sâu chuỗi > 25 cấp (28 node): dừng sau tối đa 25 bước và không bị crash', async () => {
    const chainLength = 28;
    const nodeIds: string[] = [];

    for (let i = 0; i < chainLength; i++) {
      nodeIds.push(`${TEST_PREFIX}_deep_node_${i}`);
    }

    // Node 0: root
    await prisma.contact.create({
      data: { id: nodeIds[0], orgId: orgAId, fullName: 'Deep Node 0' },
    });

    // Node i trỏ vào Node i-1
    for (let i = 1; i < chainLength; i++) {
      await prisma.contact.create({
        data: {
          id: nodeIds[i],
          orgId: orgAId,
          fullName: `Deep Node ${i}`,
          mergedInto: nodeIds[i - 1],
        },
      });
    }

    // Đi LÊN từ lá sâu nhất (Node 27)
    const leafId = nodeIds[chainLength - 1];
    const canonical = await resolveCanonicalContactId({ orgId: orgAId, contactId: leafId });
    expect(canonical).toBeDefined();
    // Sau 25 bước, dừng ở node 27 - 25 = node 2 (không chạm được node 0 vì bị cap ở 25)
    expect(canonical).toBe(nodeIds[chainLength - 1 - MAX_MERGE_CHAIN_DEPTH]);

    // Đi XUỐNG từ root (Node 0)
    const collected = await collectMergedContactIds({ orgId: orgAId, canonicalId: nodeIds[0] });
    expect(collected.length).toBe(MAX_MERGE_CHAIN_DEPTH);
  });

  // ── 4. Cô lập Tenant: Node trỏ sang Contact thuộc Org khác ──────────────────
  it('4. Cô lập Tenant: contact Org A trỏ mergedInto sang Contact Org B -> dừng ngay tại ranh giới Org A', async () => {
    const contactOrgA = `${TEST_PREFIX}_tenant_A`;
    const contactOrgB = `${TEST_PREFIX}_foreign_B`;

    // Tạo Contact thuộc Org B
    await prisma.contact.create({
      data: { id: contactOrgB, orgId: orgBId, fullName: 'Foreign Contact in Org B' },
    });

    // Tạo Contact thuộc Org A nhưng có mergedInto trỏ vào contactOrgB
    await prisma.contact.create({
      data: {
        id: contactOrgA,
        orgId: orgAId,
        fullName: 'Contact in Org A pointing to Org B',
        mergedInto: contactOrgB,
      },
    });

    // 1. Đi LÊN trong Org A: Do contactOrgB không thuộc Org A, hàm dừng ngay tại contactOrgA
    const canonicalInOrgA = await resolveCanonicalContactId({
      orgId: orgAId,
      contactId: contactOrgA,
    });
    expect(canonicalInOrgA).toBe(contactOrgA);

    // 2. Đi XUỐNG trong Org B: Không bao giờ thu nạp contact thuộc Org A
    const mergedInOrgB = await collectMergedContactIds({
      orgId: orgBId,
      canonicalId: contactOrgB,
    });
    expect(mergedInOrgB).not.toContain(contactOrgA);
    expect(mergedInOrgB).toHaveLength(0);
  });
});
