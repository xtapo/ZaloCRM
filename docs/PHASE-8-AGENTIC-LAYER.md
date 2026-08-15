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
  agentTokenBudgetMonthly Int?       // null = chưa cấu hình → agent không nhận task
  agentTokenUsedThisMonth Int        @default(0)
  agentBudgetResetAt      DateTime?  // mốc reset chu kỳ
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
| Tenancy | **Multi-tenant** (Organization + RBAC) | **Cố ý single-tenant**, không có `organizationId` |
| Kênh dữ liệu | Zalo (zca-js), Facebook Lead | Gmail / Microsoft Graph |
| Giấy phép | Apache 2.0 | MIT |

> [!WARNING]
> Hai dòng cuối là lý do **không** được copy-paste: mọi truy vấn của Comp AI thiếu `organizationId` → bê nguyên vào là thủng RBAC phòng ban. Và `eve` + Vercel Sandbox không chạy được trên mô hình Docker Compose self-host.

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
  id             String    @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  kind           String    // 'enrich_contact' | 'recheck_contact' | 'score_decay' | 'broadcast_batch'
  subjectType    String    // 'contact' | 'friend' | 'list' | 'broadcast'
  subjectId      String

  dueAt          DateTime
  priority       Int       @default(0)

  // lease
  leasedBy       String?   // instance id
  leasedUntil    DateTime?
  attempts       Int       @default(0)
  maxAttempts    Int       @default(3)

  status         String    @default("pending") // pending|running|done|failed|cancelled
  reason         String?   // vì sao task này tồn tại — HIỂN THỊ CHO SALE
  payload        Json?
  lastError      String?

  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([organizationId, status, dueAt])
  @@index([leasedUntil])
  @@unique([organizationId, kind, subjectType, subjectId, status], name: "uniq_open_task")
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
           "leasedBy"   = ${opts.instanceId},
           "leasedUntil"= now() + (${lease} || ' seconds')::interval,
           attempts     = t.attempts + 1
     WHERE t.id IN (
       SELECT id FROM agent_tasks
        WHERE status = 'pending'
          AND "dueAt" <= now()
          AND kind = ANY(${opts.kinds})
        ORDER BY priority DESC, "dueAt" ASC
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

---

## 4. Phase 8b — Evidence ledger (giá trị cao nhất)

**Thời lượng:** 2–3 tuần · **Phụ thuộc:** 8a

### Ý tưởng

Mọi dữ kiện về khách hàng đều phải truy được về **một quan sát cụ thể**. Bằng chứng mạnh thì ghi thẳng vào record; bằng chứng yếu thì thành **đề xuất chờ người duyệt**.

ZaloCRM có lợi thế mà Comp AI không có: nguồn bằng chứng tốt nhất nằm ngay trong nhà.

| Nguồn bằng chứng | Mã | Độ mạnh | Đã có sẵn ở đâu |
| --- | --- | --- | --- |
| Khách tự nhắn số điện thoại trong chat | `zalo.self-stated` | Mạnh | `Message` + `shared/phone/` |
| Zalo profile qua SDK (touch-profile) | `zalo.profile-sdk` | Mạnh | endpoint touch-profile v3.2 |
| Form Facebook Lead khách tự điền | `facebook.lead-form` | Mạnh | Facebook Lead Ingestion v3.3 |
| Card chuyển khoản / QR trong chat | `zalo.bank-card` | Mạnh | bank/QR render v3.0 |
| Trùng khớp `phoneNormalized` | `crm.phone-match` | Mạnh | `shared/phone/` |
| Alias sale tự đặt trong Zalo | `zalo.alias` | Trung bình | `Friend.aliasInNick` |
| Zalo Label được gắn | `zalo.label` | Trung bình | Zalo Labels 2-way sync |
| Suy luận từ ngữ cảnh hội thoại bởi LLM | `llm.inference` | **Yếu — luôn là suggestion** | module `ai` |

### Schema

```prisma
model Fact {
  id             String   @id @default(cuid())
  organizationId String
  contactId      String
  contact        Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)

  attribute      String   // 'phone' | 'email' | 'company' | 'role' | 'birthday' | 'address'
  value          String
  valueNormalized String?

  status         String   @default("active") // active|superseded|rejected
  strength       String   // strong|medium|weak
  evidence       FactEvidence[]

  observedAt     DateTime
  writtenToRecord Boolean @default(false)

  createdAt      DateTime @default(now())

  @@index([organizationId, contactId, attribute, status])
  @@map("facts")
}

model FactEvidence {
  id         String   @id @default(cuid())
  factId     String
  fact       Fact     @relation(fields: [factId], references: [id], onDelete: Cascade)

  source        String  // 'zalo.self-stated' | 'facebook.lead-form' | ...
  sourceRefType String? // 'message' | 'lead' | 'friend'
  sourceRefId   String? // trỏ về đúng bản ghi gốc để bấm xem
  excerpt       String? // trích đoạn thật, KHÔNG phải tóm tắt của LLM
  observedAt    DateTime

  @@index([factId])
  @@map("fact_evidence")
}

model FactSuggestion {
  id             String   @id @default(cuid())
  organizationId String
  contactId      String
  factId         String?

  attribute      String
  proposedValue  String
  currentValue   String?
  rationale      String   // agent phải viết được lý do bằng tiếng Việt

  status         String   @default("pending") // pending|accepted|rejected
  resolvedById   String?
  resolvedAt     DateTime?

  createdAt      DateTime @default(now())

  @@index([organizationId, status, createdAt])
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

- [ ] Không có đường nào ghi vào `Contact` mà không đi qua ledger
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
| `identify_contact` | read | Đối chiếu `phoneNormalized`, globalId, alias |
| `enrich_from_zalo` | read | Gọi touch-profile SDK lấy gender/phone/birthday |
| `read_facebook_lead` | read | Đọc lead form gốc đã ingest |
| `record_fact` | **write** | Ghi qua ledger, bắt buộc kèm `source` + `excerpt` |
| `suggest_fact` | write-soft | Tạo `FactSuggestion` |
| `schedule_recheck` | **write** | Tạo `AgentTask`, bắt buộc có `reason` |
| `ask_human` | write-soft | Đặt câu hỏi hiện trên tab Agent |
| `propose_message` | **write-gated** | Soạn tin nháp — **không bao giờ tự gửi** (mục 0.1) |

> [!CAUTION]
> **Không có tool nào nhận tham số `confidence`.** Đây là ràng buộc cứng, cần một test tự động quét signature của toàn bộ tool để đảm bảo.

### Skills — prose versioned như code

Đặt tại `backend/src/modules/agent/skills/`, viết bằng tiếng Việt, load vào system prompt theo ngữ cảnh:

| File | Nội dung |
| --- | --- |
| `bang-chung.md` | Thế nào là bằng chứng mạnh/yếu, khi nào được ghi |
| `nhan-dien-khach.md` | Quy tắc đối chiếu SĐT VN, alias, tài khoản Zalo trùng |
| `ranh-gioi-du-lieu.md` | Cái gì tuyệt đối không được suy đoán, không được ghi |
| `viet-tom-tat.md` | Văn phong tóm tắt khách hàng cho sale Việt |
| `chong-block-zalo.md` | Ràng buộc tần suất, giờ gửi, hạn mức |

Lợi ích phụ: khách hàng doanh nghiệp custom được nghiệp vụ bằng cách sửa markdown, không cần đụng code — khớp thẳng với dịch vụ *Customize AI prompt theo nghiệp vụ* đang chào bán.

### Session & tab Agent

```prisma
model AgentSession {
  id             String   @id @default(cuid())
  organizationId String
  subjectType    String
  subjectId      String
  taskId         String?
  status         String   @default("running") // running|done|failed|awaiting_human
  startedAt      DateTime @default(now())
  endedAt        DateTime?
  tokenCost      Int      @default(0)
  steps          AgentStep[]

  @@index([organizationId, subjectType, subjectId])
  @@map("agent_sessions")
}

model AgentStep {
  id         String   @id @default(cuid())
  sessionId  String
  session    AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  seq        Int
  kind       String   // 'thought' | 'tool_call' | 'tool_result' | 'question' | 'answer'
  toolName   String?
  input      Json?
  output     Json?
  createdAt  DateTime @default(now())

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
| **Agent tự chủ + zca-js = khoá nick** | Agent **read-only + suggest — vĩnh viễn**, không riêng Phase 8 (mục 0.1). `propose_message` chỉ tạo nháp. Mọi thao tác gửi luôn qua người duyệt và qua đúng lớp chống block hiện có (200 tin/ngày, phát hiện gửi quá nhanh) |
| **Nghị định 13/2023 về bảo vệ dữ liệu cá nhân** | Không enrichment tự động từ web về cá nhân người Việt. Chỉ dùng dữ liệu khách tự cung cấp trong chat / lead form. Ghi rõ trong `ranh-gioi-du-lieu.md` |
| **Rò rỉ đa tenant** | Mọi tool nhận `organizationId` từ session, **không** từ tham số của LLM. Test: agent của org A không truy được contact org B |
| **Prompt injection từ tin nhắn khách** | Nội dung tin nhắn khách luôn được bọc trong khối dữ liệu có nhãn, không nối thẳng vào system prompt |
| **Privacy PIN V2** | Contact bị khoá PIN phải vô hình với agent |
| **Chi phí LLM chạy nền** | Ngân sách token **điền thủ công** theo org (`Organization.agentTokenBudgetMonthly`), cộng dồn từ `AgentSession.tokenCost`. Chưa điền → agent không chạy. Hết ngân sách → ngừng nhận task mới (mục 0.2) |

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
- [ ] Chốt danh sách nguồn bằng chứng và độ mạnh ở mục 4
- [x] ~~Quyết định: agent có được gửi tin tự động ở Phase 9 không~~ → **vĩnh viễn cần người duyệt** (chốt 15/08/2026)
- [x] ~~Chốt ngân sách token theo org~~ → **điền thủ công, bỏ trống thì agent không chạy** (chốt 15/08/2026)
- [ ] Thêm UI nhập ngân sách token vào `/settings/crm/agent` — hạng mục mới sinh ra từ quyết định 0.2
- [ ] Thêm MIT notice của `trycompai/crm` vào `THIRD-PARTY-LICENSES.md` nếu có mượn đoạn code nào
- [ ] Viết `bang-chung.md` và `ranh-gioi-du-lieu.md` **trước** khi viết tool đầu tiên
