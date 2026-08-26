/**
 * messenger-routes.ts — Fastify plugin cho Messenger channel (2026-08-26).
 *
 * Routes dưới /api/v1/integrations/messenger:
 *   GET  /webhook                        — Meta webhook verification challenge
 *   POST /webhook                        — Meta webhook messaging events (raw body HMAC)
 *   GET  /pages                          — danh sách ChannelAccount messenger của org
 *   POST /pages/:pageId/enable           — bật hộp thư Messenger cho 1 page đã connect FB
 *   POST /pages/:pageId/disable          — tắt (status='disabled', conv giữ nguyên)
 *
 * Webhook KHÔNG auth — xác thực bằng HMAC X-Hub-Signature-256 (FB_APP_SECRET, cùng
 * secret với FB Lead Ads). URL nằm trong whitelist public của app.ts (/webhook substring).
 *
 * Raw-body parser: đăng ký scoped trong plugin này (Fastify encapsulation — parser
 * của facebook-routes KHÔNG áp dụng chéo sang plugin khác). Copy pattern từ
 * facebook-routes.ts L143–154.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { encrypt } from '../../../shared/crypto/aes-gcm.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { handleIncomingMessage } from '../../chat/message-handler.js';
import { messengerProvider } from './messenger-provider.js';

const PREFIX = '/api/v1/integrations/messenger';

export async function messengerRoutes(app: FastifyInstance): Promise<void> {

  // ── GET /webhook — verification challenge ─────────────────────────────────
  app.get(`${PREFIX}/webhook`, async (request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>, reply: FastifyReply) => {
    const challenge = messengerProvider.verifyWebhook(request.query);
    if (!challenge) {
      logger.warn('[messenger-routes] webhook challenge failed');
      return reply.status(403).send('Forbidden');
    }
    return reply.type('text/plain').send(challenge);
  });

  // ── Raw body capture (scoped) — cho HMAC verify ───────────────────────────
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: 2_097_152 }, // 2 MB — webhook có thể kèm nhiều events
    (req, body: Buffer, done) => {
      (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // ── POST /webhook — messaging events ──────────────────────────────────────
  app.post(`${PREFIX}/webhook`, async (request: FastifyRequest, reply: FastifyReply) => {
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    const sig = request.headers['x-hub-signature-256'] as string | undefined;

    if (!rawBody) {
      return reply.status(400).send({ error: 'bad_request' });
    }

    let events;
    try {
      // parseWebhook verify HMAC trước khi parse; ném Error nếu signature sai
      events = await messengerProvider.parseWebhook(rawBody, sig);
    } catch (err) {
      if ((err as Error).message === 'invalid_signature') {
        logger.warn('[messenger-routes] webhook POST: HMAC verification failed');
        return reply.status(401).send({ error: 'invalid_signature' });
      }
      throw err;
    }

    // Respond nhanh — process fire-and-forget (<500ms requirement của Meta retry policy)
    void processInboundEvents(events).catch((err) =>
      logger.error('[messenger-routes] process error:', err),
    );

    return reply.status(200).send({ ok: true });
  });

  // ── Authenticated management routes ───────────────────────────────────────

  // GET /pages — danh sách messenger ChannelAccounts của org
  app.get(`${PREFIX}/pages`, { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = request.user!;
    const rows = await prisma.channelAccount.findMany({
      where: { orgId, provider: 'messenger' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        externalId: true,
        displayName: true,
        avatarUrl: true,
        status: true,
        lastError: true,
        tokenExpiresAt: true,
        createdAt: true,
      },
    });
    return rows;
  });

  // POST /pages/:pageId/enable — tạo/activate ChannelAccount từ FacebookPageConnection
  app.post<{ Params: { pageId: string } }>(
    `${PREFIX}/pages/:pageId/enable`,
    { preHandler: authMiddleware },
    async (request, reply) => {
    const { orgId } = request.user!;
    const { pageId } = request.params;

    const fbConn = await prisma.facebookPageConnection.findUnique({
      where: { orgId_pageId: { orgId, pageId } },
    });
    if (!fbConn || fbConn.status !== 'connected') {
      return reply.status(404).send({ error: 'Page chưa kết nối Facebook Lead Ads hoặc đã revoked' });
    }

    // Subscribe thêm field 'messages' (idempotent — leadgen vẫn giữ)
    const { decrypt } = await import('../../../shared/crypto/aes-gcm.js');
    const pageToken = decrypt(fbConn.accessTokenEnc);
    const { subscribePageFields } = await import('./messenger-subscribe.js');
    try {
      await subscribePageFields(pageId, pageToken);
    } catch (err) {
      logger.warn('[messenger-routes] subscribe messages failed:', err);
      return reply.status(502).send({ error: 'Không subscribe được page — token có thể đã hết hạn' });
    }

    const account = await prisma.channelAccount.upsert({
      where: { orgId_provider_externalId: { orgId, provider: 'messenger', externalId: pageId } },
      create: {
        orgId,
        provider: 'messenger',
        externalId: pageId,
        displayName: fbConn.pageName,
        accessTokenEnc: fbConn.accessTokenEnc, // đã encrypt sẵn — copy nguyên trạng
        tokenExpiresAt: fbConn.tokenExpiresAt,
        status: 'connected',
      },
      update: {
        status: 'connected',
        lastError: null,
        accessTokenEnc: fbConn.accessTokenEnc,
      },
      select: { id: true, status: true },
    });

    logger.info(`[messenger-routes] page ${pageId} enabled for org ${orgId}`);
    return account;
  });

  // POST /pages/:pageId/disable — ngừng nhận inbox (không xóa conv)
  app.post<{ Params: { pageId: string } }>(
    `${PREFIX}/pages/:pageId/disable`,
    { preHandler: authMiddleware },
    async (request, reply) => {
    const { orgId } = request.user!;
    const { pageId } = request.params;

    const updated = await prisma.channelAccount.updateMany({
      where: { orgId, provider: 'messenger', externalId: pageId },
      data: { status: 'disabled' },
    });
    if (updated.count === 0) {
      return reply.status(404).send({ error: 'Channel account không tồn tại' });
    }
    return { ok: true };
  });
}

/**
 * Process inbound events — gọi handleIncomingMessage cho từng event.
 * Attachment sourceUrl (CDN FB) → tải buffer → upload MinIO → thay url trong
 * attachments JSON. Profile PSID → enrich contact name sau khi upsert.
 */
async function processInboundEvents(events: Awaited<ReturnType<typeof messengerProvider.parseWebhook>>): Promise<void> {
  for (const ev of events) {
    try {
      // Tải attachment CDN FB lên MinIO (URL FB hết hạn ~24h — phải re-host ngay)
      if (ev.attachments?.length && ev.sourceUrl) {
        const uploaded = await rehostAttachment(ev.sourceUrl);
        if (uploaded) {
          ev.attachments[0] = { ...ev.attachments[0], url: uploaded.url, mimeType: uploaded.mimeType, size: uploaded.size };
        }
      }

      // Enrich senderName từ profile PSID (best-effort, cached theo PSID 10 phút)
      if (!ev.isSelf && !ev.senderName) {
        ev.senderName = await resolveSenderName(ev.accountId, ev.senderUid);
      }

      await handleIncomingMessage({
        accountId: ev.accountId,
        senderUid: ev.senderUid,
        senderName: ev.senderName || 'Facebook User',
        content: ev.content,
        contentType: ev.contentType,
        msgId: ev.msgId,
        timestamp: ev.timestamp,
        isSelf: ev.isSelf,
        threadId: ev.threadId,
        threadType: ev.threadType,
        attachments: ev.attachments,
        quote: ev.quote,
        provider: ev.provider,
        // externalMsgId để dedup qua Message.externalMsgId unique
        externalMsgId: ev.msgId,
      });
    } catch (err) {
      logger.error(`[messenger-routes] failed to process msg mid=${ev.msgId}:`, err);
    }
  }
}

/** Tải attachment từ CDN FB → upload MinIO. Fail → trả null (tin vẫn persist, url FB gốc). */
async function rehostAttachment(url: string): Promise<{ url: string; mimeType: string; size: number } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') ?? 'application/octet-stream';
    const { uploadBuffer } = await import('../../../shared/storage/minio-client.js');
    const out = await uploadBuffer(buf, mime);
    return { url: out.url, mimeType: mime, size: out.size };
  } catch (err) {
    logger.warn('[messenger-routes] rehostAttachment failed:', err);
    return null;
  }
}

// Cache tên sender PSID — tránh fetch profile mỗi tin (rate limit Graph API)
const nameCache = new Map<string, { name: string; expiresAt: number }>();
const NAME_CACHE_TTL = 10 * 60_000;

async function resolveSenderName(channelAccountId: string, psid: string): Promise<string> {
  const key = `${channelAccountId}:${psid}`;
  const hit = nameCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.name;

  const row = await prisma.channelAccount.findUnique({ where: { id: channelAccountId } });
  if (!row?.accessTokenEnc) return '';
  const { decrypt } = await import('../../../shared/crypto/aes-gcm.js');
  const profile = await messengerProvider.fetchProfile(
    {
      id: row.id, orgId: row.orgId, provider: row.provider, externalId: row.externalId,
      displayName: row.displayName, accessToken: decrypt(row.accessTokenEnc), status: row.status,
    },
    psid,
  );
  const name = profile?.fullName ?? '';
  if (name) nameCache.set(key, { name, expiresAt: Date.now() + NAME_CACHE_TTL });
  return name;
}
