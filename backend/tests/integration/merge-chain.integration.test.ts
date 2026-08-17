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
    expect(canonicalFromC).toEqual({ id: contactA, truncated: false, dangling: false, depth: 2 });

    const canonicalFromB = await resolveCanonicalContactId({ orgId: orgAId, contactId: contactB });
    expect(canonicalFromB).toEqual({ id: contactA, truncated: false, dangling: false, depth: 1 });

    const canonicalFromA = await resolveCanonicalContactId({ orgId: orgAId, contactId: contactA });
    expect(canonicalFromA).toEqual({ id: contactA, truncated: false, dangling: false, depth: 0 });

    // 2. Đi XUỐNG: collectMergedContactIds
    const mergedUnderA = await collectMergedContactIds({ orgId: orgAId, canonicalId: contactA });
    expect(mergedUnderA.truncated).toBe(false);
    expect(mergedUnderA.dangling).toBe(false);
    expect(mergedUnderA.ids).toHaveLength(2);
    expect(new Set(mergedUnderA.ids)).toEqual(new Set([contactB, contactC]));
  });

  // ── 2. Vòng lặp: A -> B -> A ────────────────────────────────────────────────
  it('2. Vòng lặp A -> B -> A: dừng nhánh an toàn, trả về truncated = true và không throw', async () => {
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

    // Đi LÊN: phát hiện vòng lặp -> truncated === true, không throw
    const canonicalRes = await resolveCanonicalContactId({ orgId: orgAId, contactId: contactLoopA });
    expect(canonicalRes.truncated).toBe(true);
    expect([contactLoopA, contactLoopB]).toContain(canonicalRes.id);

    // Đi XUỐNG: phát hiện vòng lặp -> truncated === true, không throw
    const mergedRes = await collectMergedContactIds({ orgId: orgAId, canonicalId: contactLoopA });
    expect(mergedRes.truncated).toBe(true);
    expect(Array.isArray(mergedRes.ids)).toBe(true);
  });

  // ── 3. Độ sâu vượt giới hạn (> 25 node) ─────────────────────────────────────
  it('3. Độ sâu chuỗi > 25 cấp (28 node): dừng sau tối đa 25 bước và trả về truncated = true', async () => {
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
    expect(canonical.truncated).toBe(true);
    expect(canonical.depth).toBe(MAX_MERGE_CHAIN_DEPTH);
    // Sau 25 bước, dừng ở node 27 - 25 = node 2 (không chạm được node 0 vì bị cap ở 25)
    expect(canonical.id).toBe(nodeIds[chainLength - 1 - MAX_MERGE_CHAIN_DEPTH]);

    // Đi XUỐNG từ root (Node 0)
    const collected = await collectMergedContactIds({ orgId: orgAId, canonicalId: nodeIds[0] });
    expect(collected.truncated).toBe(true);
    expect(collected.depth).toBe(MAX_MERGE_CHAIN_DEPTH);
    expect(collected.ids.length).toBe(MAX_MERGE_CHAIN_DEPTH);
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

    // 1. Đi LÊN trong Org A: Do contactOrgB không thuộc Org A, hàm dừng ngay tại contactOrgA (dangling link)
    const canonicalInOrgA = await resolveCanonicalContactId({
      orgId: orgAId,
      contactId: contactOrgA,
    });
    expect(canonicalInOrgA).toEqual({ id: contactOrgA, truncated: false, dangling: true, depth: 0 });

    // 2. Đi XUỐNG trong Org B: Không bao giờ thu nạp contact thuộc Org A
    const mergedInOrgB = await collectMergedContactIds({
      orgId: orgBId,
      canonicalId: contactOrgB,
    });
    expect(mergedInOrgB.ids).not.toContain(contactOrgA);
    expect(mergedInOrgB.ids).toHaveLength(0);
    expect(mergedInOrgB.truncated).toBe(false);
    expect(mergedInOrgB.dangling).toBe(false);
  });
});
