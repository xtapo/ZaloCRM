/**
 * messenger-webhook.test.ts — Unit tests cho Messenger channel (2026-08-26).
 *
 * Cover: challenge verify, HMAC X-Hub-Signature-256, payload extraction,
 * 24h messaging window gate, capabilities matrix. Không mock DB — chỉ test
 * pure functions của messenger-webhook-service.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: {} }));
vi.mock('../../src/shared/utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  verifyChallenge,
  verifyMessengerSignature,
  extractPageMessagingEvents,
} from '../../src/modules/channels/messenger/messenger-webhook-service.js';
import {
  MESSENGER_CAPABILITIES,
  messengerProvider,
} from '../../src/modules/channels/messenger/messenger-provider.js';

const TEST_SECRET = 'test-app-secret';
const TEST_VERIFY_TOKEN = 'test-verify-token';

describe('Messenger webhook verification', () => {
  beforeAll(() => {
    process.env.FB_APP_SECRET = TEST_SECRET;
    process.env.MESSENGER_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
  });
  afterAll(() => {
    delete process.env.FB_APP_SECRET;
    delete process.env.MESSENGER_VERIFY_TOKEN;
  });

  describe('verifyChallenge (GET /webhook)', () => {
    it('trả hub.challenge khi mode=subscribe và token khớp', () => {
      const result = verifyChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': TEST_VERIFY_TOKEN,
        'hub.challenge': 'CHALLENGE_123',
      });
      expect(result).toBe('CHALLENGE_123');
    });

    it('từ chối khi verify_token sai', () => {
      const result = verifyChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'CHALLENGE_123',
      });
      expect(result).toBeNull();
    });

    it('từ chối khi hub.mode không phải subscribe', () => {
      const result = verifyChallenge({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': TEST_VERIFY_TOKEN,
        'hub.challenge': 'CHALLENGE_123',
      });
      expect(result).toBeNull();
    });

    it('từ chối tất cả khi MESSENGER_VERIFY_TOKEN chưa set', () => {
      delete process.env.MESSENGER_VERIFY_TOKEN;
      const result = verifyChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': '',
        'hub.challenge': 'CHALLENGE_123',
      });
      expect(result).toBeNull();
      // restore cho các test sau
      process.env.MESSENGER_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
    });
  });

  describe('verifyMessengerSignature (POST /webhook HMAC)', () => {
    const body = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));

    it('chấp nhận signature hợp lệ sha256=<hex>', () => {
      const sig = 'sha256=' + createHmac('sha256', TEST_SECRET).update(body).digest('hex');
      expect(verifyMessengerSignature(body, sig)).toBe(true);
    });

    it('từ chối signature sai (body khác)', () => {
      const otherBody = Buffer.from('{"object":"user"}');
      const sig = 'sha256=' + createHmac('sha256', TEST_SECRET).update(otherBody).digest('hex');
      expect(verifyMessengerSignature(body, sig)).toBe(false);
    });

    it('từ chối khi thiếu header signature', () => {
      expect(verifyMessengerSignature(body, undefined)).toBe(false);
    });

    it('từ chối header không có prefix "sha256="', () => {
      const hex = createHmac('sha256', TEST_SECRET).update(body).digest('hex');
      expect(verifyMessengerSignature(body, hex)).toBe(false); // thiếu prefix
      expect(verifyMessengerSignature(body, `md5=${hex}`)).toBe(false);
    });

    it('timing-safe: hex sai độ dài → false không crash', () => {
      expect(verifyMessengerSignature(body, 'sha256=abcd')).toBe(false);
    });

    it('từ chối tất cả khi FB_APP_SECRET chưa set (fail-closed)', () => {
      delete process.env.FB_APP_SECRET;
      const body2 = Buffer.from('{}');
      const sig = 'sha256=' + createHmac('sha256', TEST_SECRET).update(body2).digest('hex');
      expect(verifyMessengerSignature(body2, sig)).toBe(false);
      process.env.FB_APP_SECRET = TEST_SECRET;
    });
  });

  describe('extractPageMessagingEvents', () => {
    it('extract entry hợp lệ object=page', () => {
      const events = [{ sender: { id: 'PSID1' }, recipient: { id: 'PAGE1' }, message: { mid: 'm.1', text: 'hi' } }];
      const body = { object: 'page', entry: [{ id: 'PAGE1', messaging: events }] };
      const parsed = extractPageMessagingEvents(body);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].pageId).toBe('PAGE1');
      expect(parsed[0].events).toEqual(events);
    });

    it('bỏ qua object không phải page (vd: instagram)', () => {
      const body = { object: 'instagram', entry: [{ id: 'X', messaging: [{}] }] };
      expect(extractPageMessagingEvents(body)).toEqual([]);
    });

    it('bỏ qua entry không có messaging hoặc rỗng', () => {
      const body = {
        object: 'page',
        entry: [
          { id: 'P1' },                       // không có messaging
          { id: 'P2', messaging: [] },        // messaging rỗng
          { id: 'P3', messaging: [{ read: { watermark: 1 } }] }, // hợp lệ (read event)
        ],
      };
      const parsed = extractPageMessagingEvents(body);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].pageId).toBe('P3');
    });

    it('body garbage → [] không crash', () => {
      expect(extractPageMessagingEvents(null)).toEqual([]);
      expect(extractPageMessagingEvents('string')).toEqual([]);
      expect(extractPageMessagingEvents({})).toEqual([]);
    });
  });
});

describe('Messenger capabilities matrix (MVP scope)', () => {
  it('MVP: text + image + file + voice bật; video/sticker/undo/reactions/edit tắt', () => {
    expect(MESSENGER_CAPABILITIES.text).toBe(true);
    expect(MESSENGER_CAPABILITIES.image).toBe(true);
    expect(MESSENGER_CAPABILITIES.file).toBe(true);
    expect(MESSENGER_CAPABILITIES.voice).toBe(true);

    expect(MESSENGER_CAPABILITIES.video).toBe(false);
    expect(MESSENGER_CAPABILITIES.sticker).toBe(false);
    expect(MESSENGER_CAPABILITIES.undo).toBe(false);
    expect(MESSENGER_CAPABILITIES.reactions).toBe(false);
    expect(MESSENGER_CAPABILITIES.editMessage).toBe(false);

    // Inbox features
    expect(MESSENGER_CAPABILITIES.quoteReply).toBe(true);
    expect(MESSENGER_CAPABILITIES.typingIndicator).toBe(true);
    expect(MESSENGER_CAPABILITIES.readReceipts).toBe(true);
    expect(MESSENGER_CAPABILITIES.groupThreads).toBe(false);
  });
});

describe('Messenger 24h messaging window (canSendMessage)', () => {
  it('chặn khi chưa từng nhận tin từ khách', () => {
    const r = messengerProvider.canSendMessage(null);
    expect(r.allowed).toBe(false);
  });

  it('cho phép khi tin cuối của khách < 24h', () => {
    const r = messengerProvider.canSendMessage(new Date(Date.now() - 23 * 3_600_000));
    expect(r.allowed).toBe(true);
  });

  it('chặn khi quá 24h kể từ tin cuối', () => {
    const r = messengerProvider.canSendMessage(new Date(Date.now() - 25 * 3_600_000));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('24h');
  });

  it('biên: đúng 24h + 1 phút → chặn; 24h - 1 phút → cho', () => {
    expect(messengerProvider.canSendMessage(new Date(Date.now() - (24 * 60 + 1) * 60_000)).allowed).toBe(false);
    expect(messengerProvider.canSendMessage(new Date(Date.now() - (24 * 60 - 1) * 60_000)).allowed).toBe(true);
  });
});
