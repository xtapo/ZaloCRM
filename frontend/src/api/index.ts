import axios from 'axios';
import { router } from '@/router/index';
import { useToast } from '@/composables/use-toast';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
  },
});

/**
 * Fix 2026-08-14 — "lỗi im lặng".
 *
 * Rất nhiều call site chỉ `console.error(...)` khi request fail:
 *   - `ContactsView.goChat()` → catch chỉ log + toast chung chung, và KHÔNG toast gì
 *     khi response 2xx nhưng thiếu `conversationId`.
 *   - `use-chat.selectConversation()` → `console.error('Failed to load conversation
 *     detail for deep-link:', err)`; `fetchMessages()` / `mark-read` cũng swallow.
 *
 * Hậu quả: khi backend trả 403 `ZALO_SCOPE_FORBIDDEN` / `PRIVACY_LOCKED` (hoặc
 * `CSRF_FAILED`), URL vẫn đổi sang /chat/:convId nhưng khung chat trắng và user
 * không hề biết vì sao → bug "bấm Mở chat không được" ở mục Khách hàng.
 *
 * Interceptor này nổi thông báo của server lên toast, xử lý 1 chỗ cho toàn app.
 * Chỉ bắt các status mà view thường KHÔNG tự xử lý (403 / 429 / 5xx / lỗi mạng) để
 * không double-toast với các view đã có thông báo riêng (400/404/409...).
 * Request nào muốn tự xử lý thì truyền `{ skipErrorToast: true }` trong axios config.
 */
const TOAST_DEDUPE_MS = 4000;
const recentToasts = new Map<string, number>();

function toastOnce(message: string) {
  const now = Date.now();
  const last = recentToasts.get(message);
  if (last && now - last < TOAST_DEDUPE_MS) return;
  recentToasts.set(message, now);
  for (const [msg, at] of recentToasts) {
    if (now - at > TOAST_DEDUPE_MS) recentToasts.delete(msg);
  }
  useToast().error(message, 4000);
}

function errorMessageFor(error: any): string | null {
  const status: number | undefined = error?.response?.status;
  const data = error?.response?.data as
    | { error?: string; message?: string; code?: string; detail?: string }
    | undefined;

  // Không có response → lỗi mạng / timeout / request bị cancel
  if (!status) {
    if (error?.code === 'ERR_CANCELED') return null;
    if (error?.code === 'ECONNABORTED') return 'Server phản hồi quá lâu — vui lòng thử lại';
    return 'Mất kết nối tới server — kiểm tra mạng rồi thử lại';
  }

  if (data?.code === 'CSRF_FAILED') {
    return 'Phiên đăng nhập hết hiệu lực — vui lòng tải lại trang (F5)';
  }

  const serverMessage =
    (typeof data?.error === 'string' && data.error.trim()) ||
    (typeof data?.message === 'string' && data.message.trim()) ||
    '';

  if (status === 403) {
    // ZALO_SCOPE_FORBIDDEN / PRIVACY_LOCKED — server đã có message tiếng Việt rõ ràng
    return serverMessage || 'Bạn không có quyền thực hiện thao tác này';
  }
  if (status === 429) {
    return serverMessage || 'Thao tác quá nhanh — vui lòng chờ vài giây rồi thử lại';
  }
  if (status >= 500) {
    return serverMessage || 'Server đang gặp sự cố — vui lòng thử lại sau';
  }
  return null;
}

// Response interceptor — handle 401 + nổi lỗi server lên toast
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // fire-and-forget logout to clear cookie
      axios.post('/api/v1/auth/logout', {}, { withCredentials: true }).catch(() => {});
      // Use Vue Router instead of hard reload to prevent redirect loops
      const currentPath = router.currentRoute.value.path;
      if (currentPath !== '/login' && currentPath !== '/setup') {
        router.replace('/login');
      }
      return Promise.reject(error);
    }

    if (!(error.config as any)?.skipErrorToast) {
      const message = errorMessageFor(error);
      if (message) toastOnce(message);
    }

    return Promise.reject(error);
  },
);

export { api };
