/**
 * Unit tests cho notification-service (sync/list/mark) và notification-worker
 * (online-user discovery). prisma.notification mock in-memory; io giả lập qua
 * object rooms tối giản.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── prisma.notification in-memory delegate ─────────────────────────────────
// vi.mock được hoist lên đầu file → delegate phải tạo qua vi.hoisted.
const { notifDb, notificationDelegate } = (vi as any).hoisted(() => {
  const db: any[] = [];
  let n = 0;
  const nextId = () => `n${++n}`;
  const delegate = {
    findMany: vi.fn(async ({ where }: any) => {
      let rows = db.filter(
        (r) => r.userId === where.userId && (where.resolvedAt === null ? r.resolvedAt === null : true),
      );
      if (where.readAt === null) rows = rows.filter((r) => r.readAt === null);
      return rows.map((r) => ({ ...r }));
    }),
    create: vi.fn(async ({ data }: any) => {
      const row = { id: nextId(), readAt: null, resolvedAt: null, link: null, ...data };
      db.push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = db.find((r) => r.id === where.id);
      Object.assign(row, data);
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of db) {
        if (where.id?.in && !where.id.in.includes(row.id)) continue;
        if (typeof where.id === 'string' && row.id !== where.id) continue;
        if (where.userId !== undefined && row.userId !== where.userId) continue;
        if (where.resolvedAt === null && row.resolvedAt !== null) continue;
        if (where.readAt === null && row.readAt !== null) continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    }),
    count: vi.fn(async ({ where }: any) =>
      db.filter((r) => r.userId === where.userId && r.resolvedAt === null && r.readAt === null)
        .length,
    ),
  };
  return { notifDb: db, notificationDelegate: delegate };
});

function resetDb(): void {
  notifDb.length = 0;
}

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: { notification: notificationDelegate },
}));
vi.mock('../src/modules/notifications/compute-notifications.js', () => ({
  computeNotifications: vi.fn().mockResolvedValue([]),
  ZALO_ALERT_THRESHOLD_MS: 15 * 60 * 1000,
}));

// Bắt emit để assert room + event
const emitted: Array<{ room: string; event: string; payload: any }> = [];

function makeIo(): any {
  return {
    to(room: string) {
      return {
        emit(event: string, payload: any) {
          emitted.push({ room, event, payload });
        },
      };
    },
    of: () => ({ rooms: new Map() }),
  };
}

import {
  syncNotifications,
  listNotifications,
  markRead,
  markAllRead,
  unreadCount,
  setNotificationIO,
} from '../src/modules/notifications/notification-service.js';
import { getOnlineUserIds } from '../src/modules/notifications/notification-worker.js';

const user = { id: 'u1', orgId: 'o1', role: 'member' };

describe('notification-service syncNotifications', () => {
  beforeEach(() => {
    resetDb();
    emitted.length = 0;
    setNotificationIO(makeIo());
    vi.clearAllMocks();
  });

  it('item mới -> insert + emit notification:new vào room user:<id>', async () => {
    const { inserted } = await syncNotifications(user, [
      { dedupeKey: 'unreplied', type: 'warning', priority: 'high', title: 'T', detail: 'D', link: '/chat' },
    ]);

    expect(inserted).toBe(1);
    expect(notifDb).toHaveLength(1);
    expect(notifDb[0].dedupeKey).toBe('unreplied');
    expect(notifDb[0].readAt).toBeNull();
    expect(emitted).toEqual([
      expect.objectContaining({ room: 'user:u1', event: 'notification:new' }),
    ]);
  });

  it('poll lại cùng nguồn -> không insert thêm, không emit', async () => {
    const items = [
      { dedupeKey: 'unreplied', type: 'warning', priority: 'high', title: 'T', detail: 'D' },
    ] as any[];
    await syncNotifications(user, items);
    const second = await syncNotifications(user, items);

    expect(second.inserted).toBe(0);
    expect(second.resolvedKeys).toHaveLength(0);
    expect(emitted).toHaveLength(1); // chỉ emit của lần đầu
    expect(notifDb).toHaveLength(1);
  });

  it('nội dung đổi -> update title/detail nhưng GIỮ readAt', async () => {
    await syncNotifications(user, [
      { dedupeKey: 'unreplied', type: 'warning', priority: 'high', title: '3 cuộc chưa trả lời', detail: 'D' },
    ]);
    await markAllRead('u1');
    expect(notifDb[0].readAt).not.toBeNull();

    await syncNotifications(user, [
      { dedupeKey: 'unreplied', type: 'warning', priority: 'high', title: '5 cuộc chưa trả lời', detail: 'D' },
    ]);

    expect(notifDb[0].title).toBe('5 cuộc chưa trả lời');
    expect(notifDb[0].readAt).not.toBeNull(); // đã đọc vẫn giữ nguyên
  });

  it('nguồn hết điều kiện -> resolvedAt + emit notification:resolved; khỏi danh sách active', async () => {
    await syncNotifications(user, [
      { dedupeKey: 'zalo-a1', type: 'error', priority: 'high', title: 'Nick rớt', detail: '' },
    ]);
    // Lần sau nick đã kết nối lại → compute rỗng
    const res = await syncNotifications(user, []);

    expect(res.resolvedKeys).toHaveLength(1);
    expect(notifDb[0].resolvedAt).not.toBeNull();
    expect(emitted.some((e) => e.event === 'notification:resolved')).toBe(true);

    const list = await listNotifications('u1', 'o1');
    expect(list).toHaveLength(0);
    expect(await unreadCount('u1')).toBe(0);
  });
});

describe('notification-service mark/list', () => {
  beforeEach(() => {
    resetDb();
    emitted.length = 0;
    setNotificationIO(makeIo());
    vi.clearAllMocks();
  });

  it('markRead chỉ tác động row của user đó', async () => {
    await syncNotifications(user, [
      { dedupeKey: 'k1', type: 'info', priority: 'low', title: 'A', detail: '' },
    ]);
    const otherUser = { id: 'u2', orgId: 'o1', role: 'member' };
    await syncNotifications(otherUser, [
      { dedupeKey: 'k1', type: 'info', priority: 'low', title: 'A', detail: '' },
    ]);

    const mine = await listNotifications('u1', 'o1');
    expect(await markRead('u1', mine[0].id)).toBe(true);

    // u2 vẫn unread
    expect(await unreadCount('u2')).toBe(1);
    expect(await unreadCount('u1')).toBe(0);
  });

  it('markRead id không tồn tại/không thuộc user -> false, không lỗi', async () => {
    expect(await markRead('u1', 'nope')).toBe(false);
  });

  it('markAllRead -> tất cả active đọc; item resolve sau đó vẫn giữ readAt cũ', async () => {
    await syncNotifications(user, [
      { dedupeKey: 'k1', type: 'info', priority: 'low', title: 'A', detail: '' },
      { dedupeKey: 'k2', type: 'warning', priority: 'high', title: 'B', detail: '' },
    ]);

    expect(await markAllRead('u1')).toBe(2);

    // k2 hết điều kiện → resolved; k1 vẫn active
    await syncNotifications(user, [
      { dedupeKey: 'k1', type: 'info', priority: 'low', title: 'A', detail: '' },
    ]);
    const list = await listNotifications('u1', 'o1');
    expect(list).toHaveLength(1);
    expect(list[0].dedupeKey).toBe('k1');
    expect(list[0].readAt).not.toBeNull();
  });

  it('list sort: unread trước, rồi priority, rồi mới nhất', async () => {
    const old = new Date('2026-08-20T00:00:00Z');
    const recent = new Date('2026-08-25T00:00:00Z');
    await syncNotifications(user, [
      { dedupeKey: 'low-old', type: 'info', priority: 'low', title: 'L', detail: '', createdAt: old },
      { dedupeKey: 'high-recent', type: 'error', priority: 'high', title: 'H', detail: '', createdAt: recent },
      { dedupeKey: 'med', type: 'warning', priority: 'medium', title: 'M', detail: '', createdAt: recent },
    ]);

    // Đọc item high → phải tụt xuống dưới các unread
    const before = await listNotifications('u1', 'o1');
    expect(before.map((n) => n.dedupeKey)).toEqual(['high-recent', 'med', 'low-old']);

    await markRead('u1', before[0].id);
    const after = await listNotifications('u1', 'o1');
    expect(after.map((n) => n.dedupeKey)).toEqual(['med', 'low-old', 'high-recent']);
  });
});

describe('notification-worker getOnlineUserIds', () => {
  it('gom room user:* thành tập userId duy nhất, bỏ org:/account:', () => {
    const fakeIo: any = {
      of: () => ({
        adapter: {
          rooms: new Map<string, Set<string>>([
            ['user:u1', new Set(['s1', 's3'])], // 2 socket cùng user
            ['user:u2', new Set(['s2'])],
            ['org:o1', new Set(['s1'])],
            ['account:a1', new Set(['s2'])],
          ]),
        },
      }),
    };
    expect(getOnlineUserIds(fakeIo)).toEqual(new Set(['u1', 'u2']));
  });
});
