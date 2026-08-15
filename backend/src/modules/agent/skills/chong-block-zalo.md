# Kỹ năng: Chống khoá nick Zalo

> Nạp vào **mọi** session có khả năng gọi SDK Zalo.
> Bảng hạn mức dưới đây chép từ `CATEGORY_LIMITS` thật trong `zalo-rate-limiter.ts`.

## Điều bạn phải hiểu trước tiên

ZaloCRM vận hành trên **tài khoản Zalo cá nhân của nhân viên thật**, qua một SDK không chính thức. Đây không phải API doanh nghiệp có hợp đồng.

Nick bị khoá nghĩa là một người mất toàn bộ lịch sử hội thoại với khách của họ, kèm theo cả tài khoản cá nhân họ dùng để nhắn tin cho gia đình. Chi phí này không nằm trên hóa đơn của ai cả.

## Hạn mức thật

| Nhóm thao tác | Mỗi ngày | Burst |
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

Hạn mức tính **theo từng nick, theo từng nhóm**, reset theo ngày lịch.

## Ba điều riêng agent phải tuân

### 1. Bộ đếm là của chung, không phải của bạn

Nhóm `friend_read` và `query` là thứ bạn tiêu nhiều nhất khi làm giàu dữ liệu. Nhưng sale cũng đang dùng chung con số đó để làm việc.

Nếu bạn ăn hết `friend_read` lúc 10 giờ sáng, sale không tra được khách cả ngày còn lại, và họ sẽ không biết tại sao.

**Quy tắc: agent không tiêu quá 30% hạn mức ngày của bất kỳ nhóm nào.** Vượt ngưỡng thì dừng và đẩy task sang `dueAt` ngày hôm sau, kèm `reason` nói rõ lý do.

### 2. Rate limiter là **fail-open** — nó không cứu bạn

> [!CAUTION]
> `checkLimits()` bọc toàn bộ thân hàm trong `try/catch` và trả về `{ allowed: true }` khi có lỗi. Redis chết, mạng chập, key hỏng — **mọi thao tác đều được cho qua**.

Thiết kế này hợp lý khi người ngồi gõ: người không gửi được 500 tin trong một phút dù hệ thống cho phép.

Với agent thì ngược lại: bạn **có thể** phát 500 request trong một phút, và hôm Redis chết chính là hôm bạn làm khoá nick của người ta.

**Vì vậy agent phải tự đếm, không được coi `allowed: true` là giấy phép.** Nếu không đọc được bộ đếm → coi như đã hết hạn mức và dừng. Fail-closed, ngược với tầng dưới.

### 3. Bạn không gửi tin

Nhóm `message` có hạn mức 200/ngày, nhưng con số đó **không dành cho bạn**. `propose_message` chỉ tạo nháp; người duyệt mới là người tiêu vào hạn mức đó.

Xem mục 6 của `ranh-gioi-du-lieu.md`.

## Nhịp độ

- Ưu tiên đọc từ **database** thay vì gọi SDK. Tin nhắn đã đồng bộ nằm sẵn trong bảng `messages` — đọc ở đó không tốn hạn mức nào cả.
- Chỉ gọi SDK khi dữ liệu trong DB thiếu hoặc quá cũ.
- Gộp nhiều nhu cầu thành một lần gọi khi SDK cho phép phân trang.
- Không chạy enrichment hàng loạt vào giờ cao điểm của sale. Đặt `dueAt` vào đêm theo `Organization.timezone`, đừng dùng giờ UTC của server.

## Dấu hiệu phải dừng ngay

Nếu gặp bất kỳ dấu hiệu nào sau đây, dừng toàn bộ task trên nick đó và `ask_human`:

- SDK trả lỗi xác thực hoặc session bị đẩy ra
- Nhiều thao tác liên tiếp timeout bất thường
- Nick báo trạng thái mất kết nối giữa chừng phiên làm việc

**Không thử lại.** Thử lại sau khi Zalo đã để ý tới nick là cách nhanh nhất để biến cảnh báo thành lệnh cấm.
