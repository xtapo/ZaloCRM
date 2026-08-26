# Plan — Hoàn thành Phase 7 (defer items + Automation rules)

> Khảo sát 2026-08-26. Hai luồng công việc: (A) các mục defer trong
> `docs/PHASE-7-TEST-REPORT-20260521.md`, (B) phần còn thiếu của Automation rules
> (lưu ý: phần lớn rules đã xong ở commit 17647443 — chỉ còn gap liệt kê dưới đây).

## Phần A — Defer items Bot-Auto

### A1. sendFile/sendImage với HTTP URL → download temp
Hiện tượng: zca-js `uploadAttachment` chỉ nhận filesystem path hoặc Buffer —
URL http sẽ fail "File not found" (video là ngoại lệ: SDK tự fetch URL).
- File sửa: `backend/src/modules/automation/engine/action-handlers/send-message.ts`
  (dispatch nhánh `image` L127–159, nhánh `file` L147–152).
- Thêm helper `resolveAttachmentSource(url)`:
  - Map URL public MinIO → internal S3 endpoint theo mẫu `candidateDownloadUrls()`
    (`backend/src/modules/chat/chat-operations-routes.ts:180–199`).
  - Download bằng fetch (timeout 30s) → `mkdtemp(tmpdir()/zalocrm-auto-att-)`,
    trả `{ path, cleanup }` — sao chép mẫu `downloadMediaToTemp()` cùng file L229–247.
- Worker gọi `cleanup()` trong `finally` (handler chạy background, không có request lifecycle).
- Video giữ nguyên pass-through URL (SDK đã hỗ trợ).

### A2. Sequence advance khi block bị archive giữa flow
Hiện trạng: gate `checkBlockArchived` (`engine/gate-evaluator.ts:146–155`) → worker
`markSkipped('block_archived')` và **dừng cả flow** vì advance chỉ nằm trong
`markDoneAndAdvance` (`engine/task-worker.ts:363–442`).
- Trích hàm chung `scheduleNextStep(task, now)` từ markDoneAndAdvance.
- Thêm runtime rule `onBlockArchived: 'stop' | 'skip'` vào `SequenceRuntimeRules`
  (`sequences/types.ts`, default `'stop'` giữ tương thích), validate trong validator.
- Worker nhánh block_archived: nếu `'skip'` → tìm step kế tiếp chưa archive
  (nếu tất cả còn lại đều archive → kết thúc campaign như done), nếu `'stop'` → giữ nguyên.

### A3. Cross-contact UID dedup (pre-send check)
Không auto-merge contacts (quyết định đã ghi trong test report — thuộc dedup-detector).
- File sửa: `backend/src/modules/automation/engine/action-handlers/request-friend.ts`.
- Sau `findUser`: lookup Friend theo `(zaloAccountId, zaloUidInNick)` **không lọc contactId**;
  nếu row tồn tại trỏ tới Contact khác → return outcome mới
  `uid_belongs_to_other_contact`, không gửi friend request, ghi log chi tiết
  (contact của task vs contact đang sở hữu UID) để sale tự quyết.
- Thêm outcome này vào explicit-branch của worker (mẫu A4 fix — terminal, không retry).

## Phần B — Automation rules: phần còn thiếu

### B1. Emitters còn thiếu
| Trigger | Hook vào | File |
|---|---|---|
| `contact_status_changed` | sau khi UPDATE contact đổi status | `backend/src/modules/contacts/contact-routes.ts` (~L512–528, nơi legacy rule chạy) |
| `stuck_lead` | khi `stuckSince` chuyển null→set | `backend/src/modules/scoring/stuck-detection.ts` |
| `form_submission` | sau khi persist FacebookLeadEvent | `backend/src/modules/integrations/providers/facebook/facebook-lead-worker.ts` |

Thêm 3 event type này vào TRIGGER_CATALOG (`triggers/types.ts`) + catalog UI metadata.

### B2. Action handlers cho engine Phase 7
Các action type đã reserved nhưng chưa implement:
- `add_tag` / `remove_tag` — cập nhật `Contact.tags` JSON.
- `assign_user` — set `Contact.assignedUserId` (validate userId cùng org lúc materialize,
  theo mẫu cross-org check của routes).
- File mới: `engine/action-handlers/{add-tag,remove-tag,assign-user}.ts`,
  đăng ký trong `engine/index.ts`.

### B3. A/B test message variants
Blocks đã có nhiều `content.variants[]` — thiếu cơ chế chọn + đo.
- Thêm `variantStrategy?: 'random' | 'even_split'` (default random) vào Block content schema
  + snapshot variant index vào `AutomationTask.blockSnapshot`.
- Ghi `task.outcome.variantIndex`; thêm aggregate đơn giản: GET
  `/blocks/:id/performance` trả sent/done count per variant (từ tasks).

### B4. Dọn UI
- Xóa entry `automation` khỏi `SettingsComingSoon.vue` (route đã trỏ trang thật).

## Phần C — Tests & verify
- Unit tests: resolveAttachmentSource (mock fetch), onBlockArchived advance logic,
  uid_belongs_to_other_contact, 3 action handlers mới, variant picker.
- Chạy full suite (baseline hiện tại 484 pass).
- STUB mode smoke test qua scripts/test-phase7-runner.sh (cần token mới).
- Cập nhật `docs/PHASE-7-TEST-GUIDE.md` + test report mới.
- REAL media test (ảnh/file thật qua Zalo) — cần bạn verify trên Zalo app sau khi deploy.

## Thứ tự commit
1. `fix(automation): media attachment download-to-temp cho image/file URL` (A1)
2. `feat(automation): sequence skip-step khi block bị archive (runtime rule)` (A2)
3. `feat(automation): pre-send cross-contact UID dedup` (A3)
4. `feat(automation): emitters status_changed/stuck/form_submission` (B1)
5. `feat(automation): action handlers tag/assign cho engine` (B2)
6. `feat(automation): A/B variant strategy + performance API` (B3+B4)
