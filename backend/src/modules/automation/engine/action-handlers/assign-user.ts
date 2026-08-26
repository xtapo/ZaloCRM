// Phase 7+ — assign_user action handler (no Zalo SDK touch).
//
// Sets Contact.assignedUserId. Cross-org safety mirrors the routes-level rule:
// target user must belong to the same org as the task (checked at execution
// time too — snapshot could predate a user transfer).

import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { ActionContext, ActionResult } from '../types.js';

export async function assignUserHandler(ctx: ActionContext): Promise<ActionResult> {
  const snap = ctx.blockSnapshot as { userId?: unknown; onlyIfUnassigned?: boolean };

  if (typeof snap.userId !== 'string' || !snap.userId) {
    return {
      outcome: 'failure',
      errorCode: 'BAD_SNAPSHOT',
      errorMessage: 'blockSnapshot missing userId',
      retryable: false,
    };
  }
  const onlyIfUnassigned = snap.onlyIfUnassigned === true;

  const contact = await prisma.contact.findFirst({
    where: { id: ctx.contactId, orgId: ctx.orgId },
    select: { id: true, assignedUserId: true },
  });
  if (!contact) {
    return {
      outcome: 'failure',
      errorCode: 'CONTACT_MISSING',
      errorMessage: `Contact ${ctx.contactId} not found`,
      retryable: false,
    };
  }

  if (onlyIfUnassigned && contact.assignedUserId) {
    return {
      outcome: 'success',
      data: { skipped: true, assignedUserId: contact.assignedUserId },
    };
  }

  // Target must exist in the same org
  const user = await prisma.user.findFirst({
    where: { id: snap.userId, orgId: ctx.orgId },
    select: { id: true, fullName: true },
  });
  if (!user) {
    return {
      outcome: 'failure',
      errorCode: 'USER_MISSING_OR_CROSS_ORG',
      errorMessage: `User ${snap.userId} không thuộc tổ chức`,
      retryable: false,
    };
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { assignedUserId: snap.userId },
  });

  logger.debug(`[assign-user] contact ${contact.id} → user ${user.id}`);
  return {
    outcome: 'success',
    data: {
      previousAssignedUserId: contact.assignedUserId,
      newAssignedUserId: user.id,
      newAssignedUserName: user.fullName,
    },
  };
}
