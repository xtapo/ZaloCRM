/**
 * use-notifications.ts — state singleton cho persistent notifications.
 *
 * Nguồn dữ liệu:
 *  - fetch ban đầu + poll 60s (fallback khi socket rớt) → GET /notifications
 *  - realtime: Socket.IO `notification:new` / `notification:resolved` qua room
 *    `user:<id>` (composable tự emit `user:join` trên connect/reconnect, cùng
 *    pattern với use-friend-socket.ts)
 * Actions: markRead(id), markAllRead() → PATCH/POST rồi cập nhật state local,
 * không cần refetch.
 */
import { ref } from 'vue';
import { io, type Socket } from 'socket.io-client';
import { onMounted, onUnmounted } from 'vue';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';
import { playNotificationSound } from '@/utils/notification-sound';

/** Prefs âm thanh — load 1 lần cùng fetch đầu, PUT settings cập nhật realtime. */
const soundEnabled = ref(true);

export interface NotificationItem {
  id: string;
  dedupeKey?: string; // payload socket trả dedupeKey, REST trả id của DB row
  type: string; // info | warning | error
  title: string;
  detail: string;
  priority: string;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

// Singleton — nhiều component mount (DefaultLayout/MobileLayout) share 1 nguồn.
const notifications = ref<NotificationItem[]>([]);
const unreadCount = ref(0);
let loading = false;

let socket: Socket | null = null;

function applySocketPatch(dedupeKey: string, patch: Partial<NotificationItem>): void {
  const idx = notifications.value.findIndex(
    (n) => n.id === dedupeKey || n.dedupeKey === dedupeKey,
  );
  if (idx === -1) {
    // Row mới chưa có trong list (fetch sau) — tăng badge để badge tức thì đúng hướng,
    // danh sách chi tiết sẽ khớp ở lần poll/fetch kế tiếp.
    if (patch.readAt === undefined) unreadCount.value++;
    return;
  }
  Object.assign(notifications.value[idx], patch);
  recountUnread();
}

function recountUnread(): void {
  unreadCount.value = notifications.value.filter((n) => !n.readAt).length;
}

function ensureSocket(): Socket {
  if (!socket) {
    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      const auth = useAuthStore();
      const userId = auth.user?.id;
      if (userId) socket!.emit('user:join', { userId });
    });

    socket.on('notification:new', (payload: NotificationItem) => {
      const key = payload.dedupeKey ?? payload.id;
      applySocketPatch(key, {
        ...payload,
        id: payload.dedupeKey ?? payload.id,
        readAt: null,
        createdAt: payload.createdAt ?? new Date().toISOString(),
      });
      if (soundEnabled.value) playNotificationSound();
    });

    socket.on('notification:resolved', (payload: { id: string }) => {
      const idx = notifications.value.findIndex(
        (n) => n.id === payload.id || n.dedupeKey === payload.id,
      );
      if (idx !== -1) {
        notifications.value.splice(idx, 1);
        recountUnread();
      }
    });
  }
  return socket;
}

let soundPrefsLoaded = false;

async function fetchNotifications(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    // Lấy prefs âm thanh 1 lần đầu session để biết bật/tắt chuông.
    if (!soundPrefsLoaded) {
      soundPrefsLoaded = true;
      try {
        const p = await api.get('/notifications/preferences');
        soundEnabled.value = p.data.sound !== false;
      } catch {
        // lỗi prefs → giữ mặc định bật
      }
    }
    const res = await api.get('/notifications');
    notifications.value = res.data.notifications || [];
    unreadCount.value = res.data.unreadCount ?? notifications.value.filter((n) => !n.readAt).length;
  } catch {
    // silently ignore fetch errors — giữ state cũ
  } finally {
    loading = false;
  }
}

/** Settings page gọi sau khi lưu để composable phản ánh ngay không cần reload. */
export function setSoundEnabled(on: boolean): void {
  soundEnabled.value = on;
}

async function markRead(item: NotificationItem): Promise<void> {
  if (item.readAt) return;
  item.readAt = new Date().toISOString();
  recountUnread();
  try {
    await api.patch(`/notifications/${item.id}/read`);
  } catch {
    // rollback nếu server từ chối
    item.readAt = null;
    recountUnread();
  }
}

async function markAllRead(): Promise<void> {
  const prev = notifications.value.map((n) => n.readAt);
  notifications.value.forEach((n) => {
    if (!n.readAt) n.readAt = new Date().toISOString();
  });
  recountUnread();
  try {
    await api.post('/notifications/read-all');
  } catch {
    notifications.value.forEach((n, i) => {
      n.readAt = prev[i];
    });
    recountUnread();
  }
}

/**
 * Mount vào component layout: init socket subscribe + fetch đầu tiên + poll fallback.
 * Trả về các action để template dùng.
 */
export function useNotifications() {
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    ensureSocket();
    fetchNotifications();
    pollTimer = setInterval(fetchNotifications, 60_000);
  });

  onUnmounted(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  return { notifications, unreadCount, soundEnabled, fetchNotifications, markRead, markAllRead };
}
