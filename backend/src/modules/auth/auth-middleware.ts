/**
 * Auth middleware — verifies JWT on protected routes.
 * JWT user shape is defined in shared/types/fastify-jwt-user.d.ts.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    if (!request.headers.authorization && request.cookies?.auth_token) {
      request.headers.authorization = `Bearer ${request.cookies.auth_token}`;
      (request as any).authViaCookie = true;
    }
    const decoded = await request.jwtVerify() as any;
    
    // Check if user is still active in the database
    // This prevents deactivated users from using valid tokens
    if (decoded && decoded.id) {
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { isActive: true, tokenVersion: true }
      });
      if (!user || !user.isActive) {
        return reply.status(401).send({ error: 'Tài khoản đã bị vô hiệu hóa' });
      }
      if ((decoded.tokenVersion ?? 0) !== user.tokenVersion) {
        return reply.status(401).send({ error: 'Phiên đăng nhập đã hết hiệu lực', code: 'TOKEN_REVOKED' });
      }
    }
  } catch {
    reply.status(401).send({ error: 'Unauthorized' });
  }
}
