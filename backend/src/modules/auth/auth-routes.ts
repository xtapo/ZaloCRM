/**
 * Auth routes — setup, login, and profile endpoints.
 * Registered as a Fastify plugin via app.register(authRoutes).
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth-middleware.js';
import { checkSetupStatus, setup, login, getProfile } from './auth-service.js';
import { seedScoringDefaults } from '../scoring/seed-defaults.js';
import { logger } from '../../shared/utils/logger.js';
import { config } from '../../config/index.js';
import { logActivity, auditContext, AUDIT_LOGGED_HEADER } from '../activity/activity-logger.js';
import { prisma } from '../../shared/database/prisma-client.js';

/**
 * Fire-and-forget auto-seed Phase 6 scoring config + rules nếu org chưa có.
 * Idempotent — seedScoringDefaults() tự skip khi config đã tồn tại.
 * KHÔNG await để không chặn login/setup response.
 */
function autoSeedScoringIfNeeded(orgId: string): void {
  seedScoringDefaults(orgId).catch((err) => {
    logger.warn({ orgId, err: err?.message }, '[auto-seed-scoring] failed silently');
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/setup/status — check if first-run setup is needed
  app.get('/api/v1/setup/status', async () => {
    return checkSetupStatus();
  });

  // POST /api/v1/setup — create org + owner user, return JWT
  app.post<{
    Body: { orgName: string; fullName: string; email: string; password: string };
  }>('/api/v1/setup', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    const { orgName, fullName, email, password } = request.body;
    if (!orgName || !fullName || !email || !password) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }
    const payload = await setup(orgName, fullName, email, password);
    const token = app.jwt.sign(payload, { expiresIn: '7d' });
    reply.setCookie('auth_token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      secure: config.isProduction,
    });
    // Phase 6 polish — auto-seed scoring defaults cho org mới tạo
    autoSeedScoringIfNeeded(payload.orgId);
    logActivity({
      orgId: payload.orgId,
      userId: payload.id,
      action: 'auth_setup',
      entityType: 'org',
      entityId: payload.orgId,
      details: { orgName, email },
      ...auditContext(request),
    });
    reply.header(AUDIT_LOGGED_HEADER, '1');
    return { token, user: payload };
  });

  // POST /api/v1/auth/login — verify credentials, return JWT
  app.post<{
    Body: { email: string; password: string };
  }>('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password } = request.body;
    if (!email || !password) {
      return reply.status(400).send({ error: 'Missing email or password' });
    }
    let payload;
    try {
      payload = await login(email, password);
    } catch (err) {
      // Audit login failed — KHÔNG log mật khẩu, chỉ email + reason
      const user0 = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, orgId: true },
      });
      if (user0) {
        logActivity({
          orgId: user0.orgId,
          userId: user0.id,
          action: 'auth_login_failed',
          entityType: 'user',
          entityId: user0.id,
          details: { email, reason: err instanceof Error ? err.message : 'invalid_credentials' },
          ...auditContext(request),
        });
      }
      throw err;
    }
    const token = app.jwt.sign(payload, { expiresIn: '7d' });
    reply.setCookie('auth_token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      secure: config.isProduction,
    });
    // Phase 6 polish — fire-and-forget seed nếu org cũ chưa có scoring config.
    // Idempotent — skip nếu đã tồn tại. Không await.
    autoSeedScoringIfNeeded(payload.orgId);
    logActivity({
      orgId: payload.orgId,
      userId: payload.id,
      action: 'auth_login',
      entityType: 'user',
      entityId: payload.id,
      details: { email },
      ...auditContext(request),
    });
    reply.header(AUDIT_LOGGED_HEADER, '1');
    return { token, user: payload };
  });

  // POST /api/v1/auth/logout — clear auth cookies
  app.post('/api/v1/auth/logout', async (request, reply) => {
    reply.setCookie('auth_token', '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 0,
      secure: config.isProduction,
    });
    reply.setCookie('crm_session', '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 0,
      secure: config.isProduction,
    });
    return { success: true };
  });

  // GET /api/v1/profile — return current user (requires auth)
  app.get('/api/v1/profile', { preHandler: authMiddleware }, async (request) => {
    const user = request.user as { id: string; email: string; role: string; orgId: string };
    return getProfile(user.id);
  });
}
