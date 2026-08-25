import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { ruleValidationPreHandler } from './rule-validation.js';

type ValidatedRequest = FastifyRequest & { validatedRuleBody?: Record<string, unknown> };

// Giới hạn số rule mỗi org — chặn một org tạo hàng nghìn rule làm nặng engine.
const MAX_RULES_PER_ORG = 200;
const RUN_LOG_PAGE_SIZE = 50;

export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/automation/rules', async (request: FastifyRequest) => {
    const user = request.user!;
    const rules = await prisma.automationRule.findMany({
      where: { orgId: user.orgId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    return { rules };
  });

  app.post(
    '/api/v1/automation/rules',
    { preHandler: [requireRole('owner', 'admin'), ruleValidationPreHandler('create')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const body = (request as ValidatedRequest).validatedRuleBody!;

        const count = await prisma.automationRule.count({ where: { orgId: user.orgId } });
        if (count >= MAX_RULES_PER_ORG) {
          return reply.status(400).send({ error: `Đã đạt giới hạn ${MAX_RULES_PER_ORG} rule mỗi tổ chức` });
        }

        // assign_user/send_template phải trỏ tới user/template CÙNG org (review C3/C4) —
        // chặn ngay lúc tạo thay vì để action âm thầm no-op khi chạy.
        const scopeError = await validateActionReferences(user.orgId, body.actions as unknown[]);
        if (scopeError) return reply.status(400).send({ error: scopeError });

        const rule = await prisma.automationRule.create({
          data: {
            orgId: user.orgId,
            name: body.name as string,
            description: body.description as string | null | undefined,
            trigger: body.trigger as string,
            conditions: (body.conditions as unknown[]) ?? [],
            actions: (body.actions as unknown[]) ?? [],
            enabled: (body.enabled as boolean | undefined) ?? true,
            priority: (body.priority as number | undefined) ?? 0,
          },
        });
        return reply.status(201).send(rule);
      } catch (error) {
        logger.error('[automation] Create rule error:', error);
        return reply.status(500).send({ error: 'Failed to create automation rule' });
      }
    },
  );

  app.put(
    '/api/v1/automation/rules/:id',
    { preHandler: [requireRole('owner', 'admin'), ruleValidationPreHandler('update')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const { id } = request.params as { id: string };
        const body = (request as ValidatedRequest).validatedRuleBody!;
        const existing = await prisma.automationRule.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
        if (!existing) return reply.status(404).send({ error: 'Automation rule not found' });

        const scopeError = await validateActionReferences(user.orgId, body.actions as unknown[] | undefined);
        if (scopeError) return reply.status(400).send({ error: scopeError });

        // Sửa rule → xóa trạng thái lỗi cũ (nội dung mới, vận hành mới)
        const rule = await prisma.automationRule.update({
          where: { id },
          data: {
            name: body.name as string | undefined,
            description: body.description as string | null | undefined,
            trigger: body.trigger as string | undefined,
            conditions: body.conditions as unknown[] | undefined,
            actions: body.actions as unknown[] | undefined,
            enabled: body.enabled as boolean | undefined,
            priority: body.priority as number | undefined,
            lastError: null,
            lastErrorAt: null,
          },
        });
        return rule;
      } catch (error) {
        logger.error('[automation] Update rule error:', error);
        return reply.status(500).send({ error: 'Failed to update automation rule' });
      }
    },
  );

  app.delete('/api/v1/automation/rules/:id', { preHandler: requireRole('owner', 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const existing = await prisma.automationRule.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Automation rule not found' });
      await prisma.automationRule.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      logger.error('[automation] Delete rule error:', error);
      return reply.status(500).send({ error: 'Failed to delete automation rule' });
    }
  });

  // GET /rules/:id/runs — lịch sử chạy gần nhất của 1 rule (mới nhất trước).
  app.get('/api/v1/automation/rules/:id/runs', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const take = Math.min(Number(query.limit) || RUN_LOG_PAGE_SIZE, RUN_LOG_PAGE_SIZE);

    const existing = await prisma.automationRule.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Automation rule not found' });

    const runs = await prisma.automationRunLog.findMany({
      where: { orgId: user.orgId, ruleId: id },
      orderBy: { ranAt: 'desc' },
      take,
    });
    return { runs };
  });
}

/**
 * Kiểm tra tham chiếu chéo-org trong actions:
 * - assign_user: userId phải thuộc cùng org
 * - send_template: templateId phải thuộc cùng org (team hoặc personal của bất kỳ ai trong org —
 *   engine chỉ gửi template team/null nên personal vẫn hợp lệ vì đã lọc org ở sendTemplateAction)
 */
async function validateActionReferences(orgId: string, actions?: unknown[]): Promise<string | null> {
  if (!Array.isArray(actions)) return null;

  for (const raw of actions) {
    const action = raw as Record<string, unknown>;
    if (action?.type === 'assign_user' && typeof action.userId === 'string') {
      const user = await prisma.user.findFirst({ where: { id: action.userId, orgId }, select: { id: true } });
      if (!user) return 'assign_user: userId không tồn tại trong tổ chức này';
    }
    if (action?.type === 'send_template' && typeof action.templateId === 'string') {
      const template = await prisma.messageTemplate.findFirst({
        where: { id: action.templateId, orgId },
        select: { id: true },
      });
      if (!template) return 'send_template: templateId không tồn tại trong tổ chức này';
    }
  }
  return null;
}
