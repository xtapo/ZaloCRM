# Hướng Dẫn Quy Trình Baseline Migration Cho Production

> **MỤC ĐÍCH**: Chuyển đổi an toàn từ cơ chế `prisma db push --accept-data-loss` (dễ mất schema ngầm như CHECK constraints, partial unique indexes) sang `prisma migrate deploy` chuẩn xác cho môi trường Production.
> 
> **LƯU Ý QUAN TRỌNG**: Quy trình này được chạy thủ công bởi quản trị viên (anh Jamid). **TUYỆT ĐỐI KHÔNG CHẠY TỰ ĐỘNG KHI CHƯA HOÀN TẤT SAO LƯU**.

---

## Tổng Quan 5 Bước Thực Hiện

```mermaid
graph TD
    A[Bước 1: pg_dump Sao Lưu Toàn Bộ DB] --> B[Bước 2: Kiểm Tra Drift Lần 1]
    B --> C[Bước 3: Chạy Baseline Migration]
    C --> D[Bước 4: migrate resolve --applied]
    D --> E[Bước 5: Đổi CMD & Deploy Production]
```

---

## Bước 1: Sao Lưu Cơ Sở Dữ Liệu Production (pg_dump)

Trước khi thực hiện bất kỳ thao tác nào, bắt buộc phải sao lưu toàn bộ schema và dữ liệu:

```bash
# Đặt biến môi trường kết nối Production
export PROD_DATABASE_URL="postgresql://user:password@prod-host:5432/zalocrm"
BACKUP_FILE="backup_zalocrm_prod_$(date +%Y%m%d_%H%M%S).sql"

# Thực hiện sao lưu định dạng custom hoặc plain SQL
pg_dump "$PROD_DATABASE_URL" -F p -v -f "$BACKUP_FILE"

# Xác minh file sao lưu không rỗng
ls -lh "$BACKUP_FILE"
```

---

## Bước 2: Đo Độ Lệch Schema Lần 1 (Drift Check)

Kiểm tra xem database production hiện tại có sai khác gì so với cây migrations và `schema.prisma` hay không:

```bash
# 1. So sánh giữa migrations và database production hiện tại
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-url "$PROD_DATABASE_URL"

# 2. So sánh giữa schema.prisma và database production hiện tại
npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-url "$PROD_DATABASE_URL"
```

> [!WARNING]
> **CẢNH BÁO MÙNG DRIFF (PRISMA MIGRATE DIFF LÀ "MÙ" VỚI THUẦN-SQL)**:
> `prisma migrate diff` hoàn toàn không nhận diện được `CHECK constraints` và mệnh đề `WHERE` của `Partial Unique Indexes`.
> Do đó, **nếu lệnh diff trả về 0 ("No difference detected"), điều đó KHÔNG CÓ NGHĨA là database production đã đầy đủ bảo vệ dữ liệu!** Bắt buộc phải thực hiện Bước 2b bên dưới.

---

## Bước 2b: Bảng Checklist Các Object Thuần-SQL (Bắt Buộc)

Chạy truy vấn SQL trực tiếp trên database Production để kiểm tra sự tồn tại của toàn bộ 11 object thuần-SQL:

```sql
-- 1. Kiểm tra 6 CHECK constraints
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE contype = 'c' 
  AND conname IN (
    'facts_strength_check',
    'facts_source_not_bank_card_check',
    'fact_suggestions_status_check',
    'fact_suggestions_source_not_bank_card_check',
    'agent_tasks_status_check',
    'contacts_no_self_merge_check'
  );

-- 2. Kiểm tra 5 Partial Unique Indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE indexname IN (
  'uniq_one_leader_per_dept',
  'uniq_one_deputy_per_dept',
  'agent_tasks_active_dedup_key',
  'facts_created_by_task_id_uniq',
  'fact_suggestions_created_by_task_id_uniq'
);
```

### Bảng Đối Chiếu 11 Object Thuần-SQL

| Loại Object | Tên Constraint / Index | Bảng Áp Dụng | Biểu Thức Định Nghĩa (Predicate / Rule) |
|---|---|---|---|
| CHECK | `facts_strength_check` | `facts` | `CHECK ("strength" IN ('strong', 'medium', 'weak'))` |
| CHECK | `facts_source_not_bank_card_check` | `facts` | `CHECK ("source" <> 'zalo.bank-card')` |
| CHECK | `fact_suggestions_status_check` | `fact_suggestions` | `CHECK ("status" IN ('pending', 'accepted', 'rejected'))` |
| CHECK | `fact_suggestions_source_not_bank_card_check` | `fact_suggestions` | `CHECK ("source" <> 'zalo.bank-card')` |
| CHECK | `agent_tasks_status_check` | `agent_tasks` | `CHECK ("status" IN ('pending', 'running', 'completed', 'dead'))` |
| CHECK | `contacts_no_self_merge_check` | `contacts` | `CHECK ("merged_into" IS DISTINCT FROM "id")` |
| PARTIAL INDEX | `uniq_one_leader_per_dept` | `department_members` | `("department_id") WHERE ("dept_role" = 'leader')` |
| PARTIAL INDEX | `uniq_one_deputy_per_dept` | `department_members` | `("department_id") WHERE ("dept_role" = 'deputy')` |
| PARTIAL INDEX | `agent_tasks_active_dedup_key` | `agent_tasks` | `("org_id", "kind", "subject_type", "subject_id") WHERE ("status" IN ('pending', 'running'))` |
| PARTIAL INDEX | `facts_created_by_task_id_uniq` | `facts` | `("created_by_task_id") WHERE ("created_by_task_id" IS NOT NULL)` |
| PARTIAL INDEX | `fact_suggestions_created_by_task_id_uniq` | `fact_suggestions` | `("created_by_task_id") WHERE ("created_by_task_id" IS NOT NULL)` |

---

## Bước 3: Đảm Bảo Lịch Sử Migration (Baseline Migration)

Kiểm tra bảng `_prisma_migrations` trên database Production:

```sql
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;
```

Nếu cơ sở dữ liệu production trước đây được tạo bằng `db push` và chưa có lịch sử migration, hoặc mới chỉ apply một phần:
1. Xác định migration đầu tiên tương ứng với schema hiện tại (ví dụ: `20260519000000_baseline_phase6` hoặc migration khởi tạo).
2. Nếu database đã có sẵn các bảng của migration đó, không chạy lại DDL mà chuyển sang Bước 4 để đánh dấu `applied`.

---

## Bước 4: Đánh Dấu Các Migration Đã Tồn Tại (`migrate resolve --applied`)

> [!CAUTION]
> **QUY TẮC NGHIÊM NGẶT VỀ CUSTOM SQL (BẮT BUỘC TUÂN THỦ)**:
> **MỌI MIGRATION CHỨA CUSTOM SQL (CHECK CONSTRAINTS, PARTIAL INDEXES, BACKFILL DỮ LIỆU) TUYỆT ĐỐI KHÔNG ĐƯỢC DÙNG `migrate resolve --applied` MÀ BẮT BUỘC PHẢI CHẠY THẬT QUA `prisma migrate deploy` HOẶC CÓ MIGRATION TỰ CHỮA.**
> 
> Nếu `resolve --applied` các migration này, bảng `_prisma_migrations` sẽ ghi nhận đã chạy nhưng database Production thực tế sẽ THIẾU TOÀN BỘ các ràng buộc bảo vệ dữ liệu!

### Danh Sách Các Migration Chứa Custom SQL (CẤM `resolve --applied`):
1. `20260522000000_rbac_partial_unique_leader_deputy` (Partial Unique Indexes cho Leader / Deputy)
2. `20260817000000_agent_tasks_partial_unique` (Partial Unique Index dedup active tasks)
3. `20260817020000_add_check_constraints` (CHECK constraints Phase 8b/8c)
4. `20260817030000_check_constraints_hardening` (Idempotent CHECK constraints)
5. `20260817040000_repair_pure_sql_objects` (Idempotent self-healing toàn bộ 11 object thuần-SQL và backfill claim_count)

---

## Bước 5: Chạy `migrate deploy` và Đổi CMD Dockerfile Production

Chạy migration deploy để tự động áp dụng và tự chữa toàn bộ schema thuần-SQL trên Production:

```bash
npx prisma migrate deploy --url "$PROD_DATABASE_URL"
```

Kiểm tra lại toàn bộ bằng script verify:
```bash
DATABASE_URL="$PROD_DATABASE_URL" npx tsx scripts/verify-pure-sql-objects.ts
```

Khi script trả về `🎉 [GATE 6 HOÀN TẤT] Toàn bộ 11 object thuần-SQL đều toàn vẹn`:

1. Khởi động lại container Production (với CMD `npx prisma migrate deploy && node dist/app.js` đã đóng gói trong `docker/Dockerfile`):
   ```bash
   docker compose build zalo-crm-app
   docker compose up -d zalo-crm-app
   ```
2. Kiểm tra log khởi động của container:
   ```bash
   docker logs -f zalo-crm-app
   ```
