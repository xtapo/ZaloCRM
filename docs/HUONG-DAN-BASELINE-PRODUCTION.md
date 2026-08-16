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

- Nếu output là `No difference detected` hoặc chỉ chứa các bảng/cột mới cần migrate -> Tiếp tục bước 3.
- Nếu phát hiện cột lạ bị xoá hoặc cấu trúc bất thường -> Dừng lại phân tích, không chạy tiếp.

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

Đối với tất cả các migration đã có cấu trúc trong DB production từ trước:

```bash
# Ví dụ: Đánh dấu các migration từ baseline phase 6 đến phase 7 đã được áp dụng
npx prisma migrate resolve --applied "20260329120357_add_contact_intelligence" --url "$PROD_DATABASE_URL"
npx prisma migrate resolve --applied "20260331234500_add_proxy_url_to_zalo_account" --url "$PROD_DATABASE_URL"
npx prisma migrate resolve --applied "20260416095400_add_crm_name_and_conversation_tab" --url "$PROD_DATABASE_URL"
npx prisma migrate resolve --applied "20260519000000_baseline_phase6" --url "$PROD_DATABASE_URL"
# ... lặp lại cho các migration đã tồn tại trong schema thực tế
```

Sau khi resolve, chạy thử nghiệm `migrate deploy` ở chế độ kiểm tra:

```bash
npx prisma migrate deploy --url "$PROD_DATABASE_URL"
```

Lệnh trên sẽ áp dụng nốt các migration mới của Phase 8 (như `20260816000000_phase8a_agent_tasks`, `20260816140000_phase8b_facts_sessions`, `20260817020000_add_check_constraints`, `20260817030000_check_constraints_hardening`).

---

## Bước 5: Đổi CMD Dockerfile và Deploy Production Container

Khi toàn bộ migration đã xanh và database đã đồng bộ hoàn toàn:

1. Hình ảnh container production mới đã cấu hình CMD trong `docker/Dockerfile`:
   ```dockerfile
   CMD ["sh", "-c", "npx prisma migrate deploy && node dist/app.js"]
   ```
2. Build image và khởi động lại dịch vụ production:
   ```bash
   docker compose build zalo-crm-app
   docker compose up -d zalo-crm-app
   ```
3. Kiểm tra log khởi động của container để đảm bảo migration deploy thành công:
   ```bash
   docker logs -f zalo-crm-app
   ```
