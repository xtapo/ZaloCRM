// Phase 7+ — add_tag / remove_tag action handlers (no Zalo SDK touch).
//
// Mutates Contact.tags JSON. Tags are stored as a flat string array; add is
// idempotent (set-union), remove filters. Contact.tags may be null or a
// non-array legacy value — treat both as empty.

import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { ActionContext, ActionResult } from '../types.js';

export async function modifyContactTags(
  ctx: ActionContext,
  mode: 'add' | 'remove',
): Promise<ActionResult> {
  const snap = ctx.blockSnapshot as { tags?: unknown };

  if (!Array.isArray(snap.tags) || snap.tags.length === 0) {
    return {
      outcome: 'failure',
      errorCode: 'BAD_SNAPSHOT',
      errorMessage: 'blockSnapshot missing tags array',
      retryable: false,
    };
  }
  const tags = snap.tags.filter((t): t is string => typeof t === 'string');

  const contact = await prisma.contact.findFirst({
    where: { id: ctx.contactId, orgId: ctx.orgId },
    select: { id: true, tags: true },
  });
  if (!contact) {
    return {
      outcome: 'failure',
      errorCode: 'CONTACT_MISSING',
      errorMessage: `Contact ${ctx.contactId} not found`,
      retryable: false,
    };
  }

  const current = Array.isArray(contact.tags)
    ? (contact.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  const next = mode === 'add'
    ? [...new Set([...current, ...tags])]
    : current.filter((t) => !tags.includes(t));

  // No-op guard — avoid a pointless write + updatedAt churn
  if (next.length === current.length && next.every((t) => current.includes(t))) {
    return { outcome: 'success', data: { skipped: true, tags: next } };
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { tags: next },
  });

  logger.debug(`[tag-handler] contact ${contact.id} ${mode} ${tags.length} tag(s)`);
  return { outcome: 'success', data: { previousTags: current, newTags: next } };
}

export async function addTagHandler(ctx: ActionContext): Promise<ActionResult> {
  return modifyContactTags(ctx, 'add');
}

export async function removeTagHandler(ctx: ActionContext): Promise<ActionResult> {
  return modifyContactTags(ctx, 'remove');
}
