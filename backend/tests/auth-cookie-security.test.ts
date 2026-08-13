/**
 * auth-cookie-security.test.ts — Test suite cho bảo mật xác thực cookie, CSRF hook, tokenVersion revocation, rate limiting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/shared/database/prisma-client.js';
import { config } from '../src/config/index.js';
import { authRoutes } from '../src/modules/auth/auth-routes.js';
import { userRoutes } from '../src/modules/auth/user-routes.js';
import { authMiddleware } from '../src/modules/auth/auth-middleware.js';

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    organization: {
      create: vi.fn(),
    },
    $transaction: vi.fn((cb: any) => cb(prisma)),
  },
}));

vi.mock('../src/config/index.js', () => ({
  config: {
    jwtSecret: 'test-jwt-secret-key-12345',
    isProduction: false,
  },
}));

// Helper build Fastify app giống cấu hình trong app.ts
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, { secret: config.jwtSecret });
  await app.register(rateLimit, {
    max: 500,
    timeWindow: '1 minute',
  });

  // CSRF Protection Hook
  app.addHook('preHandler', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const viaCookie = !request.headers.authorization && !!request.cookies?.auth_token;
    if (!viaCookie) return;

    if (
      request.url.includes('/webhook') ||
      request.url.includes('/callback') ||
      request.url.includes('/zinstant') ||
      request.url.includes('/api/v1/automation/webhooks')
    ) {
      return;
    }

    if (request.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return reply.status(403).send({ error: 'CSRF check failed', code: 'CSRF_FAILED' });
    }
  });

  await app.register(authRoutes);
  await app.register(userRoutes);

  // Route dummy để test authMiddleware trực tiếp
  app.get('/api/v1/test-protected', { preHandler: [authMiddleware] }, async (req) => {
    return { ok: true, user: req.user };
  });

  app.post('/api/v1/test-protected-write', { preHandler: [authMiddleware] }, async (req) => {
    return { ok: true, user: req.user };
  });

  await app.ready();
  return app;
}

describe('Auth & CSRF Cookie Security Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Login thành công -> Set-Cookie có auth_token với HttpOnly + SameSite=Lax
  it('1. Login thành công trả về Set-Cookie auth_token với HttpOnly và SameSite=Lax', async () => {
    const app = await buildTestApp();

    const hashedPassword = await bcrypt.hash('password123', 10);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u-100',
      email: 'user@example.com',
      passwordHash: hashedPassword,
      role: 'owner',
      orgId: 'org-100',
      isActive: true,
      tokenVersion: 0,
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'user@example.com',
        password: 'password123',
      },
    });

    expect(res.statusCode).toBe(200);
    const cookies = res.cookies;
    const authTokenCookie = cookies.find((c) => c.name === 'auth_token');
    expect(authTokenCookie).toBeDefined();
    expect(authTokenCookie?.httpOnly).toBe(true);
    expect(authTokenCookie?.sameSite).toBe('Lax');
    expect(authTokenCookie?.path).toBe('/');
  });

  // Test 2: Request chỉ mang cookie auth_token (không Bearer) -> authMiddleware cho qua
  it('2. Request chỉ mang cookie auth_token (không Bearer) cho qua authMiddleware thành công', async () => {
    const app = await buildTestApp();
    const token = jwt.sign(
      { id: 'u-100', email: 'user@example.com', role: 'owner', orgId: 'org-100', tokenVersion: 0 },
      config.jwtSecret,
    );

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u-100',
      isActive: true,
      tokenVersion: 0,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/test-protected',
      cookies: {
        auth_token: token,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.user.id).toBe('u-100');
  });

  // Test 3: CSRF Hook behavior
  describe('3. CSRF Protection Hook', () => {
    it('Chặn 403 CSRF_FAILED khi request POST dùng cookie auth nhưng THIẾU X-Requested-With header', async () => {
      const app = await buildTestApp();
      const token = jwt.sign(
        { id: 'u-100', email: 'user@example.com', role: 'owner', orgId: 'org-100', tokenVersion: 0 },
        config.jwtSecret,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/test-protected-write',
        cookies: {
          auth_token: token,
        },
        payload: { data: 'test' },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('CSRF_FAILED');
    });

    it('Cho qua khi POST dùng cookie auth CÓ X-Requested-With: XMLHttpRequest', async () => {
      const app = await buildTestApp();
      const token = jwt.sign(
        { id: 'u-100', email: 'user@example.com', role: 'owner', orgId: 'org-100', tokenVersion: 0 },
        config.jwtSecret,
      );

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u-100',
        isActive: true,
        tokenVersion: 0,
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/test-protected-write',
        cookies: {
          auth_token: token,
        },
        headers: {
          'x-requested-with': 'XMLHttpRequest',
        },
        payload: { data: 'test' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('Cho qua khi POST sử dụng Bearer Auth (không cookie) dù thiếu X-Requested-With', async () => {
      const app = await buildTestApp();
      const token = jwt.sign(
        { id: 'u-100', email: 'user@example.com', role: 'owner', orgId: 'org-100', tokenVersion: 0 },
        config.jwtSecret,
      );

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u-100',
        isActive: true,
        tokenVersion: 0,
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/test-protected-write',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: { data: 'test' },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // Test 4: tokenVersion Validation
  describe('4. tokenVersion Revocation & Compatibility', () => {
    it('Bị từ chối 401 TOKEN_REVOKED khi tokenVersion trong payload khác tokenVersion trong DB', async () => {
      const app = await buildTestApp();
      // Token payload tokenVersion = 0
      const token = jwt.sign(
        { id: 'u-100', email: 'user@example.com', role: 'owner', orgId: 'org-100', tokenVersion: 0 },
        config.jwtSecret,
      );

      // DB tokenVersion = 1 (đã đổi mật khẩu / bị revoke)
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u-100',
        isActive: true,
        tokenVersion: 1,
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/test-protected',
        cookies: { auth_token: token },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('TOKEN_REVOKED');
    });

    it('Tương thích ngược: token cũ không có tokenVersion (payload undefined => 0) + DB tokenVersion = 0 vẫn qua', async () => {
      const app = await buildTestApp();
      // Token legacy không có tokenVersion
      const legacyToken = jwt.sign(
        { id: 'u-100', email: 'user@example.com', role: 'owner', orgId: 'org-100' },
        config.jwtSecret,
      );

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u-100',
        isActive: true,
        tokenVersion: 0,
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/test-protected',
        cookies: { auth_token: legacyToken },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // Test 5: Tăng tokenVersion khi reset pass / deactivate
  describe('5. Increment tokenVersion on Password Reset & Deactivation', () => {
    it('Tăng tokenVersion khi đổi mật khẩu (PUT /api/v1/users/:id/password)', async () => {
      const app = await buildTestApp();
      const token = jwt.sign(
        { id: 'u-admin', email: 'admin@example.com', role: 'admin', orgId: 'org-100', tokenVersion: 0 },
        config.jwtSecret,
      );

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u-admin',
        isActive: true,
        tokenVersion: 0,
      } as any);

      vi.mocked(prisma.user.update).mockResolvedValue({ id: 'u-target' } as any);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/u-target/password',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          password: 'newsecretpassword123',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-target', orgId: 'org-100' },
        data: expect.objectContaining({
          tokenVersion: { increment: 1 },
        }),
      });
    });

    it('Tăng tokenVersion và isActive=false khi vô hiệu hoá user (DELETE /api/v1/users/:id)', async () => {
      const app = await buildTestApp();
      const token = jwt.sign(
        { id: 'u-owner', email: 'owner@example.com', role: 'owner', orgId: 'org-100', tokenVersion: 0 },
        config.jwtSecret,
      );

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u-owner',
        isActive: true,
        tokenVersion: 0,
      } as any);

      vi.mocked(prisma.user.update).mockResolvedValue({ id: 'u-target' } as any);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/users/u-target',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-target', orgId: 'org-100' },
        data: {
          isActive: false,
          tokenVersion: { increment: 1 },
        },
      });
    });
  });

  // Test 6: Rate Limiting
  describe('6. Rate Limiting on Sensitive Auth Endpoint', () => {
    it('Trả về 429 khi login 11 lần trong 1 phút cùng IP', async () => {
      const app = await buildTestApp();
      const hashedPassword = await bcrypt.hash('password123', 10);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u-100',
        email: 'user@example.com',
        passwordHash: hashedPassword,
        role: 'owner',
        orgId: 'org-100',
        isActive: true,
        tokenVersion: 0,
      } as any);

      // Gọi 10 lần đầu
      for (let i = 0; i < 10; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'user@example.com', password: 'password123' },
          remoteAddress: '192.168.1.100',
        });
        expect(res.statusCode).toBe(200);
      }

      // Lần thứ 11
      const res11 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'user@example.com', password: 'password123' },
        remoteAddress: '192.168.1.100',
      });

      expect(res11.statusCode).toBe(429);
    });
  });
});
