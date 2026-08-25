/**
 * permission-group-routes.ts — RBAC Phase Phân Quyền 2026-05-21
 * REST endpoints cho PermissionGroup CRUD + matrix update.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import {
  getOrgPermissionGroups,
  getPermissionGroup,
  createPermissionGroup,
  updatePermissionGroup,
  archivePermissionGroup,
  userHasGrant,
} from './permission-group-service.js';
import { RESOURCES, ACTIONS, RESOURCE_ACTIONS, type Resource, type Action } from './permission-types.js';
import { logActivity, auditContext, AUDIT_LOGGED_HEADER } from '../activity/activity-logger.js';
import { prisma } from '../../shared/database/prisma-client.js';

/** Set cờ để audit-middleware skip (đã log thủ công). */
function markAudited(reply: FastifyReply): void {
  reply.header(AUDIT_LOGGED_HEADER, '1');
}

// TEMP RBAC guard (D8 sẽ extract thành middleware chính thức)
function requireGrant(resource: Resource, action: Action) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const allowed = await userHasGrant(user.userId ?? user.id, resource, action);
    if (!allowed) return reply.status(403).send({ error: `Forbidden: ${resource}.${action}` });
  };
}

export async function registerPermissionGroupRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/permission-groups — full tree
  app.get('/api/v1/permission-groups', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const tree = await getOrgPermissionGroups(user.orgId);
    return reply.send({ tree });
  });

  // GET /api/v1/permission-groups/meta — return matrix shape (resources + actions)
  // Dùng cho frontend render UI matrix
  app.get('/api/v1/permission-groups/meta', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    return reply.send({
      resources: RESOURCES,
      actions: ACTIONS,
      resourceActions: RESOURCE_ACTIONS,
    });
  });

  // GET /api/v1/permission-groups/:id
  app.get('/api/v1/permission-groups/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const { id } = request.params as { id: string };
    const group = await getPermissionGroup(user.orgId, id);
    if (!group) return reply.status(404).send({ error: 'not_found' });
    return reply.send({ group });
  });

  // POST /api/v1/permission-groups
  app.post('/api/v1/permission-groups', { preHandler: [authMiddleware, requireGrant('permission_group', 'create')] }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const body = (request.body ?? {}) as {
      name?: string;
      parentId?: string | null;
      cloneFromId?: string;
      grants?: any;
    };
    try {
      const group = await createPermissionGroup({
        orgId: user.orgId,
        name: body.name ?? '',
        parentId: body.parentId ?? null,
        cloneFromId: body.cloneFromId,
        grants: body.grants,
      });
      logActivity({
        orgId: user.orgId,
        userId: user.userId ?? user.id,
        action: 'permission_group_create',
        entityType: 'permission_group',
        entityId: group.id,
        details: { name: group.name, clonedFrom: body.cloneFromId ?? null },
        ...auditContext(request),
      });
      markAudited(reply);
      return reply.send({ ok: true, group });
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // PATCH /api/v1/permission-groups/:id
  app.patch('/api/v1/permission-groups/:id', { preHandler: [authMiddleware, requireGrant('permission_group', 'edit')] }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      name?: string;
      parentId?: string | null;
      displayOrder?: number;
      grants?: any;
    };
    // Fetch trước để diff grants (chỉ log keys đổi, không log toàn bộ ma trận)
    const before = await prisma.permissionGroup.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, name: true, parentId: true, displayOrder: true, isSystem: true },
    });
    if (!before) return reply.status(404).send({ error: 'not_found' });

    try {
      const group = await updatePermissionGroup({
        orgId: user.orgId,
        id,
        name: body.name,
        parentId: body.parentId,
        displayOrder: body.displayOrder,
        grants: body.grants,
      });
      const metaDiff: Record<string, { old: unknown; new: unknown }> = {};
      if (body.name !== undefined && before.name !== group.name) {
        metaDiff.name = { old: before.name, new: group.name };
      }
      if (body.parentId !== undefined && before.parentId !== body.parentId) {
        metaDiff.parentId = { old: before.parentId, new: body.parentId };
      }
      if (body.displayOrder !== undefined && before.displayOrder !== body.displayOrder) {
        metaDiff.displayOrder = { old: before.displayOrder, new: body.displayOrder };
      }
      let changedGrantKeys: string[] | null = null;
      if (body.grants !== undefined) {
        const beforeGrants = ((before as { grants?: Record<string, unknown> }).grants ?? {}) as Record<string, unknown>;
        const afterGrants = (group.grants ?? {}) as Record<string, unknown>;
        changedGrantKeys = Object.keys({ ...beforeGrants, ...afterGrants }).filter(
          (k) => JSON.stringify(beforeGrants[k]) !== JSON.stringify(afterGrants[k]),
        );
      }
      logActivity({
        orgId: user.orgId,
        userId: user.userId ?? user.id,
        action: 'permission_group_update',
        entityType: 'permission_group',
        entityId: id,
        details: {
          name: group.name,
          ...(Object.keys(metaDiff).length ? { diff: metaDiff } : {}),
          ...(changedGrantKeys ? { changedGrantKeys } : {}),
        },
        ...auditContext(request),
      });
      markAudited(reply);
      return reply.send({ ok: true, group });
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // DELETE /api/v1/permission-groups/:id
  app.delete('/api/v1/permission-groups/:id', { preHandler: [authMiddleware, requireGrant('permission_group', 'delete')] }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const { id } = request.params as { id: string };
    const target = await prisma.permissionGroup.findFirst({
      where: { id, orgId: user.orgId },
      select: { name: true },
    });
    try {
      await archivePermissionGroup(user.orgId, id);
      logActivity({
        orgId: user.orgId,
        userId: user.userId ?? user.id,
        action: 'permission_group_delete',
        entityType: 'permission_group',
        entityId: id,
        details: { name: target?.name ?? null },
        ...auditContext(request),
      });
      markAudited(reply);
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });
}
