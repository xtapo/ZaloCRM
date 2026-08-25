# Kế hoạch: Nâng cấp quản lý Nhóm Zalo (4 tính năng)

Ngày: 2026-08-25

## Bối cảnh

Trang `/groups` ([GroupsView.vue](../frontend/src/views/GroupsView.vue)) đã có sẵn thao tác native Zalo:
tạo/xoá/đổi tên nhóm, thêm/bớt thành viên, phó nhóm, chặn thành viên, link mời, bình chọn.
Backend tương ứng: [group-routes.ts](../backend/src/modules/zalo/group-routes.ts),
[group-moderation-routes.ts](../backend/src/modules/zalo/group-moderation-routes.ts),
các hàm wrapper trong `shared/zalo-operations.ts`.

**Điểm yếu hiện tại:** nhóm chỉ là dữ liệu live từ Zalo API (`getAllGroups`) — không có bản ghi
CRM nào gắn với nhóm, nên không thể tag, ghi chú, phân công, hay thống kê theo nhóm.

## Tính năng 1 — Tag / Ghi chú / Tên CRM cho nhóm

### Backend

**Model mới `GroupCrmProfile`** trong `backend/prisma/schema.prisma`:

```prisma
model GroupCrmProfile {
  id              String   @id @default(uuid())
  orgId           String   @map("org_id")
  zaloAccountId   String   @map("zalo_account_id")
  externalGroupId String   @map("external_group_id") // groupId phía Zalo
  crmName         String?  @map("crm_name")          // tên hiển thị riêng của CRM, ưu tiên hơn tên Zalo
  notes           String?                            // ghi chú tự do về nhóm
  tags            Json     @default("[]")            // ["vip","bds-q7",...]
  assignedUserId  String?  @map("assigned_user_id")  // nhân viên phụ trách (tính năng 3)
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  org         Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  zaloAccount ZaloAccount  @relation(fields: [zaloAccountId], references: [id], onDelete: Cascade)
  assignedUser User?       @relation("AssignedGroupProfiles", fields: [assignedUserId], references: [id], onDelete: SetNull)

  @@unique([zaloAccountId, externalGroupId])
  @@index([orgId, assignedUserId])
  @@map("group_crm_profiles")
}
```

(+ relation ngược ở `Organization`, `ZaloAccount`, `User`; migration `prisma migrate dev`.)

**Routes mới** `backend/src/modules/zalo/group-crm-routes.ts` (đăng ký trong app.ts cạnh group-routes):

- `GET /api/v1/zalo-accounts/:accountId/groups/crm-profiles` — trả tất cả profile của account (FE merge vào danh sách nhóm theo groupId).
- `PUT /api/v1/zalo-accounts/:accountId/groups/:groupId/crm-profile` — upsert `{crmName?, notes?, tags?, assignedUserId?}` (upsert theo unique key). Ghi `ActivityLog` action `group.assign` / `group.update_tags` để ra timeline.
- Quyền: GET dùng `checkAccess(read)`, PUT dùng `checkAccess(admin)` — giống pattern các route nhóm hiện có.

### Frontend

- `composables/use-groups.ts`: thêm `fetchCrmProfiles(accountId)`, `saveCrmProfile(accountId, groupId, payload)`; merge profile vào `groups.value` khi load (key `externalGroupId`).
- Component mới `components/groups/group-crm-dialog.vue`: form sửa tên CRM, ghi chú, chọn tags (chip input), chọn nhân viên phụ trách (danh sách user qua `use-users.ts` đã có).
- `group-list.vue`: hiện chip tag + avatar người phụ trách dưới tên nhóm; thêm ô tìm kiếm theo tên/tên CRM và filter chip theo tag.
- `group-detail-panel.vue`: header hiển thị tên CRM (fallback tên Zalo), tags, nút mở dialog CRM.
- Ưu tiên tên CRM ở cả [ConversationList.vue](../frontend/src/components/chat/ConversationList.vue) nếu conv có profile (optional, làm sau khi core xong).

## Tính năng 2 — Thống kê & hoạt động nhóm

Dữ liệu đã có sẵn trong bảng `Conversation` + `Message` (group conv đồng bộ qua listener +
[zalo-message-sync.ts](../backend/src/modules/zalo/zalo-message-sync.ts)).

### Backend

Endpoint mới trong `group-crm-routes.ts`:

- `GET /api/v1/zalo-accounts/:accountId/groups/stats`
  Trả per-group (join Conversation qua `externalThreadId = groupId, threadType='group'`):
  - tổng tin nhắn 7 ngày / 30 ngày (`prisma.message.groupBy` theo conversationId + sentAt)
  - `lastMessageAt`, `unreadCount`, `isReplied`
  - số thành viên hoạt động (distinct `senderUid` trong 30 ngày, `senderType='contact'`)
  - top 5 thành viên nhắn nhiều nhất (groupBy senderUid + senderName)
  Phân loại: `active` (có tin ≤3 ngày), `quiet` (≤14 ngày), `silent` (>14 ngày).

- `GET /api/v1/zalo-accounts/:accountId/groups/:groupId/stats` — chi tiết 1 nhóm (top senders đầy đủ + biểu đồ theo ngày 14 ngày: groupBy date_trunc).

Query dùng `where.orgId` + kiểm tra `resolveAccount` + `checkAccess(read)` như mọi route khác.

### Frontend

- Composable `use-group-stats.ts`.
- Trong `GroupDetailPanel` thêm section **"Hoạt động"**: card tổng quan (tin 7 ngày, thành viên hoạt động, lần hoạt động cuối, trạng thái active/quiet/silent) + mini bar chart theo ngày + list top thành viên nhắn nhiều nhất (avatar + tên + số tin).
- Trong `GroupList` thêm sort "Hoạt động gần nhất" và badge trạng thái (chấm xanh = active, vàng = quiet, xám = silent).

## Tính năng 3 — Gán nhân viên phụ trách nhóm

Phần data đã nằm trong `GroupCrmProfile.assignedUserId` (tính năng 1). Bổ sung:

### Backend

- Trong `notification-routes.ts` thêm nguồn thông báo: các group conversation có
  `profile.assignedUserId == user.id` và `isReplied=false, lastMessageAt < 30 phút trước`
  → item "Nhóm X có tin nhắn mới chưa xử lý" với priority high. (Join qua
  `groupCrmProfiles` — cần lookup theo `(zaloAccountId, externalGroupId)`.)
- ActivityLog khi đổi người phụ trách (đã nói ở tính năng 1).
- Filter API: `GET /groups/crm-profiles?assignedUserId=me|<id>|none` để lọc.

### Frontend

- Trong `group-crm-dialog.vue` có select nhân viên (đã gồm ở trên).
- Trong `GroupList` filter nhanh "Nhóm của tôi" (assignedUserId == current user id từ auth store).
- Dashboard nhỏ trên toolbar GroupsView: "X nhóm đang chờ phản hồi" (count từ stats endpoint, chỉ tính nhóm mình phụ trách nếu user không phải admin).

## Tính năng 4 — Chat nhóm đồng bộ đầy đủ

Phần lớn đã hoạt động sẵn: listener bắt tin nhóm real-time ([zalo-listener-factory.ts](../backend/src/modules/zalo/zalo-listener-factory.ts)),
polling backfill 50 tin cũ, `ensure-conversation` để mở chat từ trang Nhóm, FilterRail có filter Nhóm/Cá nhân,
message-bubble hiển thị senderName + avatar gradient cho tin nhóm, @mention có sẵn.

Việc còn thiếu (kiểm chứng + vá):

1. **Kiểm thử E2E thủ công luồng**: tạo nhóm từ CRM → nhận tin → mở chat → trả lời → unread/replied cập nhật. Sửa lỗi phát hiện (nếu có).
2. **Tên CRM nhóm trong ChatView**: nếu nhóm có `GroupCrmProfile.crmName`, header chat + conversation list ưu tiên tên đó (fetch profile theo externalThreadId, cache trong use-chat).
3. **Badge nhóm trong chat list**: hiển thị tag/nhân viên phụ trách (tooltip) trên conv nhóm — tái dùng data profile đã merge ở tính năng 1.

## Thứ tự thực hiện

1. Schema + migration `GroupCrmProfile`
2. Backend `group-crm-routes.ts` (profiles + stats + filter) + đăng ký route + notifications
3. Unit/integration test cho routes mới (vitest, theo pattern `backend/tests`)
4. FE composable + dialog + list/detail UI (tính năng 1+3)
5. FE stats UI (tính năng 2)
6. Chat integration + kiểm thử luồng (tính năng 4)

## Kiểm chứng

- `cd backend && npm run typecheck && npm test`
- Migration chạy sạch trên DB dev (`npm run db:migrate`)
- FE: `npm run build` (vite) không lỗi type
- Thủ công: tạo profile, gán nhân viên, xem stats, nhận thông báo nhóm được giao
