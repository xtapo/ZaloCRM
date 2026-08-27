# Phase 8 — Agentic Layer

> Port **kiến trúc** agent từ [trycompai/crm](https://github.com/trycompai/crm) (MIT) vào ZaloCRM v3.3 — **không merge code**.

**Mục tiêu:** đưa ZaloCRM từ *CRM có AI* thành *CRM có agent tự chủ*. Nguồn bằng chứng chính là **lịch sử chat Zalo + Facebook Lead** đang có sẵn, không phải data vendor nước ngoài.

---

## 0. Quyết định đã chốt (15/08/2026)

> [!NOTE]
> Hai câu hỏi mở trong bản thảo đầu đã có câu trả lời. Ghi lại ở đây vì chúng ràng buộc thiết kế của **tất cả** các phase bên dưới.

### 0.1 — Agent vĩnh viễn cần người duyệt

Không có Phase 9 "tự động gửi". `propose_message` chỉ tạo nháp, suốt vòng đời sản phẩm.

Đây là **ràng buộc sản phẩm**, không phải hạn chế tạm thời của Phase 8. Hệ quả kỹ thuật rất dễ chịu:

- Không cần thiết kế đường nâng quyền cho agent
- Không có feature flag `auto_send` — thứ mà sớm muộn cũng có người bật nhầm trên production
- Mọi thao tác ghi ra Zalo đi qua **đúng một cổng duyệt duy nhất**, nên audit trail là một đường thẳng chứ không phải một cái cây

### 0.2 — Ngân sách token điền thủ công theo từng org

Không có giá trị mặc định, không suy ra từ gói cước. Admin nhập số tại `/settings/crm/agent`.

> [!WARNING]
> **Bỏ trống = agent không chạy** (fail-closed), chứ không phải chạy vô hạn. Một ô cấu hình bị quên không được phép biến thành hoá đơn LLM cuối tháng.

```prisma
model Organization {
  // ... các field hiện có
  agentTokenBudgetMonthly Int?       @map("agent_token_budget_monthly") // null = chưa cấu hình → agent không nhận task
  agentTokenUsedThisMonth Int        @default(0) @map("agent_token_used_this_month")
  agentBudgetResetAt      DateTime?  @map("agent_budget_reset_at") // mốc reset chu kỳ
}
```

Hết ngân sách thì dispatcher **ngừng nhận task mới**, nhưng session đang chạy vẫn được hoàn tất — dừng giữa chừng sẽ để lại `Fact` ghi dở mà không có `FactEvidence` đi kèm.

---

## 1. Kết luận thẩm định

**Có thể tích hợp — ở mức ý tưởng và kiến trúc, không ở mức source code.**

Hai dự án giải quyết cùng bài toán nhưng nằm ở hai thế giới kỹ thuật khác nhau. Điểm thuận lợi lớn nhất là giấy phép: `trycompai/crm` dùng **MIT**, ZaloCRM dùng **Apache 2.0**. MIT tương thích xuôi chiều vào Apache 2.0, nên nếu có lấy đoạn code nào thì hợp pháp — chỉ cần ghi nhận MIT notice vào `THIRD-PARTY-LICENSES.md` (file đã tồn tại sẵn).

### So sánh stack

| Hạng mục | ZaloCRM v3.3 | trycompai/crm |
| --- | --- | --- |
| Backend | Fastify 5 + Prisma 7 | NestJS + tRPC + Prisma |
| Frontend | Vue 3 + Vuetify 3 | Next.js App Router + shadcn/ui |
| Runtime | Node 20, Docker Compose, VPS | Bun + Turborepo, Vercel |
| Agent runtime | Chưa có (AI request-response) | `eve` — durable agent, filesystem-first |
| Sandbox | Không | Vercel Sandbox / microsandbox |
| Tenancy | **Multi-tenant** (Organization + RBAC, `orgId`) | **Cố ý single-tenant**, không có `organizationId` |
| Kênh dữ liệu | Zalo (zca-js), Facebook Lead | Gmail / Microsoft Graph |
| Giấy phép | Apache 2.0 | MIT |

> [!WARNING]
> Hai dòng cuối là lý do **không** được copy-paste: mọi truy vấn của Comp AI thiếu `organizationId` (trong ZaloCRM là `orgId` / `org_id`) → bê nguyên vào là thủng RBAC phòng ban. Và `eve` + Vercel Sandbox không chạy được trên mô hình Docker Compose self-host.

---

## 2. Ba nguyên tắc giữ lại từ Comp AI

1. **Không đoán bất cứ điều gì về một con người.**
   Không tool nào được nhận tham số `confidence`. Tool chỉ báo cái nó *quan sát được*. Một dữ kiện sai mà tự tin còn tệ hơn một ô trống, vì không ai biết nó sai.

2. **Trí tuệ không nằm ở tầng API.**
   Route Fastify chỉ báo cáo *có việc gì đã xảy ra*; agent mới quyết định *việc đó nghĩa là gì*. Không nhân bản logic matching ở hai nơi.

3. **Lịch trình nằm trong dữ liệu, không nằm trong cron expression.**
   Câu "mỗi 10 phút xử lý 10 contact cũ nhất" phải thể hiện bằng `dueAt` của task, không phải bằng một dòng cron.

---

## 3. Phase 8a — Durable work queue (nền móng)

**Thời lượng:** 1–2 tuần · **Phụ thuộc:** không · **Giá trị độc lập:** có (sửa bug thật ngay cả khi dừng ở đây)

### Vấn đề hiện tại

Các scheduler đang chạy theo cron expression:

- `backend/src/modules/scoring/scoring-scheduler.ts`, `decay-cron.ts`, `backfill-cron.ts`, `stuck-detection.ts`
- `backend/src/modules/automation/broadcasts/` (broadcast-scheduler)
- list-enrichment trong `backend/src/modules/automation/lists/`

Mô hình này **gửi trùng khi scale lên nhiều instance**, và một run bị chết giữa chừng thì công việc đó mất luôn cho tới chu kỳ sau.

### Schema mới

```prisma
model AgentTask {
  id          String    @id @default(cuid())
  orgId       String    @map("org_id")
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  kind        String    // 'enrich_contact' | 'recheck_contact' | 'score_decay' | 'broadcast_batch'
  subjectType String    @map("subject_type") // 'contact' | 'friend' | 'list' | 'broadcast'
  subjectId   String    @map("subject_id")

  dueAt       DateTime  @map("due_at")
  priority    Int       @default(0)

  // lease
  leasedBy    String?   @map("leased_by") // instance id
  leasedUntil DateTime? @map("leased_until")
  attempts    Int       @default(0)
  maxAttempts Int       @default(3) @map("max_attempts")

  status      String    @default("pending") // pending|running|done|failed|cancelled
  reason      String?   // vì sao task này tồn tại — HIỂN THỊ CHO SALE
  payload     Json?
  lastError   String?   @map("last_error")

  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@index([orgId, status, dueAt])
  @@index([leasedUntil])
  @@unique([orgId, kind, subjectType, subjectId, status], name: "uniq_open_task")
  @@map("agent_tasks")
}
```

> [!TIP]
> `@@unique` với `status` nằm trong key là mẹo chống tạo trùng task đang mở cho cùng một subject, mà vẫn cho phép nhiều task `done` lịch sử.

### `claimDue` — lease bằng SKIP LOCKED

```ts
// backend/src/modules/agent/queue/tasks.ts
export async function claimDue(opts: {
  instanceId: string
  kinds: string[]
  limit: number
  leaseSeconds?: number
}) {
  const lease = opts.leaseSeconds ?? 300
  return prisma.$queryRaw<AgentTaskRow[]>`
    UPDATE agent_tasks t
       SET status       = 'running',
           "leased_by"  = ${opts.instanceId},
           "leased_until"= now() + (${lease} || ' seconds')::interval,
           attempts     = t.attempts + 1
     WHERE t.id IN (
       SELECT id FROM agent_tasks
        WHERE status = 'pending'
          AND "due_at" <= now()
          AND kind = ANY(${opts.kinds})
        ORDER BY priority DESC, "due_at" ASC
        LIMIT ${opts.limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING *;
  `
}
```

Hai dispatcher chạy song song sẽ lấy tập việc **rời nhau**. Một run chết thì `leasedUntil` hết hạn và task tự quay về `pending` qua một reaper đơn giản chạy mỗi phút.

### File cần tạo

| Đường dẫn | Nội dung |
| --- | --- |
| `backend/src/modules/agent/queue/tasks.ts` | `claimDue`, `complete`, `fail`, `reschedule`, `reapExpired` |
| `backend/src/modules/agent/queue/dispatcher.ts` | vòng lặp lease → chạy handler → complete |
| `backend/src/modules/agent/queue/handlers/` | một file một `kind` |
| `backend/src/modules/agent/agent-routes.ts` | `GET /api/v1/agent/tasks` để quan sát hàng đợi |

### Nghiệm thu Phase 8a

- [ ] Chạy 2 instance app cùng lúc, không có task nào được xử lý 2 lần
- [ ] `kill -9` một instance giữa chừng → task quay về `pending` trong ≤ 60s
- [ ] `scoring-scheduler` và broadcast-scheduler đã chuyển sang enqueue task thay vì tự chạy
- [ ] `dueAt` thay thế hoàn toàn cron expression cho các job theo-đối-tượng
- [ ] Dispatcher từ chối nhận task khi org chưa điền ngân sách token (mục 0.2)
- [ ] `agent_tasks` được tạo bằng migration thật, không qua `db push --accept-data-loss` (mục 10)

---

## 4. Phase 8b — Evidence ledger (giá trị cao nhất)

**Thời lượng:** 2–3 tuần · **Phụ thuộc:** 8a

### Ý tưởng

Mọi dữ kiện về khách hàng đều phải truy được về **một quan sát cụ thể**. Bằng chứng mạnh thì ghi thẳng vào record; bằng chứng yếu thì thành **đề xuất chờ người duyệt**.

ZaloCRM có lợi thế mà Comp AI không có: nguồn bằng chứng tốt nhất nằm ngay trong nhà.

| Nguồn bằng chứng | Mã | Độ mạnh | Đã có sẵn ở đâu |
| --- | --- | --- | --- |
| Khách tự nhắn số điện thoại trong chat | `zalo.self-stated` | Mạnh | `Message` + `shared/phone/` |
| Form Facebook Lead khách tự điền | `facebook.lead-form` | Mạnh | Facebook Lead Ingestion v3.3 |
| Trùng khớp SĐT sau chuẩn hoá | `crm.phone-match` | Mạnh | `normalizeVnMobile()`, `normalizeVnPhone()` |
| Card chuyển khoản / QR trong chat | `zalo.bank-card` | **Mạnh (chỉ cho `bank_account`)** | `zinstant-proxy-routes.ts` (`parseVietQR` chỉ trích xuất `bankBin` + STK; **CẤM suy họ tên hay định danh**; lưu Fact dưới NĐ 13 chưa chốt) |
| Profile khách đồng bộ về qua `Friend` | `zalo.friend-sync` | Trung bình | `friend-sync-service.ts` (**chỉ đúng 4 trường:** tên hiển thị, avatar, `globalId`, `username`; **không chứa số điện thoại, giới tính, ngày sinh**) |
| Alias sale tự đặt trong Zalo | `zalo.alias` | Trung bình | `Friend.aliasInNick` — pull định kỳ nên có thể cũ |
| Zalo Label được gắn | `zalo.label` | Trung bình | Zalo Labels 2-way sync (`zalo-labels-routes.ts`, grace 30s + cooldown 5s) |
| Suy luận từ ngữ cảnh hội thoại bởi LLM | `llm.inference` | **Yếu — luôn là suggestion** | module `ai` |

> [!CAUTION]
> Bản thảo đầu của bảng này có hai chỗ sai (`zalo.profile-sdk` và giả định về độ mạnh của `zalo.friend-sync`/`zalo.bank-card`), đã sửa sau khi đối chiếu code thật hai vòng. Xem **mục 10 và 11** để biết chi tiết.

### Schema

```prisma
model Fact {
  id              String   @id @default(cuid())
  orgId           String   @map("org_id")
  contactId       String   @map("contact_id")
  contact         Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)

  attribute       String   // 'phone' | 'email' | 'company' | 'role' | 'birthday' | 'address'
  value           String
  valueNormalized String?  @map("value_normalized")

  status          String   @default("active") // active|superseded|rejected
  strength        String   // strong|medium|weak
  evidence        FactEvidence[]

  observedAt      DateTime @map("observed_at")
  writtenToRecord Boolean  @default(false) @map("written_to_record")

  createdAt       DateTime @default(now()) @map("created_at")

  @@index([orgId, contactId, attribute, status])
  @@map("facts")
}

model FactEvidence {
  id            String   @id @default(cuid())
  factId        String   @map("fact_id")
  fact          Fact     @relation(fields: [factId], references: [id], onDelete: Cascade)

  source        String   // 'zalo.self-stated' | 'facebook.lead-form' | ...
  sourceRefType String?  @map("source_ref_type") // 'message' | 'lead' | 'friend'
  sourceRefId   String?  @map("source_ref_id") // trỏ về đúng bản ghi gốc để bấm xem
  excerpt       String?  // trích đoạn thật, KHÔNG phải tóm tắt của LLM
  observedAt    DateTime @map("observed_at")

  @@index([factId])
  @@map("fact_evidence")
}

model FactSuggestion {
  id            String    @id @default(cuid())
  orgId         String    @map("org_id")
  contactId     String    @map("contact_id")
  factId        String?   @map("fact_id")

  attribute     String
  proposedValue String    @map("proposed_value")
  currentValue  String?   @map("current_value")
  rationale     String    // agent phải viết được lý do bằng tiếng Việt

  status        String    @default("pending") // pending|accepted|rejected
  resolvedById  String?   @map("resolved_by_id")
  resolvedAt    DateTime? @map("resolved_at")

  createdAt     DateTime  @default(now()) @map("created_at")

  @@index([orgId, status, createdAt])
  @@map("fact_suggestions")
}
```

### Quy tắc ghi

```text
strong  → ghi thẳng vào Contact, tạo Fact(writtenToRecord=true), log vào CustomerActivityLog
medium  → ghi nếu ô đang trống; nếu đã có giá trị khác → tạo FactSuggestion
weak    → luôn luôn tạo FactSuggestion, không bao giờ tự ghi
xung đột giữa 2 strong → FactSuggestion kèm cả hai excerpt để người chọn
```

### UI

- **Inbox "Đề xuất chờ duyệt"** — tái dùng pattern 3 cột của `DuplicateReviewDialog` đã có (hiện tại / đề xuất / bằng chứng). Đây là phần đã chứng minh được là quen tay với người dùng.
- Mỗi ô dữ liệu trên `ContactProfileView` có icon nhỏ → hover hiện nguồn + trích đoạn + link tới tin nhắn gốc.

### Nghiệm thu Phase 8b

- [ ] Mọi đường ghi thông tin khách hàng từ agent/user đều đi qua ledger (ngoại lệ: B8 backfill sweep từ Friend sync là luồng hạ tầng legacy, xem mục 7 và 11)
- [ ] Mọi trường tự điền đều bấm ra được tin nhắn Zalo gốc
- [ ] LLM không bao giờ ghi trực tiếp, chỉ tạo suggestion
- [ ] `FactSuggestion` tôn trọng RBAC phòng ban — sale chỉ thấy đề xuất của khách mình phụ trách

---

## 5. Phase 8c — Tool registry, Skills, tab Agent

**Thời lượng:** 3–4 tuần · **Phụ thuộc:** 8a, 8b

### Tool registry

Mở rộng `backend/src/modules/ai/provider-registry.ts` để hỗ trợ function calling thống nhất trên cả 5 provider (Claude / OpenAI / Gemini / Qwen / Kimi). Mỗi tool là một file trong `backend/src/modules/agent/tools/`.

| Tool | Quyền | Mô tả |
| --- | --- | --- |
| `read_chat_history` | read | Đọc `Message` của một conversation, có phân trang |
| `search_crm` | read | Tìm contact/message/appointment — bọc lại module `search` |
| `get_contact_profile` | read | Hồ sơ + facts hiện tại + nguồn |
| `identify_contact` | read | Đối chiếu SĐT sau chuẩn hoá, globalId, alias |
| `enrich_from_zalo` | read | Đọc đúng 4 trường định danh từ `Friend` đã đồng bộ — tên hiển thị, avatar, `globalId`, `username` |
| `read_facebook_lead` | read | Đọc lead form gốc đã ingest |
| `record_fact` | **write** | Ghi qua ledger, bắt buộc kèm `source` + `excerpt` |
| `suggest_fact` | write-soft | Tạo `FactSuggestion` |
| `schedule_recheck` | **write** | Tạo `AgentTask`, bắt buộc có `reason` |
| `ask_human` | write-soft | Đặt câu hỏi hiện trên tab Agent |
| `propose_message` | **write-gated** | Soạn tin nháp — **không bao giờ tự gửi** (mục 0.1) |

> [!CAUTION]
> **Không có tool nào nhận tham số `confidence`.** Đây là ràng buộc cứng, cần một test tự động quét signature của toàn bộ tool để đảm bảo.

> [!WARNING]
> `enrich_from_zalo` **không** được gọi `profile-operations.ts`. File đó ghi đè profile của chính nick sale. Xem mục 10.

### Skills — prose versioned như code

Đặt tại `backend/src/modules/agent/skills/`, viết bằng tiếng Việt, load vào system prompt theo ngữ cảnh:

| File | Nội dung | Trạng thái |
| --- | --- | --- |
| `bang-chung.md` | Thế nào là bằng chứng mạnh/yếu, khi nào được ghi | ✅ Đã viết (PR #18) |
| `ranh-gioi-du-lieu.md` | Cái gì tuyệt đối không được suy đoán, không được ghi | ✅ Đã viết (PR #18) |
| `nhan-dien-khach.md` | Quy tắc đối chiếu SĐT VN, alias, tài khoản Zalo trùng | ✅ Đã viết (PR #18) |
| `viet-tom-tat.md` | Văn phong tóm tắt khách hàng cho sale Việt | ✅ Đã viết (PR #18) |
| `chong-block-zalo.md` | Ràng buộc tần suất, giờ gửi, hạn mức | ✅ Đã viết (PR #18) |

Quy tắc phân xử: khi `bang-chung.md` cho phép ghi mà `ranh-gioi-du-lieu.md` cấm, **ranh giới thắng**.

Lợi ích phụ: khách hàng doanh nghiệp custom được nghiệp vụ bằng cách sửa markdown, không cần đụng code — khớp thẳng với dịch vụ *Customize AI prompt theo nghiệp vụ* đang chào bán.

### Session & tab Agent

```prisma
model AgentSession {
  id          String    @id @default(cuid())
  orgId       String    @map("org_id")
  subjectType String    @map("subject_type")
  subjectId   String    @map("subject_id")
  taskId      String?   @map("task_id")
  status      String    @default("running") // running|done|failed|awaiting_human
  startedAt   DateTime  @default(now()) @map("started_at")
  endedAt     DateTime? @map("ended_at")
  tokenCost   Int       @default(0) @map("token_cost")
  steps       AgentStep[]

  @@index([orgId, subjectType, subjectId])
  @@map("agent_sessions")
}

model AgentStep {
  id        String       @id @default(cuid())
  sessionId String       @map("session_id")
  session   AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  seq       Int
  kind      String       // 'thought' | 'tool_call' | 'tool_result' | 'question' | 'answer'
  toolName  String?      @map("tool_name")
  input     Json?
  output    Json?
  createdAt DateTime     @default(now()) @map("created_at")

  @@unique([sessionId, seq])
  @@map("agent_steps")
}
```

`AgentSession.tokenCost` cộng dồn vào `Organization.agentTokenUsedThisMonth` khi session kết thúc.

**Tab "Agent"** thêm vào `ContactProfileView` (Vue): dòng thời gian các bước, lead nào bị loại và vì sao, câu hỏi agent đang chờ trả lời — trả lời ngay tại chỗ. Đẩy realtime qua Socket.IO đã có sẵn.

### Màn hình cấu hình `/settings/crm/agent`

Sinh ra từ quyết định 0.2:

- Ô nhập **ngân sách token/tháng** (bắt buộc, không có giá trị gợi ý sẵn)
- Thanh tiến độ đã dùng / tổng
- Trạng thái: `chưa cấu hình` (agent không chạy) · `đang chạy` · `hết ngân sách`
- Bật/tắt từng `kind` task

### Capability printout

In ra lúc boot, và **nạp vào đầu mỗi session** để agent lập kế hoạch theo cái đang có thay vì phát hiện thiếu qua từng lần gọi lỗi:

```text
[agent] on   Lịch sử chat Zalo (zca-js)
[agent] on   Facebook Lead (META_APP_SECRET)
[agent] off  Object storage backfill (S3_ENDPOINT)
[agent] on   AI provider: anthropic, gemini
[agent] off  Gửi tin tự động — vĩnh viễn tắt theo thiết kế
```

---

## 6. Phase 8d — `schedule_recheck` nối vào Lead Scoring

**Thời lượng:** 1–2 tuần · **Phụ thuộc:** 8a, 8c

Hiện tại `decay-cron.ts` giảm điểm theo công thức cứng. Thay bằng: agent chủ động hẹn ngày quay lại **kèm lý do bằng tiếng Việt hiển thị cho sale**.

> Một agent không nói được vì sao nó sẽ quay lại sau 14 ngày thì nó không có lý do — nó chỉ có một giá trị mặc định.

- `stuck-detection.ts` → thay vì chỉ gắn cờ, tạo `AgentTask(kind='recheck_contact', reason=...)`
- 7 auto-tag hiện có (`cold-lead` → `dormant`) trở thành **tín hiệu đầu vào** cho agent, không phải kết luận cuối
- Breakdown modal explainability đã có → bổ sung dòng "agent sẽ xem lại vào {ngày} vì {lý do}"

---

## 7. Bảo mật, pháp lý, chống khoá nick

> [!IMPORTANT]
> Đây là phần Comp AI **không phải nghĩ tới** nhưng ZaloCRM thì bắt buộc.

| Rủi ro | Biện pháp |
| --- | --- |
| **Agent tự chủ + zca-js = khoá nick** | Agent **read-only + suggest — vĩnh viễn**, không riêng Phase 8 (mục 0.1). `propose_message` chỉ tạo nháp. Mọi thao tác gửi qua người duyệt và qua lớp chống block hiện có (`message` 200 tin/ngày, burst 5/30s). **Lưu ý lớp này fail-open** — agent phải tự đếm và fail-closed (mục 10, 11) |
| **Nghị định 13/2023 về bảo vệ dữ liệu cá nhân** | Không enrichment tự động từ web về cá nhân người Việt. Chỉ dùng dữ liệu khách tự cung cấp trong chat / lead form. Ghi rõ trong `ranh-gioi-du-lieu.md` |
| **B8 backfill sweep là writer thứ hai vào bảng `contacts`** | `syncAccountFully()` chạy raw SQL UPDATE trực tiếp vào `contacts` (`full_name`, `zalo_global_id`, `zalo_username`, `avatar_url`) khi ô là NULL/rỗng/'Unknown' mà **không tạo bất kỳ `Fact` nào**. Tiêu chí nghiệm thu 8b ("không có đường nào ghi vào `Contact` mà không đi qua ledger") **đã sai ngay từ lúc viết**. Cần chốt: cho sweep tạo `Fact` với nguồn `zalo.friend-sync`, hay ghi nhận nó là ngoại lệ có tài liệu (mục 11) |
| **`Contact.mergedInto` và race condition do auto-merge** | Ghi `Fact` vào bản ghi đã bị gộp (`mergedInto != null`) thì dữ liệu không hiện trên UI. Cron tự gộp chạy 02:30 UTC = **09:30 giờ VN (đúng giờ làm việc)**, nên bản ghi đọc ở đầu session có thể đã bị gộp ở cuối session. Agent bắt buộc phải follow chain `mergedInto` tới bản ghi gốc trước khi ghi (mục 11) |
| **Rò rỉ đa tenant** | Mọi tool nhận `orgId` từ session, **không** từ tham số của LLM. Test: agent của org A không truy được contact org B |
| **Prompt injection từ tin nhắn khách** | Nội dung tin nhắn khách luôn được bọc trong khối dữ liệu có nhãn, không nối thẳng vào system prompt |
| **Privacy PIN V2** | Contact bị khoá PIN phải vô hình với agent. Ràng buộc này **phải cưỡng chế bằng code tại tầng tool gateway** vì `prisma` client không tự động lọc (mục 11) |
| **Chi phí LLM chạy nền** | Ngân sách token **điền thủ công** theo org (`Organization.agentTokenBudgetMonthly`), cộng dồn từ `AgentSession.tokenCost`. Chưa điền → agent không chạy. Hết ngân sách → ngừng nhận task mới (mục 0.2) |
| **Agent ăn hết hạn mức của sale** | Agent không tiêu quá **30%** hạn mức ngày của bất kỳ nhóm thao tác nào. `friend_read` và `query` là hai nhóm dùng chung với sale (mục 10, 11) |

Nguyên tắc sandbox của Comp AI đáng ghi nhớ cho tương lai dù Phase 8 chưa cần: *shell không có egress và không có `DATABASE_URL` thì chỉ là một bộ xử lý văn bản; có cả hai thì nó có hình dạng của một đường rò dữ liệu.*

---

## 8. Dứt khoát KHÔNG port

| Thứ | Lý do |
| --- | --- |
| `eve` framework | Trói vào Vercel. Tự làm queue + session table trên Postgres 16 sẵn có |
| Vercel Sandbox | Không có trên VPS Docker Compose. Chưa cần ở Phase 8 |
| NestJS / tRPC / Better Auth | Đã có Fastify + JWT + RBAC chạy tốt |
| Next.js / shadcn/ui | Đã có Vue 3 + Vuetify + Liquid Silicon theme |
| Mailbox sync Gmail / Graph | Sai kênh. Nhưng **giữ nguyên triết lý**: đọc thread của chính mình là bằng chứng tốt nhất |
| Perplexity / RapidAPI LinkedIn | Khách SME Việt trên Zalo phần lớn là cá nhân, không có LinkedIn hay company domain. Giá trị thấp, rủi ro pháp lý cao |
| Context (brand data) | Phụ thuộc domain công ty — không áp dụng được |
| Single-tenant | Đi ngược hoàn toàn kiến trúc Organization + RBAC |
| Agent tự gửi tin | Quyết định sản phẩm, không phải giới hạn kỹ thuật (mục 0.1) |

---

## 9. Timeline tổng

| Phase | Nội dung | Tuần | Có thể dừng lại ở đây? |
| --- | --- | --- | --- |
| 8a | Durable work queue | 1–2 | ✅ Có giá trị độc lập |
| 8b | Evidence ledger + suggestion inbox | 2–3 | ✅ Có giá trị độc lập |
| 8c | Tool registry + skills + tab Agent | 3–4 | ⚠️ Cần 8a + 8b |
| 8d | `schedule_recheck` ↔ Lead Scoring | 1–2 | ⚠️ Cần 8a + 8c |

**Tổng: 7–11 tuần.** Thứ tự này cố ý xếp sao cho hai phase đầu trả giá trị ngay cả khi dự án dừng giữa chừng.

### Việc cần làm trước khi code

- [ ] Backup DB và tag `v3.3` làm mốc rollback
- [x] ~~Chốt danh sách nguồn bằng chứng và độ mạnh ở mục 4~~ → **đã đối chiếu code 2 vòng** (mục 10, 11)
- [x] ~~Quyết định: agent có được gửi tin tự động ở Phase 9 không~~ → **vĩnh viễn cần người duyệt** (chốt 15/08/2026)
- [x] ~~Chốt ngân sách token theo org~~ → **điền thủ công, bỏ trống thì agent không chạy** (chốt 15/08/2026)
- [x] ~~Viết `bang-chung.md` và `ranh-gioi-du-lieu.md` trước khi viết tool đầu tiên~~ → **đã viết cả 5 file skill và cập nhật vòng 2** (PR #18)
- [ ] Thêm UI nhập ngân sách token vào `/settings/crm/agent` — hạng mục mới sinh ra từ quyết định 0.2
- [ ] Thêm MIT notice của `trycompai/crm` vào `THIRD-PARTY-LICENSES.md` nếu có mượn đoạn code nào
- [x] ~~Đọc `friend-sync-service.ts` và `friend-event-handler.ts` để chốt độ mạnh của `zalo.friend-sync` và `becameFriendAt`~~ → **đã xác minh vòng 2 (mục 11)**
- [ ] Quyết định có sửa `zalo-rate-limiter.ts` thành fail-open có ngưỡng hay giữ nguyên và để agent tự phòng
- [ ] Quyết định hướng xử lý B8 backfill sweep: cho sweep tạo `Fact(source='zalo.friend-sync')` hay ghi nhận ngoại lệ kiến trúc (mục 11)
- [ ] Review pháp lý mục Nghị định 13/2023 trong `ranh-gioi-du-lieu.md`

---

## 10. Đối chiếu với code thật (15/08/2026)

Mục 4 và 5 ban đầu viết dựa trên README và cấu trúc thư mục. Sau đó đã đọc code thật để kiểm chứng từng mã nguồn bằng chứng.

> [!NOTE]
> **GitHub code search không index repo này** — bốn truy vấn đều trả về rỗng. Phải đọc trực tiếp từng file. Chậm hơn, nhưng đổi lại mọi con số dưới đây là số thật trong code.

### Xác nhận đúng

| Giả định ban đầu | Kết quả |
| --- | --- |
| `Friend.aliasInNick` tồn tại | ✅ Đúng. Kèm `zaloUidInNick`, `contactId`, `zaloAccountId` |
| Có lớp chuẩn hoá SĐT dùng lại được | ✅ Đúng — `shared/phone/normalize-vn-phone.ts` |
| Có hạn mức chống block 200 tin/ngày | ✅ Đúng, và chi tiết hơn nhiều: **9 nhóm thao tác** riêng biệt |
| Zalo Labels 2-way sync | ✅ Đúng — `zalo-labels-routes.ts` |

### Sai #1 — `zalo.profile-sdk` mô tả sai bản chất

Bản thảo ghi nguồn này là "Zalo profile qua SDK (touch-profile)", độ mạnh **Mạnh**.

Thực tế `profile-operations.ts` quản lý profile của **chính tài khoản Zalo của doanh nghiệp**: `updateProfile()` đổi tên / giới tính / ngày sinh của nick sale, cộng `listAvatars` / `deleteAvatar` / `reuseAvatar`. Nó không lấy thông tin khách hàng.

> [!CAUTION]
> Nếu cứ theo bản thảo mà viết `enrich_from_zalo`, agent sẽ gọi một hàm **ghi đè profile nick của nhân viên** trong khi tưởng mình đang đọc dữ liệu khách hàng.

**Đã sửa thành:** mã `zalo.friend-sync`, độ mạnh **Trung bình**, nguồn thật cần xác minh lại từ `friend-sync-service.ts` / `friend-event-handler.ts` trước khi cho phép ghi.

### Sai #2 — tên field `phoneNormalized` là bịa

Code thật dùng hai helper:

```ts
normalizeVnMobile(raw)  // shared/utils/phone.ts
                        // → "84XXXXXXXXX" canonical, không có dấu +

normalizeVnPhone(raw)   // shared/phone/normalize-vn-phone.ts
                        // → { phoneE164, phoneLocal, valid, invalidReason }
                        // phoneE164 = "+84XXXXXXXXX", phoneLocal = "0XXXXXXXXX"
```

Đầu số di động hợp lệ là **3/5/7/8/9**. Comment trong file ghi `+84[3-9]` nhưng regex thật là `/^[35789]/`, tức `+844...` và `+846...` bị loại — regex đúng, comment sai.

Hàm tự cắt tiền tố `p:`, `tel:`, `sdt:`, `sđt:`, `phone:`, `dt:`, `đt:`. Riêng `p:` là dấu vết của **Facebook Lead Ads** — gặp `p:+84...` nghĩa là dữ liệu đến từ lead form, phải ghi `source` là `facebook.lead-form` chứ không phải `zalo.self-stated`.

Chuỗi dưới 9 chữ số bị loại với `invalidReason: 'too_short'`.

### Phát hiện #1 — rate limiter là fail-open

> [!CAUTION]
> `checkLimits()` trong `zalo-rate-limiter.ts` bọc toàn bộ thân hàm trong `try/catch` và trả `{ allowed: true }` khi có lỗi. Redis chết, mạng chập, key hỏng — **mọi thao tác đều được cho qua**.

Với người ngồi gõ thì thiết kế này hợp lý: người không gửi nổi 500 tin trong một phút dù hệ thống cho phép. Với agent thì ngược lại — agent **phát được** 500 request/phút, và hôm Redis chết chính là hôm khoá nick của nhân viên.

Đây là lý do `chong-block-zalo.md` bắt agent tự đếm và fail-closed, ngược chiều với tầng dưới. Việc có sửa chính rate limiter hay không là quyết định riêng, vì nó ảnh hưởng cả đường người dùng.

Hạn mức thật (`CATEGORY_LIMITS`):

| Nhóm | Mỗi ngày | Burst |
| --- | --- | --- |
| `message` | 200 | 5 / 30s |
| `reaction` | 300 | 10 / 30s |
| `chat_action` | 500 | 15 / 30s |
| `group_admin` | 50 | 5 / 60s |
| `group_read` | 1000 | 20 / 30s |
| `friend_action` | 30 | 8 / 60s |
| `friend_read` | 500 | 10 / 30s |
| `profile` | 10 | 3 / 60s |
| `query` | 2000 | 30 / 30s |

Agent tiêu nhiều nhất ở `friend_read` và `query` — cùng bộ đếm sale đang dùng để làm việc. Nếu agent ăn hết `friend_read` lúc 10 giờ sáng, sale không tra được khách cả ngày còn lại và sẽ không biết tại sao.

### Phát hiện #2 — migrations không phản ánh schema

> [!WARNING]
> `prisma/migrations/` dừng ở `20260813120000_add_user_token_version` và **không có migration nào cho Phase 6 Lead Scoring**, dù Phase 6 đã chạy.

Khớp với việc entrypoint Docker dùng `prisma db push --accept-data-loss`. Nghĩa là `AgentTask` của Phase 8a cũng sẽ vào DB không qua migration review.

Điều này đáng cân nhắc hơn bình thường vì `agent_tasks` là bảng **có lease**: chạy `db push --accept-data-loss` lúc đang có task `running` thì mất task, và không có gì báo cho ai biết. Nên dùng migration thật riêng cho Phase 8a.

### Alias không đáng tin bằng tưởng tượng

Alias được **pull định kỳ** — SDK không bắn event khi alias đổi (`FriendEvent` không có `ALIAS_CHANGE`). Mỗi lần đồng bộ tối đa **4.000 alias/nick** (200 mỗi trang × 20 trang, hard cap chống vòng lặp vô hạn).

Hệ quả cho agent: **không được kết luận "khách này không có alias"**. Chỉ biết là lần pull gần nhất không thấy. Nick nào nhiều hơn 4.000 bạn bè thì danh sách bị cắt.

Khi alias đổi, hệ thống ghi activity `friend_alias_change` với `systemSource: 'zalo_alias_sync'` — dấu vết tốt để truy lịch sử tên gọi.

---

## 11. Đối chiếu vòng 2 (16/08/2026)

Sau khi rà soát trực tiếp mã nguồn lần hai trên toàn bộ các module Zalo, Privacy, Phone, và Lead Ingestion, các chi tiết kỹ thuật cốt lõi đã được xác minh rõ ràng và đối chiếu với bản thiết kế Phase 8:

### 1. `friend-sync-service.ts` — `zalo.friend-sync` chỉ mang về đúng 4 trường định danh

Đã đọc trực tiếp `friend-sync-service.ts`. Hằng `DIFFABLE_FIELDS` chỉ gồm đúng 4 trường:

```text
zaloDisplayName   — tên hiển thị khách tự đặt trên Zalo
zaloAvatarUrl     — đường dẫn ảnh đại diện
zaloGlobalId      — định danh toàn cục xuyên nick
zaloUsername      — handle Zalo (@username)
```

**Hoàn toàn không có số điện thoại, giới tính, hay ngày sinh.** Luồng đồng bộ `Friend` (chạy cron mỗi 15 phút, manual sync có cooldown 5s, hoặc auto-sync khi kết nối nick) chỉ thu thập 4 trường định danh bề mặt.

Hệ quả: Độ mạnh của nguồn `zalo.friend-sync` được chốt ở mức **Trung bình**. Agent không được suy đoán thông tin cá nhân (như giới tính, ngày sinh) từ nguồn này.

### 2. B8 backfill sweep là writer thứ hai vào bảng `contacts`

Trong `syncAccountFully()`, hệ thống chạy một câu lệnh `prisma.$executeRaw` (gọi là **B8 backfill sweep**), trực tiếp UPDATE bảng `contacts` (`full_name`, `zalo_global_id`, `zalo_username`, `avatar_url`) từ dữ liệu của `friends` khi ô trong `contacts` đang mang giá trị `NULL`, rỗng, hoặc đúng literal `'Unknown'`.

Lệnh sweep này có subquery `NOT EXISTS` để chống vi phạm ràng buộc `@@unique([org_id, zalo_global_id])`, nhưng **hoàn toàn không tạo bất kỳ bản ghi `Fact` hay `CustomerActivityLog` nào**.

Hệ quả:
- Tiêu chí nghiệm thu ban đầu của Phase 8b ("Không có đường nào ghi vào `Contact` mà không đi qua ledger") **đã sai ngay từ khi viết**. Cần ghi nhận B8 backfill sweep là một ngoại lệ hạ tầng đồng bộ legacy có tài liệu rõ ràng, hoặc tái cấu trúc sweep để tự sinh `Fact(source='zalo.friend-sync')`.
- Agent **tuyệt đối không `record_fact(attribute='full_name')` khi tên hiện tại là `'Unknown'`**, vì trong vòng ≤ 15 phút sweep sẽ tự động lấp bằng tên hiển thị Zalo của khách — một nguồn mạnh và chuẩn xác hơn suy luận của agent.

### 3. Dedup trong `processFriend` và race condition do auto-merge

Cơ chế dedup khi xử lý bạn bè mới (`processFriend`) thực hiện theo 2 bước:
1. Khớp `Contact.zaloGlobalId` trước (cố ý **không** lọc `mergedInto: null` để tránh race condition), nếu `matched.mergedInto` khác null thì đệ quy follow theo chuỗi tới bản ghi gốc.
2. Nếu không khớp globalId, mới fallback khớp `Contact.zaloUid`, và cũng follow chain tương tự.

Bên cạnh đó, cron tự gộp trùng lặp (`duplicate-detector`) chạy định kỳ lúc **02:30 UTC = 09:30 giờ Việt Nam (đúng giờ làm việc cao điểm)**.

Hệ quả: Một bản ghi `Contact` mà agent đọc được ở đầu session có thể đã bị gộp thành bản phụ (`mergedInto != null`) ở cuối session. Nếu ghi `Fact` vào bản ghi đã bị gộp, dữ liệu sẽ bị ẩn hoàn toàn trên giao diện người dùng. Agent bắt buộc phải kiểm tra `mergedInto` và đi tới bản ghi gốc trước khi thực hiện bất kỳ thao tác ghi nào.

### 4. `becameFriendAt` trong `friend-event-handler.ts` — trường rỗng không có nghĩa là khách mới

Trong hàm `applyFriendTransition`:
- `becameFriendAt` **chỉ được gán** khi thoả mãn đồng thời 3 điều kiện: (1) `source === 'event'` (sự kiện realtime `acceptFriendRequest` từ SDK Zalo), (2) `newFriendshipStatus === 'accepted'`, và (3) `becameFriendAt` hiện tại đang là `NULL`.
- Đường đồng bộ danh sách bạn bè hàng loạt (`source = 'sync'` từ `friend-sync-service.ts`) **cố ý bỏ qua không set `becameFriendAt`**, vì API `getAllFriends` của Zalo không trả về ngày kết bạn thực tế. Nếu gán thời gian sync = `now`, toàn bộ bạn bè kết bạn từ nhiều năm trước sẽ bị hiển thị sai thành "Đã kết bạn hôm nay".

Hệ quả: Một bản ghi `Friend` có `becameFriendAt = null` hoàn toàn **không đồng nghĩa với việc đây là khách mới**. Agent không được dùng trường này để kết luận tuổi của mối quan hệ, mà phải căn cứ vào mốc tin nhắn đầu tiên trong lịch sử trò chuyện.

### 5. `zalo.label` — cơ chế đồng bộ 2 chiều và grace window chống đè

Đối chiếu `backend/src/modules/zalo/zalo-labels-routes.ts`:
- Nhãn Zalo (thẻ màu Zalo) được quản lý theo cả hai chiều: sale có thể gán/gỡ trực tiếp trên CRM (đẩy qua SDK `api.updateLabels()`) hoặc được kéo tự động từ Zalo về qua `api.getLabels()`.
- Khi đồng bộ, Zalo SDK là nguồn có thẩm quyền (authoritative source), dữ liệu nhãn được mirror sang `Friend.crmTagsPerNick` (prefix `🔵 `) và `CrmTag` (`managedBy='zalo_sync'`).
- Hàm `syncLabelsIfStale()` áp dụng cooldown 5 giây (`SYNC_COOLDOWN_MS = 5_000`) và grace window 30 giây (`ASSIGN_GRACE_MS = 30_000`) sau khi người dùng thực hiện gán nhãn gần nhất. Điều này ngăn chặn hiện tượng eventual consistency của Zalo (độ trễ 1–3s) trả về dữ liệu cũ ghi đè lên thao tác vừa thực hiện của sale.
- Khi một nhãn bị xoá trực tiếp trên ứng dụng Zalo (mobile/desktop), SDK không phát sinh webhook realtime. CRM chỉ phát hiện và cập nhật trạng thái lưu trữ (archive) trong lần sync tiếp theo.

Hệ quả: `zalo.label` có độ mạnh **Trung bình**, đại diện cho quy ước phân loại của sale đối với khách hàng tại thời điểm đồng bộ gần nhất.

### 6. `zalo.bank-card` — bằng chứng mạnh cho STK nhưng phạm vi hẹp, cấm định danh

Đối chiếu `backend/src/modules/contacts/zinstant-proxy-routes.ts` (`parseVietQR`) và `zalo-message-helpers.ts`:
- Tin nhắn chuyển khoản Zalo zinstant (`action: 'zinstant.bankcard'`) được lưu trữ dạng raw payload JSON trong bảng `messages`. Khi giao diện hoặc backend cần hiển thị, route `/api/v1/zalo-bankcard` sẽ tải mã HTML từ Zalo CDN và bóc tách chuỗi VietQR EMVCo dạng TLV.
- Hàm `parseVietQR()` chỉ trích xuất trường `bankBin` (đối chiếu ra mã ngân hàng TPB, VCB, MB...) và `accountNumber` (số tài khoản).
- **Hoàn toàn KHÔNG trích xuất được tên chủ tài khoản, KHÔNG có số điện thoại, và KHÔNG có họ tên khách hàng.**

Hệ quả:
- Độ mạnh của `zalo.bank-card` đối với thuộc tính `bank_account` (mã NH + STK) trong tin nhắn inbound do chính khách gửi là **Mạnh** (số bóc từ chuỗi chuẩn máy đọc).
- **CẤM TUYỆT ĐỐI** dùng `zalo.bank-card` làm bằng chứng nhận diện khách hàng hay suy luận họ tên khách.
- Với tin nhắn outbound do sale gửi, đây là STK của công ty/nhân viên, tuyệt đối không được ghi vào hồ sơ khách hàng.
- *(Lưu ý thiết kế: Việc `bank_account` có được lưu chính thức thành `Fact` hay không dưới quy định Nghị định 13/2023/NĐ-CP hiện ở trạng thái **chưa chốt** và sẽ được quyết định riêng).*

### 7. Privacy PIN và yêu cầu cưỡng chế bằng code tại tầng Tool

Đối chiếu `backend/src/modules/privacy/` (`pin-service.ts`, `redact.ts`):
- Cơ chế bảo vệ riêng tư (Privacy Mode) hoạt động bằng cách làm mờ (redact/blur) nội dung tin nhắn, tên khách hàng và thông tin định danh (PII) khi tài khoản Zalo gắn cờ `privacyMode = 'main'` và người xem chưa mở khoá PIN hợp lệ.
- Cơ chế này hiện được cài đặt thủ công ở tầng route/API (`redactContact`, `redactMessage`, `getRedactableContactIds`).
- **`prisma` client hoàn toàn không tự động lọc hay làm mờ dữ liệu.** Nếu một tool của agent thực hiện truy vấn trực tiếp qua Prisma, dữ liệu nhạy cảm của các contact bị khoá PIN vẫn sẽ bị trả về dạng thô.

Hệ quả: Ràng buộc "Contact bị khoá PIN phải hoàn toàn vô hình đối với agent" **bắt buộc phải được cưỡng chế bằng code ở tầng middleware / gateway của Tool**, không thể chỉ dựa vào hướng dẫn văn phong (prose) trong file skill `ranh-gioi-du-lieu.md`.

### 8. Thống nhất quy ước `orgId` / `org_id`

Đã kiểm tra toàn bộ codebase TypeScript và schema cơ sở dữ liệu:
- Mọi model Prisma sử dụng thuộc tính `orgId` dạng camelCase và gán `@map("org_id")` cho cột SQL.
- Đã sửa lại toàn bộ các định nghĩa model đề xuất trong tài liệu Phase 8 (`Organization`, `AgentTask`, `Fact`, `FactEvidence`, `FactSuggestion`, `AgentSession`, `AgentStep`) sang `orgId` / `org_id` để đảm bảo khớp 100% với kiến trúc hiện có của ZaloCRM.

