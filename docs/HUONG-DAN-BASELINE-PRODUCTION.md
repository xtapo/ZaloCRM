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
> **CẢNH BÁO MÙ DRIFT (PRISMA MIGRATE DIFF LÀ "MÙ" VỚI THUẦN-SQL)**:
> `prisma migrate diff` hoàn toàn không nhận diện được `CHECK constraints` và mệnh đề `WHERE` của `Partial Unique Indexes`.
> Do đó, **nếu lệnh diff trả về 0 ("No difference detected"), điều đó KHÔNG CÓ NGHĨA là database production đã đầy đủ bảo vệ dữ liệu!** Bắt buộc phải thực hiện Bước 2b bên dưới.

---

## Bước 2b: Bảng Checklist 15 Object Thuần-SQL (Bắt Buộc)

> **MỘT NGUỒN SỰ THẬT (Single Source of Truth)**: Toàn bộ danh mục 15 object và biểu thức SQL định nghĩa được lưu trữ duy nhất tại file mã nguồn [pure-sql-inventory.ts](file:///backend/src/shared/database/pure-sql-inventory.ts) và được tự động kiểm thử tại Cổng 6 (`verify-pure-sql-objects.ts`).

Chạy truy vấn SQL trực tiếp trên database Production để kiểm tra sự tồn tại của toàn bộ 15 object thuần-SQL:

```sql
-- 1. Kiểm tra 10 CHECK constraints
SELECT conname::text, pg_get_constraintdef(oid)::text AS def 
FROM pg_constraint 
WHERE contype::text = 'c' 
  AND connamespace = 'public'::regnamespace
ORDER BY conname;

-- 2. Kiểm tra 5 Partial Unique Indexes
SELECT indexname::text, indexdef::text AS def 
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND indexdef LIKE '%WHERE%'
ORDER BY indexname;
```

### Danh Mục 15 Object Thuần-SQL Cần Hiện Diện

| STT | Loại Object | Tên Constraint / Index | Bảng Áp Dụng |
|---|---|---|---|
| 1 | CHECK | `agent_tasks_status_check` | `agent_tasks` |
| 2 | CHECK | `chk_dept_depth_max` | `departments` |
| 3 | CHECK | `chk_dept_no_self_parent` | `departments` |
| 4 | CHECK | `chk_dept_role` | `department_members` |
| 5 | CHECK | `chk_zalo_privacy_mode` | `zalo_accounts` |
| 6 | CHECK | `contacts_no_self_merge_check` | `contacts` |
| 7 | CHECK | `fact_suggestions_source_not_bank_card_check` | `fact_suggestions` |
| 8 | CHECK | `fact_suggestions_status_check` | `fact_suggestions` |
| 9 | CHECK | `facts_source_not_bank_card_check` | `facts` |
| 10 | CHECK | `facts_strength_check` | `facts` |
| 11 | PARTIAL UNIQUE INDEX | `agent_tasks_active_dedup_key` | `agent_tasks` |
| 12 | PARTIAL UNIQUE INDEX | `fact_suggestions_created_by_task_id_uniq` | `fact_suggestions` |
| 13 | PARTIAL UNIQUE INDEX | `facts_created_by_task_id_uniq` | `facts` |
| 14 | PARTIAL UNIQUE INDEX | `uniq_one_deputy_per_dept` | `department_members` |
| 15 | PARTIAL UNIQUE INDEX | `uniq_one_leader_per_dept` | `department_members` |

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
> - **Các migration thuần tự chữa custom SQL TUYỆT ĐỐI KHÔNG ĐƯỢC DÙNG `migrate resolve --applied`** mà bắt buộc phải để `prisma migrate deploy` chạy thật ở Bước 5.
> - **Các migration vừa tạo bảng vừa chứa custom SQL ban đầu BUỘC PHẢI `resolve --applied`** (để tránh lỗi bảng đã tồn tại), phần custom SQL của chúng đã được các migration tự chữa `20260817040000` và `20260817050000` phủ lại 100%.

### 1. Nhóm Migration Vừa Tạo Bảng Vừa Chứa Custom SQL (Được phép `resolve --applied` vì đã có migration tự chữa phủ lại):
- `20260521020000_rbac_phase_phan_quyen` (Tạo bảng phòng ban + CHECK constraints RBAC)
- `20260522010000_privacy_phase_rieng_tu` (Tạo bảng phân quyền riêng tư + CHECK privacy mode)

### 2. Nhóm Migration Thuần Custom SQL & Tự Chữa (CẤM `resolve --applied`, Bắt buộc chạy thật ở Bước 5):
1. `20260522000000_rbac_partial_unique_leader_deputy`
2. `20260817000000_agent_tasks_partial_unique`
3. `20260817020000_add_check_constraints`
4. `20260817030000_check_constraints_hardening`
5. `20260817040000_repair_pure_sql_objects`
6. `20260817050000_repair_rbac_privacy_checks`

---

## Bước 5: Chạy `migrate deploy` và Đổi CMD Dockerfile Production

Chạy migration deploy để tự động áp dụng và tự chữa toàn bộ 15 object thuần-SQL trên Production:

```bash
npx prisma migrate deploy --url "$PROD_DATABASE_URL"
```

Kiểm tra lại toàn bộ bằng script verify:
```bash
DATABASE_URL="$PROD_DATABASE_URL" npx tsx scripts/verify-pure-sql-objects.ts
```

Khi script trả về `🎉 [GATE 6 HOÀN TẤT] Toàn bộ 15/15 object thuần-SQL đều toàn vẹn và khớp biểu thức`:

1. Khởi động lại container Production (với CMD `npx prisma migrate deploy && node dist/app.js` đã đóng gói trong `docker/Dockerfile`):
   ```bash
   docker compose build zalo-crm-app
   docker compose up -d zalo-crm-app
   ```
2. Kiểm tra log khởi động của container:
   ```bash
   docker logs -f zalo-crm-app
   ```
