/**
 * Unit tests cho incoming-message-notifier — đẩy thông báo tức thì khi tin nhắn
 * inbound persist. prisma.notification in-memory; các model phụ (conversation,
 * contact, user, zaloAccount) mock per-test qua hoisted delegates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { notifDb, notificationDelegate, dbState } = (vi as any).hoisted(() => {
  const db: any[] = [];
  let n = 0;
  const delegate = {
    findMany: vi.fn(async ({ where }: any) => {
      let rows = db.filter(
        (r) => r.userId === where.userId && (where.resolvedAt === null ? r.resolvedAt === null : true),
      );
      if (where.readAt === null) rows = rows.filter((r) => r.readAt === null);
      return rows.map((r) => ({ ...r }));
    }),
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `n${++n}`, readAt: null, resolvedAt: null, link: null, ...data };
      db.push(row);
      return { ...row };
    }),
    update: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 0 })),
    count: vi.fn(async () => 0),
  };
  return {
    notifDb: db,
    notificationDelegate: delegate,
    // Trạng thái "DB" của các model phụ — gán trong từng test.
    dbState: { conversation: null as any, contact: null as any, users: [] as any[], account: null as any },
  };
});

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    notification: notificationDelegate,
    conversation: {
      findUnique: vi.fn(async () => dbState.conversation),
    },
    contact: {
      findFirst: vi.fn(async () => dbState.contact),
    },
    user: {
      findMany: vi.fn(async () => dbState.users),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    zaloAccount: {
      findUnique: vi.fn(async () => dbState.account),
    },
  },
}));

import { notifyIncomingMessage } from '../src/modules/notifications/incoming-message-notifier.js';

function resetState(): void {
  notifDb.length = 0;
  dbState.conversation = null;
  dbState.contact = null;
  dbState.users = [];
  dbState.account = null;
}

describe('incoming-message-notifier', () => {
  beforeEach(() => resetState());

  const baseInput = {
    orgId: 'o1',
    conversationId: 'convA',
    messageId: 'msgX',
    content: 'Cho mình hỏi giá',
    contentType: 'text',
  };

  it('tạo notification cho owner nick + assigned contact với dedupeKey inmsg-<msgId>', async () => {
    dbState.conversation = { id: 'convA', threadType: 'user', zaloAccountId: 'acc1' };
    dbState.contact = { crmName: 'CRM Shop', fullName: 'Nguyễn A', assignedUserId: 'u-assign' };
    dbState.users = [{ id: 'u-admin' }]; // admin org
    dbState.account = { ownerUserId: 'u-owner' };

    await notifyIncomingMessage(baseInput);

    const recipients = notifDb.map((r) => r.userId).sort();
    expect(recipients).toEqual(['u-admin', 'u-assign', 'u-owner']);

    for (const row of notifDb) {
      expect(row.dedupeKey).toBe('inmsg-msgX');
      expect(row.title).toContain('CRM Shop'); // crmName ưu tiên trước fullName
      expect(row.detail).toBe('Cho mình hỏi giá');
      expect(row.link).toBe('/chat/convA'); // deep-link thẳng vào hội thoại
      expect(row.resolvedAt).toBeNull();
    }
  });

  it('bỏ qua hội thoại nhóm (threadType=group)', async () => {
    dbState.conversation = { id: 'convG', threadType: 'group', zaloAccountId: 'acc1' };

    await notifyIncomingMessage({ ...baseInput, conversationId: 'convG' });

    expect(notifDb.length).toBe(0);
  });

  it('bỏ qua khi không tìm thấy hội thoại', async () => {
    dbState.conversation = null;
    await notifyIncomingMessage(baseInput);
    expect(notifDb.length).toBe(0);
  });

  it('attachment rỗng content -> detail là [contentType]', async () => {
    dbState.conversation = { id: 'convA', threadType: 'user', zaloAccountId: 'acc1' };
    dbState.contact = null;
    dbState.users = [];
    dbState.account = { ownerUserId: 'u-owner' };

    await notifyIncomingMessage({ ...baseInput, content: '', contentType: 'image' });

    expect(notifDb.length).toBe(1);
    expect(notifDb[0].detail).toBe('[image]');
    expect(notifDb[0].title).toContain('Khách hàng'); // không có tên nào → fallback
  });

  it('prefs tắt nguồn incoming_message -> user đó KHÔNG nhận row', async () => {
    dbState.conversation = { id: 'convA', threadType: 'user', zaloAccountId: 'acc1' };
    dbState.contact = null;
    dbState.users = [{ id: 'u-admin' }];
    dbState.account = { ownerUserId: 'u-off' };

    // u-off tắt incoming_message; user.findUnique được notifier dùng để đọc prefs
    const { prisma } = await import('../src/shared/database/prisma-client.js');
    (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) =>
      where.id === 'u-off'
        ? { notificationPrefs: { sources: { incoming_message: false } } }
        : null,
    );

    await notifyIncomingMessage(baseInput);

    // Chỉ admin (không tắt) nhận row
    expect(notifDb.length).toBe(1);
    expect(notifDb[0].userId).toBe('u-admin');
  });
});
