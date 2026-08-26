# Phase 7 — Hướng dẫn test toàn bộ

Doc này hướng dẫn test toàn bộ module Bot-Auto Phase 7 (Block / Sequence /
Trigger / Broadcast / CustomerList) từ safest (DB-only) tới riskiest (Zalo SDK
gửi thật). Mục tiêu: validate engine không phá nick + không spam KH thật trước
khi sale dùng production.

> **Cập nhật 26/08/2026** — bổ sung test cho tính năng mới: A/B variant strategy
> (`random` / `even_split`), runtime rule `onBlockArchived` ('stop' | 'skip'),
> guard `uid_belongs_to_other_contact`, 3 action handler mới (`add_tag`,
> `remove_tag`, `assign_user`), 2 trigger mới (`stuck_lead`,
> `form_submission`) và endpoint performance `GET /blocks/:id/performance`.
> Xem Bước 12.

## ⚠️ Quy tắc trước khi test

1. **Bật STUB mode trước** — không gọi Zalo SDK thật, chỉ log:
   ```bash
   # docker-compose.yml service app environment:
   AUTOMATION_STUB_MODE: "true"
   ```
   ```bash
   docker compose up -d --force-recreate app
   ```

2. **Dùng nick test riêng** — không dùng nick chính. Lấy `id` từ
   `/settings/channels/zalo`.

3. **Dùng contact test** — đồng nghiệp / số mình, không phải KH thật.

4. **Set delay = 0** trong sequence để test nhanh (mặc định jitter 15-45p làm
   chậm). Vào sequence edit → "Cấu hình chạy" → `Delay ngẫu nhiên` = 0 → 0.

5. **Mở terminal monitor**:
   ```bash
   docker logs -f zalo-crm-app 2>&1 | grep -E "automation|task-worker|materializer|STUB|sent from"
   ```

---

## Bước 0 — Pre-flight (verify deploy)

```bash
# Engine alive?
docker logs zalo-crm-app --tail 50 | grep "automation.engine"
# Expect: [automation.engine] started — event bus + 6 action handlers + worker + cron

# Schema 8 bảng?
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c "\dt automation_* blocks block_folders customer_list*"
# Expect: blocks, block_folders, automation_broadcasts, _campaigns, _sequences,
#   _tasks, _triggers, _rules (legacy), customer_lists, customer_list_entries
```

---

## Bước 1 — Visual smoke test (UI load OK?)

Mở `http://localhost:3080` → đăng nhập → click 🤖 **Bot-Auto** trên top nav.

| Trang | Expected |
|---|---|
| `/automation/bot/triggers` Catalog | 13 card grouped theo category (thêm stuck_lead + form_submission) |
| `/automation/bot/triggers` Configured | Empty state + CTA "Xem catalog" |
| `/automation/bot/blocks` | Folder sidebar, empty state CTA "Tạo block đầu tiên" |
| `/automation/bot/sequences` | Sidebar trống, main pane "Chọn sequence" |
| `/automation/bot/broadcasts` | Placeholder "Phase F sẽ ship sau" |
| `/automation/bot/lists` | CustomerList view (đã ship 20/05) |

**Responsive (DevTools F12):**
- iPhone 12 (~390px): hamburger bar trên cùng → drawer slide từ trái
- iPad (~900px): sidebar thu thành 72px icon-only
- Desktop ≥1024px: sidebar full 240px

---

## Bước 2 — CRUD test (không hit Zalo)

### 2.1 Tạo Block "TEST update_status"

`/blocks` → **Tạo Block**:
| Field | Value |
|---|---|
| Tên | `TEST — đổi status` |
| Loại action | **Đổi trạng thái** |
| Đổi sang | Pick status có sẵn (vd "Tiếp cận") |

### 2.2 Tạo Sequence "TEST flow"

`/sequences` → **Sequence mới**:
- Tên: `TEST — update status flow`
- Thêm bước → pick Block 2.1 → delay 0
- Bật → Lưu

### 2.3 Tạo Trigger "TEST manual"

`/triggers` → Catalog → "Chạy thủ công theo segment" → **Khởi tạo**:
- Tên: `TEST — manual run`
- Bind sequence → pick "TEST — update status flow"
- ✅ Bật trigger

---

## Bước 3 — Engine smoke test (update_status REAL, không Zalo)

### 3.1 Lấy contactId

```bash
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT id, full_name, status_id FROM contacts ORDER BY created_at DESC LIMIT 5"
```

### 3.2 Manual run

Tab Configured → ▶ Play trên trigger TEST → nhập contactId → OK.

### 3.3 Watch log

```
[automation.event-bus] emit { type: 'manual_run', ... }
[materializer] event handled { campaigns: 1, tasks: 1 }
[task-worker] processing 1 tasks
[update-status] contact <id>: <old> → <new>
```

### 3.4 Verify DB

```bash
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT t.state, t.skip_reason, t.executed_at, b.action_type
 FROM automation_tasks t LEFT JOIN blocks b ON b.id=t.current_block_id
 ORDER BY t.created_at DESC LIMIT 3"
# Expect: state='done', executed_at có timestamp

docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT id, full_name, status_id FROM contacts WHERE id='<contactId>'"
# Expect: status_id = status mới
```

---

## Bước 4 — STUB mode: request_friend + send_message

Vẫn để `AUTOMATION_STUB_MODE=true`.

### 4.1 Tạo 2 block mới

**Block A — TEST kết bạn** (action: Gửi kết bạn):
- Greeting variants:
  - `Em chào anh/chị, em từ DA XYZ ạ`
  - `Xin chào, em được giới thiệu anh/chị`

**Block B — TEST gửi tin** (action: Gửi tin nhắn):
- Text variants:
  - `Em chào anh, em là Hoa hỗ trợ DA XYZ`
  - `Chào anh, em Hoa từ team XYZ`

### 4.2 Sequence chain

Bước 1: Block A · Bước 2: Block "TEST đổi status" (delay 0)

Bật → Lưu → tạo trigger manual_run bind → run.

Log expected:
```
[request-friend STUB] would send "Em chào..." from nick X to contact Y
[task-worker] task <id> ... state='done'
[update-status] contact Y: ... → ...  (step 2)
```

---

## Bước 5 — REAL Zalo: request_friend (rủi ro thấp)

⚠️ **Chỉ làm sau khi Bước 4 PASS**.

### 5.1 Tắt STUB

```bash
# Xoá AUTOMATION_STUB_MODE khỏi docker-compose.yml hoặc .env
docker compose up -d --force-recreate app
sleep 8
docker logs zalo-crm-app --tail 5 | grep automation.engine
```

### 5.2 Pre-check

```bash
# Contact test có phone?
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT id, full_name, phone_normalized FROM contacts WHERE id='<test>'"

# Nick test connected + cap còn?
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT id, display_name, status, daily_friend_add_cap, last_friend_req_sent_at
 FROM zalo_accounts WHERE id='<nick>'"
```

### 5.3 Chạy

Manual run trigger "Kết bạn + đổi status" với contactId.

Log expected:
```
[request-friend] sent from nick=<id> to uid=<uid> contact=<id>
```

### 5.4 Verify

```bash
# FriendshipAttempt
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT zalo_account_id, contact_id, state, sent_at, error_code
 FROM friendship_attempts ORDER BY queued_at DESC LIMIT 3"
# Expect: state='sent'

# Friend pending_sent
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT friendship_status, zalo_uid_in_nick
 FROM friends WHERE contact_id='<test>' ORDER BY id DESC LIMIT 1"
```

**Mở Zalo nick test app/desktop** → KH có nhận lời mời? ✅

---

## Bước 6 — REAL: send_message (rủi ro cao nhất)

Chỉ test khi đã có Friend status `accepted` với contact.

### 6.1 Pick contact đã là friend

```bash
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT f.contact_id, c.full_name, f.friendship_status
 FROM friends f JOIN contacts c ON c.id=f.contact_id
 WHERE f.zalo_account_id='<nick>' AND f.friendship_status='accepted' LIMIT 5"
```

### 6.2 Sequence 1 bước Block B (send_message)

Tạo trigger manual_run bind → manual run với contactId từ 6.1.

Log expected:
```
[send-message] sent from nick=<id> to contact=<id>, msgId=<zalo-msg-id>
```

### 6.3 Verify

```bash
# Outbound Message persisted
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT m.id, m.content, m.sender_type, m.zalo_msg_id
 FROM messages m JOIN conversations c ON c.id=m.conversation_id
 WHERE c.contact_id='<test>' AND m.sender_type='self' ORDER BY m.sent_at DESC LIMIT 3"

# Conversation timestamp
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT id, last_message_at FROM conversations WHERE contact_id='<test>'"

# Nick lastMessageSentAt (throttle gate state)
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT id, last_message_sent_at FROM zalo_accounts WHERE id='<nick>'"
```

**Mở Zalo nick** → chat với KH → thấy tin "Em chào anh..." vừa gửi ✅

---

## Bước 7 — Event tự fire (event-driven, không manual)

### 7.1 first_message_received

`/triggers` → Catalog → "KH nhắn tin lần đầu" → Khởi tạo.
Bind = sequence chỉ có **update_status** (an toàn, không gửi gì cho KH).
Bật, lưu.

Nhờ 1 KH chưa từng nhắn nick test → nhắn 1 tin → đợi ~30-45p (hoặc set delay=0).

Log expected:
```
[automation.event-bus] emit { type: 'first_message_received', contactId: ... }
[materializer] event handled
[task-worker] ... [update-status] contact ...
```

### 7.2 Các event khác

| Event | Test thế nào |
|---|---|
| `friendship_accepted` | Nick gửi lời mời → KH accept → trigger fire |
| `keyword_match` | KH nhắn text khớp `eventFilter.keyword` |
| `message_received` | Mọi msg inbound — **cẩn thận volume cao** |
| `contact_created` | POST /api/v1/contacts qua UI hoặc API |

---

## Bước 8 — Broadcast (mass send)

Test mass-send qua nick pool với pacing.

### 8.1 Tạo Block send_message với 2-3 variant
Đã có ở Bước 4 (Block B).

### 8.2 Tạo Broadcast

`/automation/bot/broadcasts` → click **Broadcast mới**.

| Field | Value test |
|---|---|
| Tên | `TEST broadcast` |
| Block | Pick Block B (TEST gửi tin) |
| Segment kind | `manual` |
| Contact IDs | Paste 1-3 contactId mà nick test đã `accepted` (1 dòng 1 ID) |
| Schedule | `Chạy ngay` |
| Max msg/giờ/nick | `5` (cap thấp cho test) |
| Giờ start-end | `0` → `23` (test ngoài 6-22 cũng được) |

**Lưu nháp** → broadcast vào list state=`draft`.

### 8.3 Preview + Start

```bash
# Preview dry-run
curl -X POST http://localhost:3080/api/v1/automation/broadcasts/<id>/preview \
  -H "Authorization: Bearer $TOKEN"
# Expect: { totalResolved: N, friendableRecipients: M, nonFriendableSkipped: ... }
```

UI: click **▶ Chạy** → confirm. Log:
```
[broadcast] fired <id> — M recipients enqueued
[task-worker] processing 1 tasks
[send-message STUB] would send ... (or REAL if stub off)
```

### 8.4 Verify DB

```bash
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT id, name, state, total_recipients, sent_count, failed_count
 FROM automation_broadcasts ORDER BY created_at DESC LIMIT 3"

# Tasks linked to broadcast
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT t.state, t.scheduled_at, t.executed_at
 FROM automation_tasks t JOIN automation_campaigns c ON c.id=t.campaign_id
 WHERE c.broadcast_id='<bc-id>' ORDER BY t.scheduled_at LIMIT 10"
```

### 8.5 Pause/Resume/Cancel

UI: click **Tạm dừng** trên broadcast running → state=`paused`, queued tasks stay queued but worker skips them (Campaign state='paused').

Click **Tiếp tục** → resume.

Click **Huỷ** → confirm → state=`cancelled`, all queued tasks → skipped with `skip_reason='broadcast_cancelled'`.

### 8.6 Scheduled broadcast

Tạo broadcast mới, chọn **Lên lịch chạy 1 lần**, set `scheduledAt` = thời điểm 2-3 phút trong tương lai → Lưu nháp → **Start** (state → `scheduled`).

Watch log: scheduler poll mỗi 60s, fire khi due:
```
[broadcast-scheduler] firing 1 due broadcasts
[broadcast] fired ... — N recipients enqueued
```

---

## Bước 9 — Cron triggers (birthday + scheduled_cron)

### 9.1 Birthday — chuẩn bị test

Pick 1 KH có birthDate = hôm nay (test):
```bash
# Set 1 KH bất kỳ có sinh nhật hôm nay
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"UPDATE contacts SET birth_date = CURRENT_DATE WHERE id='<test-contact>'"
```

### 9.2 Tạo trigger birthday

`/triggers` Catalog → **"Sinh nhật khách hàng"** → Khởi tạo:
- Bind sequence = chỉ chứa block update_status (an toàn)
- Bật → Lưu

### 9.3 Fire manual (không đợi 8am)

Vì birthday job chỉ chạy 8am, để test ngay anh phải gọi trực tiếp:

```bash
# Method 1: exec vào container và import module (dev only)
docker exec -it zalo-crm-app node -e "
  import('./dist/modules/automation/engine/cron-event-scheduler.js')
    .then(m => m.fireBirthdayNowForTesting())
    .then(r => console.log(r))
"
```

Hoặc đơn giản hơn: chờ 8am next day. 

### 9.4 Verify

Sau 8am hoặc fire manual:
```
[cron-scheduler] birthday tick — N contacts have birthday today
[materializer] event handled { type: 'birthday', ... }
[update-status] contact <id>: ... → ...
```

### 9.5 Scheduled cron

Tạo trigger:
- Catalog → **"Theo lịch định kỳ"** → Khởi tạo
- **Cron expression**: `* * * * *` (mỗi phút — test) hoặc preset có sẵn
- Bind sequence → bật → Lưu

Log expected sau ~1 phút:
```
[cron-scheduler] registered trigger <id> with cron '* * * * *'
[cron-scheduler] fired scheduled_cron trigger <id>
[materializer] event handled
```

**Quan trọng:** sau khi test, sửa cron về `0 9 * * 1` để không spam mỗi phút.

---

## Bước 10 — Webhook order_success

External system (POS, e-commerce) bắn webhook khi đơn thành công → engine fire trigger.

### 10.1 Tạo trigger order_success

`/triggers` Catalog → **"Đơn hàng thành công"** → Khởi tạo:
- Bind sequence chứa block send_message "🎉 Cảm ơn anh/chị đã đặt hàng..."
- Bật → Lưu

### 10.2 Bắn webhook giả

```bash
# Get JWT token first (login as service account)
TOKEN=$(curl -s -X POST http://localhost:3080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin>","password":"<pwd>"}' | jq -r .token)

# Fire webhook (by contactId)
curl -X POST http://localhost:3080/api/v1/automation/webhooks/order \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contactId": "<test-contact>",
    "orderId": "TEST-001",
    "amount": 1500000,
    "currency": "VND",
    "productName": "Khoá học online",
    "items": [{"name":"Khoá A","qty":1,"price":1500000}]
  }'

# Or by phone (server resolves contactId via phoneNormalized)
curl -X POST http://localhost:3080/api/v1/automation/webhooks/order \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone":"0912345678","orderId":"TEST-002","amount":500000}'
```

Expected response: `202 Accepted` + idempotencyKey.

Log:
```
[webhook] order_success emitted — order=TEST-001 contact=<id>
[materializer] event handled { type: 'order_success' }
[task-worker] processing 1 tasks
```

### 10.3 Trigger filter by orderAmount

UI chưa có field filter — phải curl:
```bash
# Set trigger to only fire for orders ≥ 1M
curl -X PUT http://localhost:3080/api/v1/automation/triggers/<id> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"eventFilter":{"amount":{"$gte":1000000}}}'
```

(Materializer hiện chỉ support exact-match filter — phức tạp hơn cần defer.)

---

## Bước 11 — Dọn dẹp

```bash
# Disable test triggers (KHÔNG xoá để giữ history)
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"UPDATE automation_triggers SET enabled=false WHERE name LIKE '%TEST%'"

# Archive test blocks
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"UPDATE blocks SET archived_at=NOW() WHERE name LIKE '%TEST%'"
```

---

## Rollback khẩn cấp

Nếu phát hiện engine gửi sai / spam KH:

```bash
# Cancel mọi task queued + running
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"UPDATE automation_tasks SET state='skipped', skip_reason='emergency_rollback'
 WHERE state IN ('queued','running')"

# Pause active campaigns
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"UPDATE automation_campaigns SET state='paused' WHERE state='active'"

# Disable all triggers
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"UPDATE automation_triggers SET enabled=false"
```

Sau khi xử lý, restart container nếu cần: `docker compose restart app`.

---

## Bước 12 — Tính năng mới Phase7+ (26/08/2026)

### 12.1 A/B variant strategy (random / even_split)

Block `request_friend` và `send_message` có field `variantStrategy`:

- `random` (mặc định) — mỗi task chọn variant ngẫu nhiên.
- `even_split` — chọn theo hash FNV-1a của taskId: chia đều giữa các variant,
  **retry cùng task giữ nguyên variant** (không đổi lời chào giữa chừng).

**Test qua UI:** tạo Block send_message với 3 variants → dropdown
"Chiến lược chia variant" → chọn "Chia đều A/B (even split)" → Lưu.

**Verify content:**
```bash
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT name, content->>'variantStrategy' FROM blocks WHERE name LIKE '%TEST%'"
# Expect: even_split (nếu bỏ chọn thì NULL = random)
```

**Verify engine chọn đúng:** chạy broadcast/sequence với nhiều contact, check
outcome ghi variantIndex:
```bash
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT outcome->>'variantIndex' AS v, count(*) FROM automation_tasks
 WHERE current_block_id='<block-id>' AND state='done'
 GROUP BY 1 ORDER BY 1"
# Expect: phân bố đều giữa các variant (even_split) — với sample đủ lớn
```

### 12.2 Performance API

```bash
curl http://localhost:3080/api/v1/automation/blocks/<block-id>/performance \
  -H "Authorization: Bearer $TOKEN"
```
Expect:
```json
{
  "block": { "id": "...", "name": "...", "actionType": "send_message" },
  "totalTasks": 42, "sent": 40, "done": 38, "failed": 1, "skipped": 1, "pending": 2,
  "byVariant": [ { "variantIndex": 0, "sent": 19, "done": 19 },
                 { "variantIndex": 1, "sent": 19, "done": 19 } ]
}
```
`sent` = mọi task đã xử lý (done + failed + skipped); `pending` = queued +
running. `byVariant` chỉ tính task done (so sánh hiệu quả A/B).

### 12.3 onBlockArchived ('stop' | 'skip')

Runtime rule của sequence: khi 1 step bị archive **sau khi** task đã enqueue:
- `stop` (mặc định) — task hiện tại skip (`skip_reason='block_archived'`),
  sequence kết thúc cho contact đó.
- `skip` — skip step đó rồi **đi tiếp** các step còn lại (tự bỏ qua cả step
  archived phía trước).

**Test:**
1. Tạo sequence 3 bước: update_status → update_status(2) → update_status(3),
   delay 0.
2. Enqueue vài task (manual_run).
3. Ngay lập tức archive block bước 2 (UI `/blocks` → Archive).
4. Set rule `onBlockArchived='skip'` trong sequence runtimeRules (qua API PUT
   nếu UI chưa có field):
   ```bash
   curl -X PUT http://localhost:3080/api/v1/automation/sequences/<id> \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"runtimeRules":{"onBlockArchived":"skip"}}'
   ```
5. Log expected: `[task-worker] task <id> skipped (block_archived, skip mode) — advancing`
   → task chạy tiếp bước 3 → state done với completedCount tăng.

Quay lại default: bỏ rule → hành vi 'stop' như cũ (task dừng ở step archived).

### 12.4 Guard uid_belongs_to_other_contact

Trước khi gửi kết bạn, engine check Friend table: nếu UID đích đã là friend
của **contact khác** trong cùng nick → task bị skip vĩnh viễn (không retry):

- `skip_reason='uid_belongs_to_other_contact'`, outcome chứa owner info
  (`ownerContactId`, `ownerName`, `ownerPhone`) để sale đối chiếu.

**Lưu ý:** đây là guard chống gửi nhầm — việc gộp KH trùng UID là quyết định
của dedup-detector (KH Cha/Con), không tự động merge.

**Test (STUB mode không bắt được case này — cần REAL):**
1. Có 2 contact A (đã là friend với nick test) và B (trùng Zalo UID nhưng
   chưa link). Có thể simulate bằng SQL:
   ```bash
   docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
   "INSERT INTO friends (zalo_account_id, zalo_uid_in_nick, contact_id, friendship_status)
    VALUES ('<nick>', '<uid-of-B>', '<contact-A>', 'accepted')"
   ```
   (uid-of-B lấy từ Friend row của contact B nếu có.)
2. Chạy request_friend cho contact B → log:
   `[task-worker] task <id> skipped: uid_belongs_to_other_contact`
3. Verify DB: task state=`skipped`, outcome JSON có `ownerName`.

### 12.5 Action handlers mới: add_tag / remove_tag / assign_user

Không chạm Zalo SDK (như update_status) — an toàn test mọi lúc, kể cả REAL.

**Tạo block:**
| Loại action | Field | Test value |
|---|---|---|
| Gán tag | Tags (combobox) | `TEST-TAG-1`, gõ Enter để thêm |
| Bỏ tag | Tags | Trước tiên gắn tag thủ công lên contact test |
| Gán sale | Chọn sale + checkbox "Chỉ gán khi chưa có sale" | Pick user bất kỳ |

**Sequence chain:** update_status → add_tag → assign_user (delay 0) →
manual run → verify DB:
```bash
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
"SELECT id, tags, assigned_user_id FROM contacts WHERE id='<test-contact>'"
# Expect: tags chứa 'TEST-TAG-1', assigned_user_id = user đã pick
```

Edge cases đáng test:
- add_tag trên contact đã có sẵn tag đó → no-op, vẫn `state=done`.
- remove_tag trên contact không có tag → no-op, vẫn `done`.
- assign_user với `onlyIfUnassigned=true` trên contact đã có sale → không đổi.
- assign_user với userId thuộc org khác → `failed` với error
  `USER_MISSING_OR_CROSS_ORG` (không crash).

### 12.6 Trigger mới: stuck_lead + form_submission

Catalog giờ có 13 trigger (thêm 2 card mới).

**stuck_lead** ("KH đình trệ trong stage"):
- Emit từ scoring job khi KH mới bị flag stuck (payload: stage, daysInStage,
  thresholdDays).
- Bind block assign_user (an toàn) → set threshold thấp trong scoring config
  hoặc đợi cron scoring chạy → verify event trong log:
  ```
  [automation.event-bus] emit { type: 'stuck_lead', ... }
  ```

**form_submission** ("KH điền form quảng cáo"):
- Emit từ facebook-lead-worker sau khi lead Facebook được xử lý.
- Bind sequence request_friend (REAL) hoặc update_status (an toàn).
- Test: submit 1 lead test lên form FB đã connect → log
  `[automation.event-bus] emit { type: 'form_submission', ... }`.

**contact_status_changed** cũng đã emit từ contact-routes (song song legacy
AutomationRule) — test bằng cách đổi status 1 KH trong UI Contacts.

---

## Bảng checklist tóm tắt

| # | Test | Pass? |
|---|---|:---:|
| 0 | Pre-flight: engine + bảng schema | ☐ |
| 1 | Visual smoke 4 page + responsive 3 size | ☐ |
| 2 | CRUD: Block + Sequence + Trigger qua UI | ☐ |
| 3 | Engine: manual_run + update_status (DB-only) | ☐ |
| 4 | STUB: request_friend + send_message (log only) | ☐ |
| 5 | REAL: request_friend gửi 1 friend req thật | ☐ |
| 6 | REAL: send_message gửi 1 tin thật cho friend | ☐ |
| 7 | Event tự fire: first_message_received → DB update | ☐ |
| 8 | Cleanup test data | ☐ |
| 12.1 | A/B even_split: content + variantIndex trong outcome | ☐ |
| 12.2 | GET /blocks/:id/performance trả đủ fields | ☐ |
| 12.3 | onBlockArchived='skip' advance qua step archived | ☐ |
| 12.4 | uid_belongs_to_other_contact: skip vĩnh viễn kèm owner info | ☐ |
| 12.5 | add/remove tag + assign_user: DB thay đổi đúng | ☐ |
| 12.6 | stuck_lead + form_submission fire từ event thật | ☐ |

---

## Troubleshooting common gates

| Skip reason | Nguyên nhân | Cách xử |
|---|---|---|
| `hour_range` | Test ngoài giờ 6-22 | Sequence edit → hour_range = [0, 23] |
| `per_nick_throttle` | Nick vừa gửi gần đây | Đợi >15p hoặc tắt throttle |
| `stop_on_accept` | KH đã accept với nick khác | Tắt rule trong sequence |
| `no_friend_nick` | send_message nhưng chưa có Friend | Kết bạn manual trước |
| `all_nicks_capped_or_attempted` | request_friend hết quota | Đợi sang ngày mai hoặc thêm nick |
| `block_archived` | Block bị archive sau khi task enqueue (rule 'stop') | Unarchive block, tạo block mới, hoặc set `onBlockArchived='skip'` (xem 12.3) |
| `uid_belongs_to_other_contact` | UID đích đã là friend của contact khác | Đối chiếu owner trong task.outcome; merge/dedup thủ công nếu muốn (xem 12.4) |
| `rule_disabled` | Sequence/Trigger bị disable | Toggle on lại |

---

Maintainer: cập nhật doc này khi ship Phase F (broadcast), cron triggers, hoặc
webhook order_success — thêm test step tương ứng vào checklist.
