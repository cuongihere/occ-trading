# OCC Trading — Binance Futures Windows

**Chỉ giao dịch BTCUSDT Futures thực tế.** Đã bỏ Paper Trading khỏi ứng dụng,
trang web và gói Portable. Phần kiểm thử mã mô phỏng cũ chỉ tồn tại trong
mã nguồn để kiểm tra chiến lược; hoàn toàn không chạy trong ứng dụng.

## Chạy app

1. Tải artifact Windows x64 từ [GitHub Actions](https://github.com/cuongihere/occ-trading/actions/workflows/windows-portable.yml) sau khi build PASS.
2. Giải nén hai lớp ZIP, giữ lại toàn bộ thư mục `data/` cũ.
3. Chạy `START_WINDOWS.bat`, mở `http://127.0.0.1:8080/binance`.
4. Kết nối API Binance Futures; AUTO mặc định OFF. Chỉ bật khi nắm rõ
   cấu hình giao dịch, SL/TP và rủi ro.

## Tự đăng Binance Square sau khi có giao dịch thực

- Vào [Square Creator Center](https://www.binance.com/square/creator-center/home) → tạo **Square OpenAPI key đăng bài**, KHÔNG phải API Futures.
- Trong **Cài đặt → Binance Square**, nhập key vào ô riêng, nhấn **Lưu khóa Square**. Khóa được mã hóa bằng Windows DPAPI và lưu trong `data/square-post.dpapi.json`; không nằm trong HTML hoặc localStorage.
- Bật **Đăng ảnh chart sau khi Entry khớp và SL/TP xác nhận** và chấp thuận cảnh báo bài đăng công khai. Mặc định tính năng **OFF** cho tới khi người dùng kết nối key riêng và bật.
- Khi OCC đặt lệnh FUTURES mới: bot chờ **Binance xác nhận FILLED** và có **STOP close-all + 3 TP reduceOnly thực sự đang hoạt động**. Sau đó mới tạo PNG từ nến **BTCUSDT M15 Binance Futures** và các mức Entry/SL/TP1–3.
- Caption công khai chỉ có `$BTCUSDT PERPETUAL | LONG/SHORT`, `ENTRY`, `SL`, `TP1`, `TP2`, `TP3`.
- Ảnh không hiển thị: OCC, SMMA, tên/phương pháp giao cắt, chỉ báo/strategy,
  API key, ký quỹ, đòn bẩy, số dư, khối lượng BTC, ID lệnh hoặc P&L.
- Mỗi Entry Order ID có một bản ghi `data/square-publisher.json`; ảnh
  ở `data/square-publications/`. Nếu lỗi/timeout sau khi bắt đầu đăng,
  app chuyển `REVIEW_REQUIRED` và **KHÔNG tự gửi lại** để tránh bài trùng.
  Phải kiểm tra Square thủ công.
- Đăng Square độc lập với giao dịch: Square thất bại không được phép làm bot
  sửa, hủy hoặc lặp lại lệnh Binance.
- Chỉ phát bài với **lệnh mới sau khi chức năng Square đã bật**; không tự hồi tố lệnh cũ.

Xem ảnh PNG đã tạo gần nhất bằng **Xem ảnh chart** trong Cài đặt.
Kiểm tra tình trạng đăng qua ô trạng thái Square trong app.
Về API: Binance Square OpenAPI dùng `/image/presignedUrl`,
`/image/imageStatus` và `/content/add`; đăng ảnh tùy quyền tài khoản.

## Quy tắc an toàn

- API Futures và API Square được lưu **riêng biệt**. Không chia sẻ API key.
- Binance Square có giới hạn bài/ảnh, chính sách nội dung và giới hạn theo khu vực.
- Chỉ đẩy bài **khi Entry đã khớp và SL/TP đã xác minh**; LIMIT còn chờ hoặc
  tín hiệu mới xuất hiện không được coi là vị thế đã vào.
- Không phát lại tín hiệu trong thời gian mất kết nối. AUTO OFF khi khởi động lại.
- Đảo chiều thực tế: kiểm tra trạng thái Binance, đóng reduceOnly MARKET,
  xác nhận FLAT, mở chiều ngược MARKET và đặt STOP trước các TP.
- Không xóa thư mục `data/` khi cập nhật.
- Nếu Square trả HTTP 504 hoặc mạng mất khi gửi, có thể bài đã đăng.
  Không nhấn đăng lại trước khi kiểm tra trang Square của mình.

Kiểm thử tự động/Windows build không thể thay thế kiểm chứng thực tế tài khoản.
Không chứa khóa Futures/Square mẫu hoặc thông tin cá nhân trong Git.
