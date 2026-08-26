# Plan — Multi-channel Messaging: Facebook Messenger + nền tảng abstraction

> Khảo sát 2026-08-26. Mục tiêu: thêm **Facebook Messenger** làm kênh chat thứ 2 song song
> Zalo, trên một lớp **ChannelProvider abstraction** để sau này thêm Telegram/WhatsApp
> chỉ bằng cách implement thêm 1 provider mới.
>
> Quyết định đã chốt với anh (2026-08-26):
> - MVP Messenger: **text + ảnh + file + voice** (sticker/video để sau)
> - Automation engine: **chỉ inbound + inbox trước** — action gửi tin qua Messenger chưa làm,
>   engine phải chặn rõ ràng khi gặp conv không phải Zalo
> - Kiến trúc: **multi-channel đúng chuẩn ngay từ đầu**, không đi đường tắt

---

## 0. Hiện trạng khảo sát (tóm tắt)

Điểm cắm tốt:
- `handleIncomingMessage(msg: IncomingMessage)` (`backend/src/modules/chat/message-handler.ts`)
  là seam chuẩn hóa duy nhất cho inbound: ghi Contact/Conversation/Message → automation →
  scoring → webhook → notification. Listener Zalo chỉ là 1 caller trong số 4 callers
  (listener-factory, message-sync, history-backfill, notifier test).
- Hạ tầng Meta đã có sẵn ở Facebook Lead Ads: OAuth (`facebook-oauth-service.ts`),
  page token AES-GCM (`FacebookPageConnection.accessTokenEnc`), webhook challenge +
  HMAC `X-Hub-Signature-256` (`facebook-webhook-service.ts`), raw-body parser scoped
  (`facebook-routes.ts` L143–154), `subscribePage` (`facebook-graph-client.ts` L161).
  → Messenger dùng chung được gần như toàn bộ, chỉ đổi `subscribed_fields`.
- Storage ảnh/file: MinIO public URL (`shared/storage/minio-client.ts` `uploadBuffer`) —
  Messenger gửi attachment bằng `attachment_url` trỏ thẳng URL public này.

Điểm coupling sâu với Zalo (phải xử lý):
| Vị trí | Vấn đề |
|---|---|
| `Conversation.zaloAccountId` (FK, NOT NULL về mặt ngữ nghĩa) | Conv FB không có nick Zalo |
| Unique `[zaloAccountId, externalThreadId]` | Cần unique riêng cho channel account |
| `Message.zaloMsgId/zaloMsgIdNum/zaloCliMsgId` | Tin FB cần external msg id riêng |
| Scope `getZaloScope` + `chat-security-hooks.ts` + mọi route lọc `zaloAccountId in accessibleIds` | **Conv FB sẽ biến mất khỏi inbox** nếu không sửa — đây là item bảo mật nhạy cảm nhất |
| `upsertContact` dedup chain globalId/username/uid (`message-handler.ts` L650–708) | PSID của FB thuộc không gian id khác |
| Automation `send-message.ts`, `send-template-action.ts` | Giả định Friend/zca-js |
| Frontend `use-chat.ts` `Conversation.zaloAccount`, composer actions | Badge kênh + gate capability |

---

## Giai đoạn 1 — Nền tảng multi-channel (refactor, không đổi behavior Zalo)

### 1.1 Schema migration `20260826010000_add_channel_accounts`

Model mới `ChannelAccount` — tài khoản kênh KHÔNG phải Zalo:

```prisma
model ChannelAccount {
  id             String   @id @default(uuid())
  orgId          String   @map("org_id")
  provider       String   // 'messenger' | 'telegram' | 'whatsapp'
  externalId     String   @map("external_id") // page id / bot id / waba phone id
  displayName    String?  @map("display_name")
  avatarUrl      String?  @map("avatar_url")
  accessTokenEnc String?  @map("access_token_enc") // AES-256-GCM, cùng shared/crypto/aes-gcm
  tokenExpiresAt DateTime? @map("token_expires_at")
  status         String   @default("connected") // connected | revoked | error
  lastError      String?  @map("last_error")
  privacyMode    String   @default("sub") @map("privacy_mode") // tái sử dụng pattern Zalo
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization  Organization  @relation(fields: [orgId], references: [id], onDelete: Cascade)
  conversations Conversation[]

  @@unique([orgId, provider, externalId])
  @@index([orgId, provider, status])
  @@map("channel_accounts")
}
```

Sửa `Conversation`:
- `provider String @default("zalo")` — discriminator
- `channelAccountId String?` FK → ChannelAccount (nullable vì conv Zalo cũ không backfill)
- Index mới `[channelAccountId, externalThreadId]`; giữ nguyên unique cũ cho Zalo
- Sửa các index composite hiện có? — **KHÔNG**. Các index theo `zaloAccountId` vẫn đúng cho
  conv Zalo; conv FB dùng index mới. Query list sẽ có nhánh OR (xem 1.3).

Sửa `Message`:
- `externalMsgId String?` — id server của kênh ngoài (mid của FB, message_id Telegram…)
- Unique `[conversationId, externalMsgId]` (Postgres cho phép nhiều NULL — an toàn với
  tin Zalo cũ). Zalo tiếp tục ghi `zaloMsgId*` như cũ, không đụng code đang chạy.
- `senderUid` tái sử dụng nguyên nghĩa (PSID cho FB).

Model mới `ChannelContact` — identity mapping cho dedup (KHÔNG đụng cột Zalo của Contact):

```prisma
model ChannelContact {
  id         String @id @default(uuid())
  orgId      String @map("org_id")
  contactId  String @map("contact_id")
  provider   String
  externalId String @map("external_id") // PSID / chat_id / wa_id
  createdAt  DateTime @default(now()) @map("created_at")

  contact Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  @@unique([orgId, provider, externalId])
  @@index([contactId])
  @@map("channel_contacts")
}
```

File: `backend/prisma/schema.prisma` + `backend/prisma/migrations/20260826010000_add_channel_accounts/migration.sql`.

### 1.2 Provider abstraction — module mới `backend/src/modules/channels/`

```
channels/
  types.ts              — ChannelProvider interface + NormalizedInbound + ChannelCapabilities
  registry.ts           — getProvider(name) map 'messenger' → singleton instance
  router.ts             — ChannelRouter.send(conversation, payload) dispatch theo provider
  persistence.ts        — persistOutboundMessage() dùng chung (trích từ chat-routes.ts)
  messenger/
    messenger-provider.ts   — implement ChannelProvider
    messenger-graph-client.ts — Graph API calls (send, profile, mark_seen, typing)
    messenger-webhook-service.ts — verify + parse events → NormalizedInbound[]
    messenger-routes.ts     — Fastify plugin /api/v1/integrations/messenger/*
```

Interface cốt lõi (`types.ts`):

```ts
export interface ChannelCapabilities {
  text: boolean;
  image: boolean;
  file: boolean;
  voice: boolean;
  video: boolean;
  sticker: boolean;
  undo: boolean;         // Zalo true, Messenger false
  reactions: boolean;
  quoteReply: boolean;
  typingIndicator: boolean;
  readReceipts: boolean;
  groupThreads: boolean; // Messenger false ở MVP
}

export interface ChannelProvider {
  readonly name: string;                    // 'messenger'
  readonly capabilities: ChannelCapabilities;
  verifyWebhook(query: Record<string,string>): string | null;      // trả hub.challenge
  parseWebhook(rawBody: Buffer): NormalizedInbound[];
  sendMessage(conv: { channelAccount: ChannelAccountRow; externalThreadId: string },
              payload: OutboundPayload): Promise<{ externalMsgId: string }>;
}
```

`NormalizedInbound` cố tình **giữ shape giống `IncomingMessage`** hiện tại của
message-handler.ts (accountId, senderUid, senderName, content, contentType, msgId,
timestamp, isSelf, threadId, threadType…) + thêm `provider: string`. Nhờ vậy
`handleIncomingMessage` chỉ cần thay đổi tối thiểu.

### 1.3 Refactor `handleIncomingMessage` thành channel-aware

File: `backend/src/modules/chat/message-handler.ts`

- `IncomingMessage` thêm `provider?: string` (default `'zalo'` — backward compat, 4 callers
  Zalo hiện tại KHÔNG cần sửa).
- Entry point L229: nếu `provider !== 'zalo'` → resolve org từ `ChannelAccount` thay vì
  `ZaloAccount` (lookup `channelAccount.findUnique({where:{id: msg.accountId}})`).
- `findOrCreateConversation` (L713): nhánh theo provider — conv FB tạo với
  `{ provider, channelAccountId, externalThreadId, contactId, threadType:'user',
  tab:'main' }`, match qua unique mới.
- `upsertContact` (L650): trước chain lookup Zalo, thêm lookup `ChannelContact`
  theo `(orgId, provider, senderUid)`; tạo contact mới thì đồng thời insert row
  `ChannelContact`. Chain Zalo giữ nguyên vẹn.
- Gate phần Zalo-only cho conv channel:
  - SKIP `applyFriendAggregate` + friend-related logic (Friend là bảng Zalo-specific)
  - SKIP reaction-echo-cache, undo handler (không liên quan)
  - GIỮ NGUYÊN: automation rules trigger `message_received`, webhook emit,
    `notifyIncomingMessage` (cần kiểm tra null-safety `conv.zaloAccountId` — sửa select
    sang optional), scoring inbound (signature thuần content — chạy bình thường),
    `applyContactAggregateFromMessage` (thao tác Contact tổng quát).
- Socket emit `chat:message`: listener-factory hiện emit ở caller (L459). Với channel,
  emit tại chính handler hoặc tại provider adapter — payload shape giữ nguyên, thêm
  `provider` vào envelope; `_privacyMeta` undefined với conv channel (privacyMode mặc định
  sub, FE hiểu là public).

**Tiêu chí hoàn tất giai đoạn 1:** toàn bộ test hiện tại pass, Zalo chạy y nguyên
(không đổi behavior), typecheck sạch. Đây là điểm rollback an toàn.

---

## Giai đoạn 2 — Messenger end-to-end

### 2.1 OAuth mở rộng (dùng chung flow Lead Ads)

File: `backend/src/modules/integrations/providers/facebook/facebook-oauth-service.ts`
và `facebook-graph-client.ts`

- Thêm permission `pages_messaging` vào scope OAuth (đứng cạnh `pages_show_list`,
  `pages_read_engagement` hiện có).
- `subscribePage` L161–167: đổi `subscribed_fields: 'leadgen'` →
  `'leadgen,messages,messaging_postbacks'`. An toàn với trang đang connect (resubscribe
  idempotent).
- Sau OAuth callback: với mỗi page, **tạo/upsert `ChannelAccount`**
  `(orgId, 'messenger', pageId)` + copy page access_token đã encrypt.
  Script one-off backfill các page đã connect trước đó (`backend/scripts/`).

### 2.2 Webhook nhận tin

File mới: `backend/src/modules/channels/messenger/messenger-routes.ts`

- Prefix `/api/v1/integrations/messenger` — đã nằm trong whitelist public webhook
  của app.ts L193–198 (URL chứa `/webhook`).
- Copy pattern raw-body parser scoped từ `facebook-routes.ts` L143–154 (Fastify
  encapsulation — parser của plugin FB KHÔNG áp dụng cho plugin này, phải tự đăng ký).
- `GET /webhook`: challenge verify với env `MESSENGER_VERIFY_TOKEN` (thêm vào
  `.env.example`). KHÔNG dùng FB_APP_SECRET cho verify token này (Meta tách biệt
  2 cơ chế).
- `POST /webhook`: HMAC `X-Hub-Signature-256` với `FB_APP_SECRET` — **reusing
  `verifySignature` từ `facebook-webhook-service.ts`** (cùng secret). Trả 200 < 500ms,
  process fire-and-forget.
- Parse (`messenger-webhook-service.ts`) → `NormalizedInbound[]`:
  - `entry[].messaging[]` event `message`: `sender.id` = PSID, `recipient.id` =
    pageId → tra ChannelAccount theo `(orgId?, pageId)` — lưu ý webhook không mang
    orgId, phải lookup ChannelAccount theo `externalId = pageId` rồi lấy orgId từ đó.
  - `message.text` → contentType `text`; `attachments[]` kind
    `image/video/file/audio` + `payload.url` → tải buffer → `uploadBuffer` lên MinIO
    → lưu attachments JSON chuẩn CRM (shape giống Zalo để FE render lại được) +
    contentType tương ứng (`image`/`file`/`voice`).
  - `reply_to.mid` → map sang quote JSON (resolve mid → Message nội bộ).
  - `is_echo: true` → `isSelf = true` (tin page tự gửi từ Inbox FB — dedup với tin
    CRM gửi nhờ externalMsgId unique + dedup window 30s sẵn có của message-handler).
  - `delivery`/`read` → UPDATE `deliveredAt`/`seenAt` cho outgoing messages
    (match `externalMsgId`), emit `zalo:message-status` giữ nguyên event name để FE
    không đổi (payload có messageId là đủ).
  - Idempotency: unique `[conversationId, externalMsgId]` bắt duplicate delivery.
- Profile enrichment: `GET /{psid}?fields=first_name,last_name,profile_pic` bằng page
  token → `fullName`, `avatarUrl` khi upsert contact.

### 2.3 Gửi tin ra ngoài

File mới: `backend/src/modules/channels/messenger/messenger-graph-client.ts`

- Text: `POST /{pageId}/messages` `{recipient:{id}, message:{text}}` → trả `message_id`
  + `recipient_id` → persist với `externalMsgId`.
- Attachment: `attachment_url` trỏ public MinIO URL (yêu cầu MinIO public — điều kiện
  zca-js cũng đã có sẵn). Voice: FB không có loại voice riêng — gửi dạng audio
  attachment; FE hiển thị player.
- **Trích helper chung** `persistOutboundMessage()` vào `channels/persistence.ts` từ
  logic L906–966 của `chat-routes.ts` (create Message + update conversation +
  aggregate + socket emit) — cả route Zalo và route channel cùng gọi, tránh copy 60 dòng.

### 2.4 Route gửi tin phân nhánh

Files: `chat-routes.ts` (POST `/conversations/:id/messages` L~840+, upload-image),
sau này `chat-operations-routes.ts` (edit/undo/reaction/forward).

- Sau khi load conversation, đọc `conv.provider`:
  - `'zalo'` → path hiện tại, không đổi một dòng logic nào.
  - Khác → `ChannelRouter.send(provider, ...)`; response shape giống hệt (FE không đổi).
- Capability gate server-side: action không hỗ trợ (undo/reaction/edit trên Messenger)
  trả 400 `{ error, code: 'CAPABILITY_UNSUPPORTED' }` thay vì crash ở SDK call.
- **24h window rule**: trước khi gửi, check `conversation.lastInboundAt` (hoặc tin
  inbound cuối) — quá 24h → 403 `{code:'MESSAGING_WINDOW_EXPIRED'}`. FE hiện banner
  cảnh báo trên composer.

### 2.5 Access control & inbox visibility (bảo mật — làm cẩn thận)

Conv FB không có `zaloAccountId` → mọi query lọc `zaloAccountId IN (scope.accessibleIds)`
sẽ loại chúng khỏi inbox. Files cần sửa:

- `chat-security-hooks.ts` — root guard lọc payload conversation list.
- `chat-routes.ts` — `/conversations`, `/conversations/counts`, search, tab filters.
- Quyết định mô hình quyền MVP: **ChannelAccount là org-wide** (ai trong org cũng thấy,
  tương đương nick privacyMode='sub'), chưa gắn owner/dept. Filter trở thành:
  `OR: [{ provider: 'messenger' }, { zaloAccountId: { in: accessibleIds } }]`
  với non-admin. Viết test scope riêng (`chat-routes-scope.test.ts` bổ sung case:
  member thường vẫn thấy conv FB, và không thấy nick Zalo ngoài scope).
- Folder (AccountFolderMember theo zaloAccountId): conv FB chưa vào folder — ghi rõ
  là defer, không âm thầm hỏng.

### 2.6 Automation guard (theo quyết định "chỉ inbound trước")

Files: `automation/engine/action-handlers/send-message.ts`,
`automation/actions/send-template-action.ts`.

- Đầu handler: load conversation/provider; nếu ≠ zalo → return
  `{ outcome:'failure', errorCode:'UNSUPPORTED_CHANNEL', retryable:false }` +
  log rõ. Không cho engine tự động gửi qua Messenger ở giai đoạn này.

---

## Giai đoạn 3 — Frontend

Files chính: `frontend/src/composables/use-chat.ts`, `frontend/src/components/chat/*`,
`frontend/src/views/settings/channels/FacebookChannelView.vue`.

1. **Types** (`use-chat.ts`): `Conversation.provider?: string`;
   `ZaloAccount` interface giữ nguyên — conv channel trả `zaloAccount: null` +
   thêm `channelAccount?: { id, displayName, avatarUrl, provider }` ở include của
   backend (chat-routes list query L378 thêm select).
2. **Badge kênh** trên `ConversationList.vue` + header `MessageThread.vue`: icon
   Messenger (chấm xanh FB) cạnh tên tài khoản khi `provider !== 'zalo'`. Avatar conv
   fallback avatar page.
3. **Composer gate**: constants mới `frontend/src/constants/channel-capabilities.ts`
   mirror backend `ChannelCapabilities`. Ẩn/vô hiệu: sticker picker, undo menu,
   reaction picker, quote-reply, voice recorder → với Messenger chỉ còn text + ảnh +
   file + voice(audio). Warning 24h window khi `MESSAGING_WINDOW_EXPIRED`.
4. **Socket**: `chat:message` hoạt động nguyên dạng (envelope thêm provider nhưng FE
   không bắt buộc đọc). `zalo:message-status` dùng lại nguyên trạng.
5. **Settings** (`FacebookChannelView.vue`): thêm mục "Hộp thư Messenger" — danh sách
   page đã connect + toggle bật/tắt inbox per page → gọi endpoint
   `POST /api/v1/integrations/messenger/pages/:pageId/enable|disable`
   (tạo/archive ChannelAccount). Hiện trạng thái subscription + lỗi token.

---

## Giai đoạn 4 — Test & tài liệu

- Unit tests (mẫu `tests/unit/facebook-webhook.test.ts`):
  - `messenger-webhook.test.ts` — signature fail/pass, challenge, parse text/image/
    echo/reply_to/delivery-read, idempotent duplicate.
  - `channel-router.test.ts`, `channel-persistence.test.ts`.
  - Bổ sung `chat-routes-scope.test.ts` case conv-FB-visibility.
  - Guard test: automation handler trả UNSUPPORTED_CHANNEL.
- Integration (mock fetch Graph API): vòng webhook→DB→socket payload; send text+
  attachment happy-path + 24h-window reject.
- Typecheck + full suite: `npm run ci:local` (backend).
- Docs: cập nhật `docs/HUONG-DAN-SU-DUNG.md` (mục inbox đa kênh) +
  `.env.example` (`MESSENGER_VERIFY_TOKEN`).
- **Ghi chú vận hành cho anh**: production Messenger yêu cầu Meta App Review với
  permission `pages_messaging` + Business Verification (vài ngày–vài tuần). Dev/test
  mode chạy được ngay với page mình sở hữu. Nên submit review sớm.

---

## Thứ tự commit đề xuất (mỗi bước độc lập, rollback được)

1. `feat(db): channel accounts + provider columns migration`
2. `feat(channels): provider abstraction + registry (no-op cho Zalo)` — kèm refactor
   message-handler channel-aware, toàn bộ behavior Zalo giữ nguyên, test pass
3. `feat(messenger): oauth pages_messaging + subscribe messages + ChannelAccount sync`
4. `feat(messenger): webhook inbound → inbox`
5. `feat(messenger): outbound send + attachments + 24h window guard`
6. `feat(backend): inbox visibility/scope cho channel conversations + automation guard`
7. `feat(frontend): channel badge + composer gating + settings enable UI`
8. `test/docs: unit + integration + hướng dẫn`

## Rủi ro & biện pháp

| Rủi ro | Biện pháp |
|---|---|
| Sửa scope/inbox visibility làm lộ conv Zalo sai phạm vi | Commit 6 tách riêng, bổ sung test scope trước khi merge |
| `handleIncomingMessage` refactor phá Zalo đang chạy | Giai đoạn 1 không đổi behavior + full regression `ci:local` trước khi sang GĐ2 |
| MinIO không public → FB không tải được attachment | Check config khi enable page; báo lỗi rõ trên Settings |
| Meta App Review kéo dài | Submit sớm ngay khi commit 3 xong; dev mode đủ để phát triển |
| Webhook trùng delivery | Unique `[conversationId, externalMsgId]` + dedup window sẵn có |
