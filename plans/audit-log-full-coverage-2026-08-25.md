# Kế hoạch: Bổ sung đầy đủ Audit Log

Ngày: 2026-08-25
Phạm vi (đã xác nhận với user): Đầy đủ tất cả · Middleware + thủ công kết hợp · Trang Audit Log admin đầy đủ · Lưu IP hash + user-agent

## Hiện trạng

Đã có:
- Model `ActivityLog` (schema.prisma:797): actor user/bot/system, 10 category, `details Json` chứa diff
- Helper `logActivity()` fire-and-forget + `computeDiff()` (`backend/src/modules/activity/activity-logger.ts`)
- ~49 điểm gọi log ở contacts/scoring/zalo-sync/chat-security-hooks
- Trang per-customer (`CustomerActivityLogView`) + trang Security Events (`SecurityEventsView`)
- RBAC resource `audit_log` với action `access`/`view_all`; nav Settings có sẵn slot `/settings/org/audit` nhưng đang trỏ `SettingsComingSoon`
- Pattern hash IP có sẵn: `hashIp()` sha256 slice 32 (`privacy/pin-service.ts:28`), field pattern `ipHash`/`ip_hash`

Lỗ hổng:
1. Auth module không log gì (login, sai mật khẩu, đổi mật khẩu, logout)
2. RBAC/user-management/campaign/automation/integrations/zalo-credentials: 0 lần gọi logActivity
3. Không có API + trang Audit Log toàn tổ chức (permission `audit_log.view_all` chưa được dùng)
4. Không lưu IP/user-agent vào bản ghi audit

## Phase 1 — Schema + hạ tầng ghi log

### 1a. Migration Prisma `20260825020000_add_audit_ip_and_indexes`
Sửa model `ActivityLog`:
- Thêm `ipHash String? @map("ip_hash")` — sha256(ip).slice(0,32), chống PII leak vẫn trace cross-user được
- Thêm `userAgent String? @map("user_agent")`
- Thêm index `@@index([orgId, createdAt(sort: Desc)])` — phục vụ listing toàn tổ chức của trang Audit Log

### 1b. Mở rộng `action-types.ts`
Thêm 2 category mới:
- `'auth'` — đăng nhập/đăng xuất/mật khẩu/token
- `'admin'` — mutation quản trị (user, role, permission group, department, campaign, automation, integration, zalo credentials)

Thêm actions mới vào `ACTION_CATEGORY`:
```
// auth
auth_login, auth_login_failed, auth_logout, auth_setup,
password_change_self, password_change_by_admin, account_locked,
// admin
user_create, user_update, user_delete,
permission_group_create, permission_group_update, permission_group_delete,
user_assign_permission_group,
department_create, department_update, department_delete,
department_member_add, department_member_remove,
campaign_create, campaign_update, campaign_delete, campaign_send, campaign_cancel,
automation_rule_create, automation_rule_update, automation_rule_delete,
integration_update, integration_delete,
zalo_account_connect, zalo_account_disconnect,
```

### 1c. Mở rộng `activity-logger.ts`
- `LogActivityInput` thêm `ipHash?: string | null`, `userAgent?: string | null`
- Helper mới `auditContext(request)` — extract từ Fastify request: `ipHash` (sha256 qua `request.ip`, tái dùng pattern `hashIp`), `userAgent` (header `user-agent`, cắt 255 ký tự)
- Giữ nguyên contract fire-and-forget

## Phase 2 — Auto-log middleware (phủ lưới toàn bộ)

File mới `backend/src/modules/activity/audit-middleware.ts`:
- Fastify plugin `onResponse` hook: với mọi request thành công (2xx/3xx) method POST/PUT/PATCH/DELETE trên `/api/v1/**`
- Derive action: `<resource>_<http_method>` (vd `contacts_post`), resource = segment đầu sau `/api/v1/`
- Ghi `entityType` = resource, `entityId` = param `:id` nếu path khớp pattern `/:uuid`
- **Skip-list** để tránh spam (đã log thủ công chi tiết hoặc là high-frequency):
  - `/api/v1/auth/*` (log thủ công Phase 3 với ngữ nghĩa riêng)
  - `/api/v1/messages*`, `/api/v1/chat/*` (tin nhắn — quá tần suất cao, đã có message audit riêng)
  - `/api/v1/webhooks/*`, `/api/v1/public/*` (caller không phải user đã auth)
  - Path nào trùng action thủ công thì middleware bỏ qua qua cờ `res.getHeader('x-audit-logged')` do logActivity thủ công set — tránh double-log
- Chỉ chạy khi `request.user` tồn tại (sau authMiddleware); actor lấy từ JWT

## Phase 3 — Log thủ công chi tiết (diff + ngữ nghĩa)

Gọi `logActivity(auditContext(req) + ...)` tại:

1. **auth-routes.ts**: `auth_setup` (org khởi tạo), `auth_login`, `auth_login_failed` (details.reason), `auth_logout`
2. **user-routes.ts**: `user_create`/`user_update` (computeDiff fullName/email/role/status)/`user_delete`/`password_change_by_admin`/max-privacy-nicks
3. **rbac/permission-group-routes.ts**: create/update/delete + diff permissions JSON (chỉ log keys đổi, không log toàn bộ ma trận)
4. **rbac/user-assignment-routes.ts**: `user_assign_permission_group` (old/new group)
5. **rbac/department-routes.ts**: CRUD + member add/remove
6. **campaign-routes.ts/service**: create/update/delete/send/cancel
7. **zalo/credential-routes.ts**: connect/disconnect (không log token, chỉ log sự kiện + accountId)
8. **integrations/integration-routes.ts**: update/delete config (redact `config.credentials`)
9. **automation-routes.ts** + sequences/triggers/broadcasts: chỉ dựa vào middleware auto-log (đủ vì đây là CRUD thuần)

## Phase 4 — API Audit Log toàn tổ chức

File mới `backend/src/modules/activity/audit-log-routes.ts`:

1. `GET /api/v1/audit-logs`
   - Gate: `requireGrant('audit_log', 'view_all')` (owner/admin mặc định có theo matrix permission-types.ts:237)
   - Filter: `users` (csv userId), `categories`, `actions`, `actorTypes`, `from`, `to`, `search` (contains trên action + details), `entityType`/`entityId`
   - Pagination composite cursor `<ISO>|<id>` DESC (theo mẫu security-events-routes.ts:99)
   - Include user {id, fullName, email}; trả kèm `nextCursor`
   - Trả thêm meta: distinct users + categories cho filter dropdown (query riêng, cache nhẹ in-memory 60s)
2. `GET /api/v1/audit-logs/export` — CSV, cap 10K rows, format theo mẫu timeline-routes.ts:283 (BOM UTF-8, escape quotes)
3. Register trong `app.ts` cạnh securityEventsRoutes

Tests mới `backend/tests/audit-log-routes.test.ts` — theo pattern có sẵn trong `backend/tests/notification-routes.test.ts` (mock prisma/authMiddleware): filter đúng orgId, gate 403 khi thiếu grant, cursor pagination, CSV export, skip-list của middleware.

## Phase 5 — Frontend trang Audit Log

1. Composable mới `frontend/src/composables/use-audit-logs.ts`:
   - State: items, nextCursor, filters (preset thời gian theo mẫu SecurityEventsView, users, categories, search), loading
   - Methods: fetch(reset), loadMore, exportCsv (window.open endpoint export với query hiện tại)
2. View mới `frontend/src/views/settings/AuditLogView.vue` — bố cục theo đúng pattern SecurityEventsView.vue (header + stat cards + filter sidebar + bảng):
   - Stat cards: tổng sự kiện khoảng thời gian, số user hoạt động, số login failed, số thay đổi quyền
   - Filter sidebar: preset thời gian (Hôm nay/7 ngày/30 ngày/Tùy chỉnh), multi-select nhân viên (fetch `/api/v1/users`), chip category, ô search
   - Bảng: Thời gian · Actor (avatar tên + badge user/bot/system) · Hành động (label tiếng Việt + icon theo category) · Đối tượng (entityType + link nếu contact) · Chi tiết (diff old→new render inline, click mở expand JSON)
   - Responsive: bảng scroll ngang trong container riêng
3. Router: đổi `/settings/org/audit` từ SettingsComingSoon → AuditLogView, meta roles ['owner','admin']
4. `use-settings-nav.ts`: bỏ `comingSoon: true` khỏi item `audit`
5. Constants label/icon category mới (`auth`, `admin`) đặt cạnh mapping UI hiện có

## Phase 6 — Verify

1. `npx prisma migrate dev` trong backend → migration áp dụng sạch
2. `npm run build` (tsc) backend + frontend type-check pass
3. Chạy test suite backend liên quan (audit-log-routes.test.ts + test hiện có không regress)

## Rủi ro & lưu ý

- **Volume**: middleware auto-log mọi mutation có thể phình bảng → skip-list chặn high-frequency paths; index `(orgId, createdAt DESC)` phủ query chính; KHÔNG log request body (chỉ path + id) ở tầng middleware để tránh PII
- **Double-log**: cờ header `x-audit-logged` giữa manual và middleware
- **Privacy**: IP hash không reversible; userAgent thô chấp nhận được (đã có precedent `UserSession.user_agent` schema:2063)
