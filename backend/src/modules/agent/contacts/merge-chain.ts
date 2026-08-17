/**
 * merge-chain.ts — Traverse Contact merge chains safely (Decision 0.7)
 *
 * Provides:
 * - resolveCanonicalContactId: Walk UP the `mergedInto` chain to find the root canonical Contact ID.
 * - collectMergedContactIds: Walk DOWN the `mergedFrom` tree to collect all IDs merged into the canonical Contact.
 *
 * Guarantees:
 * - Strictly tenant-scoped (all queries include `orgId`).
 * - Cycle-safe (`visited: Set<string>`).
 * - Depth-capped (`MAX_DEPTH = 25`).
 * - Never throws on loop or max depth: logs a warning and returns current node.
 */

import { prisma } from '../../../shared/database/prisma-client.js';

export const MAX_MERGE_CHAIN_DEPTH = 25;

export interface ResolveCanonicalContactOptions {
  orgId: string;
  contactId: string;
}

export interface CollectMergedContactIdsOptions {
  orgId: string;
  canonicalId: string;
}

export interface CanonicalContactResult {
  id: string;
  truncated: boolean;
  depth: number;
}

export interface MergedContactIdsResult {
  ids: string[];
  truncated: boolean;
  depth: number;
}

/**
 * 1. resolveCanonicalContactId: Walk UP the `mergedInto` chain to find the canonical (active) Contact ID.
 */
export async function resolveCanonicalContactId(
  options: ResolveCanonicalContactOptions,
): Promise<CanonicalContactResult> {
  const { orgId, contactId } = options;
  if (!orgId || !contactId) return { id: contactId, truncated: false, depth: 0 };

  // 1. Kiểm tra node khởi đầu có tồn tại trong orgId không
  const initial = await prisma.contact.findFirst({
    where: { id: contactId, orgId },
    select: { id: true, mergedInto: true },
  });
  if (!initial || !initial.mergedInto) {
    return { id: contactId, truncated: false, depth: 0 };
  }

  let currentId = contactId;
  let nextId: string | null = initial.mergedInto;
  const visited = new Set<string>([currentId]);
  let depth = 0;

  while (nextId && depth < MAX_MERGE_CHAIN_DEPTH) {
    if (nextId === currentId) {
      console.warn(`[WARN] [merge-chain] Self-referencing loop detected at contact ${currentId} in org ${orgId}`);
      return { id: currentId, truncated: true, depth };
    }

    if (visited.has(nextId)) {
      console.warn(`[WARN] [merge-chain] Merge cycle detected at contact ${currentId} -> ${nextId} in org ${orgId}`);
      return { id: currentId, truncated: true, depth };
    }

    // Kiểm tra node tiếp theo có thuộc orgId không (ngăn rò rỉ sang Org khác)
    const nextContact: { id: string; mergedInto: string | null } | null = await prisma.contact.findFirst({
      where: { id: nextId, orgId },
      select: { id: true, mergedInto: true },
    });

    if (!nextContact) {
      // Node trỏ sang ID không tồn tại hoặc thuộc Org khác -> dừng lại tại node hợp lệ cuối cùng trong org
      return { id: currentId, truncated: false, depth };
    }

    visited.add(nextId);
    currentId = nextId;
    nextId = nextContact.mergedInto;
    depth++;
  }

  const truncated = depth >= MAX_MERGE_CHAIN_DEPTH && nextId !== null;
  if (truncated) {
    console.warn(`[WARN] [merge-chain] Max depth ${MAX_MERGE_CHAIN_DEPTH} exceeded resolving canonical for contact ${contactId} in org ${orgId}`);
  }

  return { id: currentId, truncated, depth };
}

/**
 * 2. collectMergedContactIds: Walk DOWN the `mergedFrom` tree to collect all IDs merged into the canonical Contact.
 */
export async function collectMergedContactIds(
  options: CollectMergedContactIdsOptions,
): Promise<MergedContactIdsResult> {
  const { orgId, canonicalId } = options;
  if (!orgId || !canonicalId) return { ids: [], truncated: false, depth: 0 };

  const visited = new Set<string>([canonicalId]);
  const mergedIds: string[] = [];
  let currentLevel = [canonicalId];
  let depth = 0;
  let truncated = false;

  while (currentLevel.length > 0 && depth < MAX_MERGE_CHAIN_DEPTH) {
    const children: { id: string; mergedInto: string | null }[] = await prisma.contact.findMany({
      where: {
        orgId,
        mergedInto: { in: currentLevel },
      },
      select: { id: true, mergedInto: true },
    });

    if (children.length === 0) break;

    const nextLevel: string[] = [];
    for (const child of children) {
      if (visited.has(child.id)) {
        console.warn(`[WARN] [merge-chain] Downward merge cycle detected at contact ${child.id} in org ${orgId}`);
        truncated = true;
        continue;
      }
      visited.add(child.id);
      mergedIds.push(child.id);
      nextLevel.push(child.id);
    }

    currentLevel = nextLevel;
    depth++;
  }

  if (depth >= MAX_MERGE_CHAIN_DEPTH && currentLevel.length > 0) {
    console.warn(`[WARN] [merge-chain] Max depth ${MAX_MERGE_CHAIN_DEPTH} reached collecting merged contacts for ${canonicalId} in org ${orgId}`);
    truncated = true;
  }

  return { ids: mergedIds, truncated, depth };
}
