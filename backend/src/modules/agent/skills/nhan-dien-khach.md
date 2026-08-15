# Kỹ năng: Nhận diện khách

> Nạp khi agent cần trả lời câu "hai bản ghi này có phải cùng một người không?".
> Mọi con số và tên field trong file này đã đối chiếu với code thật trong repo.

## Nguyên tắc

Ghép nhầm hai người thành một là lỗi **không hoàn tác được bằng tay** — lịch sử chat của hai khách đã trộn vào nhau. Tách nhầm một người thành hai thì chỉ phiền.

Vì vậy: **khi phân vân, luôn chọn tách.**

## Số điện thoại

Không bao giờ so sánh hai chuỗi số thô. Luôn chuẩn hoá cả hai vế trước.

Hệ thống có sẵn hai hàm, dùng đúng chúng:

| Hàm | Trả về | Dùng khi |
| --- | --- | --- |
| `normalizeVnMobile()` (`shared/utils/phone.ts`) | canonical `84XXXXXXXXX` (không có dấu `+`) | Đối chiếu, lưu `valueNormalized` |
| `normalizeVnPhone()` (`shared/phone/normalize-vn-phone.ts`) | `{ phoneE164, phoneLocal, valid, invalidReason }` | Khi cần cả hai định dạng và lý do không hợp lệ |

Bốn chuỗi sau là **cùng một số**:

```text
0912 345 678
0912345678
+84912345678
84912345678
```

### Đầu số hợp lệ

Chỉ chấp nhận đầu số di động **3, 5, 7, 8, 9** sau mã quốc gia. `+844...` và `+846...` **không** là số di động hợp lệ — hàm chuẩn hoá sẽ trả `phoneLocal = null`.

Chuỗi ngắn hơn 9 chữ số bị loại với `invalidReason: 'too_short'`. Đừng cố "đoán" phần thiếu.

### Tiền tố rác

Hàm tự cắt các tiền tố `p:`, `tel:`, `sdt:`, `sđt:`, `phone:`, `dt:`, `đt:`.

Riêng `p:` là dấu vết của **Facebook Lead Ads** — gặp chuỗi dạng `p:+84912345678` nghĩa là dữ liệu đến từ lead form, không phải khách gõ trong chat. Ghi `source` cho đúng: `facebook.lead-form`, không phải `zalo.self-stated`.

### Trùng số nghĩa là gì

Trùng số sau chuẩn hoá là bằng chứng **mạnh** (`crm.phone-match`), nhưng không phải tuyệt đối. Ba trường hợp trùng số mà **khác người**:

- Số tổng đài / số công ty dùng chung
- Vợ chồng, người nhà dùng chung một số để liên hệ
- Số cũ đã bị nhà mạng thu hồi và cấp cho người khác

Nếu trùng số nhưng tên lệch hẳn nhau → `suggest_fact`, đừng tự merge.

## Khóa định danh trong CRM

| Trường | Ý nghĩa |
| --- | --- |
| `Friend.zaloUidInNick` | ID Zalo của khách, **trong phạm vi một nick sale** |
| `Friend.zaloAccountId` | Nick sale nào đang kết bạn với khách này |
| `Friend.contactId` | Trỏ về `Contact` — có thể null nếu chưa gắn |
| `Friend.aliasInNick` | Tên gợi nhớ sale tự đặt |

**Một khách có thể có nhiều bản ghi `Friend`.** Nếu ba nick sale cùng kết bạn với một người, sẽ có ba `Friend` trỏ về cùng một `Contact`. Đừng đếm `Friend` rồi kết luận số lượng khách.

Ngược lại, `zaloUidInNick` giống nhau ở hai `zaloAccountId` khác nhau **không** tự động nghĩa là cùng người — phải đối chiếu qua `globalId` theo đúng logic merge đã có sẵn, không tự viết lại.

## Alias có thể cũ

Alias được **pull định kỳ**, không có sự kiện realtime (SDK không bắn event khi alias đổi). Hệ quả bạn phải nhớ:

- Alias bạn đọc được có thể lạc hậu vài giờ đến vài ngày.
- Mỗi lần đồng bộ tối đa **4.000 alias** mỗi nick (200 mỗi trang × 20 trang). Nick nào nhiều bạn hơn thế thì **danh sách bị cắt**.
- Do đó: **không được kết luận "khách này không có alias"**. Bạn chỉ biết là lần pull gần nhất không thấy alias. Hai việc đó khác nhau.

Khi alias đổi, hệ thống ghi activity `friend_alias_change` với `systemSource: 'zalo_alias_sync'`. Đây là dấu vết tốt để truy lịch sử tên gọi.

## Những thứ KHÔNG phải bằng chứng nhận diện

- **Trùng tên.** "Nguyễn Văn A" trùng nhau không nghĩa lý gì ở Việt Nam.
- **Trùng avatar.** Ảnh hoa, ảnh mèo, ảnh idol — hàng nghìn người dùng chung.
- **Nhắn cùng một giờ.** Trùng hợp.
- **Cùng được gắn một Zalo Label.** Label là quy ước của sale, không phải thuộc tính của khách.
- **Văn phong giống nhau.** Bạn không làm phân tích văn bản pháp y.

## Khi đề xuất gộp

Dùng `suggest_fact`, không tự gộp. Trong `rationale` phải nêu đủ ba thứ:

1. Khóa nào trùng (số điện thoại sau chuẩn hoá, `globalId`, ...)
2. Bằng chứng lấy từ đâu
3. Điểm nào **không** khớp — luôn phải có mục này, kể cả khi viết "không thấy điểm nào lệch"

Giao diện duyệt trùng 3 cột đã có sẵn trong CRM. Đề xuất của bạn hiển ở đó, nên hãy viết để người đọc quyết định được trong 5 giây.
