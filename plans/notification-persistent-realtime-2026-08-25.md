# Kế hoạch: Thông báo Persistent + Read/Unread + Realtime Socket.IO

Ngày: 2026-08-25 · Phạm vi chốt với anh: **persistent + đã đọc**, **push realtime qua Socket.IO** (không làm trang preferences/email trong đợt này).

## Vấn đề hiện tại

- `GET /api/v1/notifications` ([notification-routes.ts](../backend/src/modules/notifications/notification-routes.ts)) tính **on-the-fly** 6 nguồn → không lưu được trạng thái đã đọc, mỗi lần poll danh sách render lại, không thể "đánh dấu tất cả".
- FE [NotificationBell.vue](../frontend/src/components/NotificationBell.vue) poll 60s, badge đếm tổng số item (không phải chưa đọc).
- Schema **chưa có** model `Notification`. Hạ tầng Socket.IO sẵn: room `org:<id>` / `account:<id>` (zalo-socket.ts), privacy guard bọc mọi emit (socket-privacy.ts), pattern composable `use-*-socket.ts` ở FE.

## Thiết kế

### 1. Schema — model `Notification` (Prisma + migration)

```
model Notification {
  id         String    @id @default(uuid())
  orgId      String    @map("org_id")
  userId     String    @map("user_id")            // người NHẬN
  dedupeKey  String    @map("dedupe_key")         // id tất định hiện có: "unreplied", "apt-<id>", "zalo-<accId>", "sec-<action>-<stamp>", "group-pending-<convId>"
  type       String    // info | warning | error
  priority   String    // high | medium | low
  title      String
  detail     String
  link       String?                              // route FE điều hướng khi click (thay if-chain handleClick)
  readAt     DateTime? @map("read_at")
  resolvedAt DateTime? @map("resolved_at")        // điều kiện nguồn không còn đúng → ẩn khỏi danh sách
  createdAt  DateTime  @default(now()) @map("created_at")

  @@unique([userId, dedupeKey])
  @@index([orgId, userId, resolvedAt, readAt])
  @@index([orgId, userId, createdAt(sort: Desc)])
}
```

Migration: `backend/prisma/migrations/20260825030000_add_notifications/`.

### 2. Backend — tách compute & thêm sync-to-DB

**File mới `backend/src/modules/notifications/compute-notifications.ts`**
- Chuyển nguyên logic 6 nguồn từ route handler vào hàm thuần `computeNotifications(user): Promise<Omit<NotificationItem,'id'> & { dedupeKey, link }[]>`.
- Route hiện tại giữ nguyên hành vi (test cũ vẫn pass) nhưng gọi qua đây.

**File mới `backend/src/modules/notifications/notification-service.ts`**
- `syncNotifications(user, computed)`: upsert theo `(userId, dedupeKey)` — row mới → insert; row đã có → cập nhật title/detail nếu đổi; item trong DB **không còn** trong kết quả compute → set `resolvedAt` (ẩn, KHÔNG xoá — giữ lịch sử); `readAt` luôn được bảo toàn.
- `listNotifications(userId)`: lấy `resolvedAt = null`, sort unread-first rồi createdAt desc, take 50.
- `markRead(userId, id)`, `markAllRead(userId)`, `unreadCount(userId)`.
- Mỗi lần sync phát hiện row mới → emit `notification:new` vào room `user:<userId>`; row resolve → emit `notification:resolved`.

**Sửa `notification-routes.ts`**
- `GET /api/v1/notifications`: compute → sync → trả danh sách đã persist kèm `unreadCount`.
- `PATCH /api/v1/notifications/:id/read` và `POST /api/v1/notifications/read-all` (auth middleware sẵn).

### 3. Realtime — room `user:<id>` + notification worker

**Sửa `backend/src/modules/zalo/zalo-socket.ts`**
- Thêm handler `user:join` (kiểm tra `data.userId === user.id`, tương tự guard của `org:join`) → `socket.join('user:<userId>')`.

**File mới `backend/src/modules/notifications/notification-worker.ts`**
- Interval 60s: lấy tập org đang có socket connect (đọc từ `io.of('/').adapter.rooms`, tiền tố `org:`) và các user thuộc org đó có socket trong `user:*` rooms → chạy compute+sync **chỉ cho user online** → emit diff tới room `user:<id>`.
- Đúng pattern cron sẵn có (interaction-cron, zalo-health-check): start/stop function, đăng ký trong `app.ts` bootstrap sau khi có `io`.
- FE giữ poll 60s làm fallback (reconnect/network blip), nhưng badge giờ cập nhật tức thì qua socket.

### 4. Frontend

**File mới `frontend/src/composables/use-notifications.ts`**
- Singleton state (pattern như use-friend-socket.ts): list + unreadCount, fetch ban đầu, subscribe `notification:new` / `notification:resolved`, action `markRead(id)`, `markAllRead()`, auto join `user:join` trên connect/reconnect.

**Viết lại `frontend/src/components/NotificationBell.vue`**
- Badge = `unreadCount` (không phải tổng).
- Item chưa đọc: nền nhấn màu + chấm; đã đọc: mờ.
- Click item → `markRead` + `router.push(n.link)`; nút "Đánh dấu tất cả đã đọc"; hiển thị thời gian tương đối.
- Dùng ở cả DefaultLayout lẫn MobileLayout (đã mount chung component nên tự hưởng).

### 5. Test

- Sửa `backend/tests/notification-routes.test.ts`: mock thêm `notification` delegate trong prisma-client mock; case mới — sync upsert giữ `readAt`, resolve khi điều kiện hết, read-all.
- File mới `backend/tests/notification-service.test.ts`: unit test sync logic (insert/resolve/preserve-readAt/dedupe).
- Case socket guard `user:join` sai userId bị chặn (theo pattern test zalo-socket nếu có).

## Thứ tự thực hiện

1. Schema + migration + regenerate client.
2. Tách `compute-notifications.ts` → route gọi lại, chạy test cũ pass.
3. `notification-service.ts` (sync/list/mark) + routes mới + tests.
4. Room `user:join` + notification-worker + emit diff.
5. FE composable + NotificationBell.
6. Chạy full test backend + build FE.

## Không làm trong đợt này

- Trang cài đặt bật/tắt từng nguồn thông báo (preferences) — đã chốt bỏ.
- Email/Zalo reminder ngoài app.
- Đổi các producer sự kiện (health-check…) thành writer trực tiếp — compute engine hiện tại là nguồn sự thật, tránh sửa lan nhiều module.
