## Windows — gia cố đảo chiều OCC sau khi đã đóng vị thế (16/11/2026)

- Trước khi gửi MARKET reduceOnly đóng LONG/SHORT, AUTO phải có giá Binance trực tiếp còn hiệu lực, bộ ba TP BTC chia được, cấu hình One-way/ISOLATED/đòn bẩy đúng và tài sản dự kiến đủ ký quỹ chiều ngược. Nếu không đủ, **không đóng vị thế cũ**; STOP cũ vẫn hoạt động.
- Khi Binance xác nhận đã FLAT và dọn sạch SL/TP cũ, bot **không đòi cập nhật aggTrade lần hai** (giá có thể bất ngờ quá hạn khi đang đóng). Dùng giá đã kiểm tra để tính khối lượng, xác nhận tài khoản FLAT và thử **đọc lại** số dư khả dụng tối đa 6 lần nếu Binance đang chậm giải phóng ký quỹ. Không thử lại bất cứ POST đặt lệnh nào có kết quả chưa rõ.
- Khi đủ điều kiện, mở ngay MARKET chiều ngược, xác minh fill, đặt STOP close-all trước TP1/2/3. Bất kỳ POST/FILLED/STOP chưa chắc chắn đều khóa an toàn thay vì gửi trùng.
- Ghi SQLite và báo cáo lịch sử bị lỗi không được phép chặn thao tác đảo chiều hay việc đặt STOP. Trạng thái đảo chiều gần nhất được lưu tại `data/futures-last-reversal.json`, đồng thời hiển thị trong khung Bot: **ĐANG ĐÓNG → ĐÃ ĐÓNG → ĐANG MỞ → ĐẢO XONG**, hoặc **ĐẢO THẤT BẠI**.
- Đây là chuỗi nhiều API Binance, **không có lệnh đảo chiều nguyên tử**; không thể cam kết SHORT luôn khớp khi Binance từ chối lệnh, mạng lỗi, ký quỹ thiếu hay người dùng tắt AUTO giữa chừng. Khi xảy ra lỗi sau khi đã FLAT, bot khóa và báo rõ để kiểm tra; không tự đoán gửi lại.
- Test tự động gồm: giá aggTrade hết hạn sau khi đóng, Binance chậm cập nhật balance, SQLite lỗi khi ghi REVERSE/ENTRY, vốn không đủ trước khi đóng và Binance từ chối MARKET mở chiều ngược. Không thay đổi Android.

# OCC Trading — Binance Futures Windows

## Chart Windows: chuỗi lệnh thật và khung thông số (16/11/2026)

- Một chart nến BTCUSDT: OCC Open/Close + giao cắt LONG/SHORT + fill Binance thực tế.
- Gom lệnh theo Group ID và Binance Order ID, vẽ nối ENTRY → SL/TP/CLOSE/REVERSE bằng giá và thời gian khớp thực.
- Nhãn ngay trên chart: LONG ENTRY, SL HIT, SHORT ENTRY, TP1/TP2/TP3, REVERSE CLOSE. Rê chuột hoặc click marker/nhãn để mở thông số tại khung CHI TIẾT LỆNH bên phải chart.
- Khung chính hiện giá khớp, khối lượng BTC, thời gian, Order ID, P&L nhóm (chưa funding), phí, mức OCC và các bước Entry/Exit. Click bước lệnh hoặc nút Đến vị trí lệnh để xem tại nến giao dịch.
- LONG dính SL rồi xuất hiện SHORT được ghi SAU SL → LỆNH MỚI. Đây chỉ là hai fill Binance theo thời gian, không mặc nhiên là đảo chiều tự động. REVERSE chỉ được gắn khi lệnh thoát thực tế có role REVERSE.
- Lệnh cũ thiếu liên kết Order ID với tín hiệu vẫn báo chưa xác minh; SL/TP đang mở chỉ vẽ từ Binance Algo đã xác minh.
- Không thay đổi logic thực thi lệnh, quản lý SL/TP hoặc Android. Giữ nguyên thư mục data khi cập nhật.


**Chỉ giao dịch BTCUSDT Futures thực tế.** Đã bỏ Paper Trading khỏi ứng dụng,
trang web và gói Portable. Phần kiểm thử mã mô phỏng cũ chỉ tồn tại trong
mã nguồn để kiểm tra chiến lược; hoàn toàn không chạy trong ứng dụng.

## Chạy app

1. Tải artifact Windows x64 từ [GitHub Actions](https://github.com/cuongihere/occ-trading/actions/workflows/windows-portable.yml) sau khi build PASS.
2. Giải nén hai lớp ZIP, giữ lại toàn bộ thư mục `data/` cũ.
3. Chạy `START_WINDOWS.bat`, mở `http://127.0.0.1:8080/binance`.
4. Kết nối API Binance Futures; AUTO mặc định OFF. Chỉ bật khi nắm rõ
   cấu hình giao dịch, SL/TP và rủi ro.

## OCC Scanner → Binance Square · Toàn bộ USDⓈ-M Perpetual (PC, 20/11/2026)

- Mở tab **OCC Scanner · Square** tại `http://127.0.0.1:8080/occ-scanner`. Chức năng **tách độc lập khỏi AUTO Trading BTCUSDT**; bật Scanner hoặc tắt AUTO Trade không làm thay đổi lệnh Binance Futures. Code chỉ truy vấn các endpoint công khai `exchangeInfo`, `ticker/24hr`, `klines`; **không có API đặt lệnh cho các mã khác**.
- Scanner lấy **toàn bộ hợp đồng USD-M Perpetual đang TRADING có quote asset USDT** trên Binance, khởi tạo SMMA8 H4/M15 từ dữ liệu quá khứ. Khi vừa bật hoặc mở lại app chỉ khởi tạo, **không phát lại tín hiệu cũ**; tín hiệu mới xuất hiện khi nến M15 đóng sau khi scanner đã sẵn sàng. Bỏ qua giao cắt bị trễ trên 10 phút và backfill có khoảng trống; tự tái khởi tạo từng mã khi mất nến.
- **Tự đăng Square mặc định OFF riêng**, phải tích chọn và xác nhận. Dùng Square OpenAPI key đã lưu mã hóa Windows DPAPI ở phần Cài đặt BTC (không phải Futures API). Scanner vẫn quét và hiển thị LONG/SHORT ngay cả khi AUTO Trade BTC hoặc chế độ đăng Square sau Entry thật đang OFF.
- **Lọc bài đăng**, không lọc phạm vi quét: thanh khoản 24h mặc định từ **10 triệu USDT**, tối đa **3 bài/chu kỳ**, **15 bài/ngày** (tính cả bài Trade BTC), chỉnh được trong Scanner với trần 20 bài/ngày. Ưu tiên mã có quote volume cao; không tuyên bố kết quả hay xác suất thắng.
- **Tín hiệu chưa khớp** chỉ ghi giá đóng nến M15, SL và TP1/TP2/TP3 tham khảo từ các phần trăm Scanner, mặc định 0,8% / 1,5% / 3% / 5%. Đây không phải lệnh limit/market, không đặt SL/TP lên sàn. Hình chart từ nến Binance M15, tiêu đề đúng ký hiệu Futures, không hiện tên chỉ báo OCC/SMMA.
- **Câu bắt buộc trong MỌI bài tín hiệu Scanner (nguyên văn):**

  **Đây là Tín hiệu phân tích kỹ thuật, chưa phải giao dịch đã khớp.**

- Bài Square **sau khi khớp Entry BTC thật** vẫn ở chế độ riêng, ghi Entry đã khớp thực sự và không được mô tả sai thành tín hiệu chưa khớp. Câu cảnh báo trên chỉ dành cho các bài phân tích chưa thực thi.
- Mọi bài tín hiệu có khóa chống trùng `SYMBOL:M15:barTime:side`, lưu bền trong `data/square-publisher.json`. Nếu Square trả ACK không rõ / HTTP 504, ghi `REVIEW_REQUIRED` và **không retry** nhằm tránh đăng lặp. Cấu hình, dấu lịch sử tín hiệu lưu trong `data/occ-square-scanner.json`; cần giữ `data/` khi cập nhật Portable.
- Lượng request lớn khi quét toàn bộ Futures; scanner giới hạn chạy đồng thời, làm mới universe sau 3 giờ và dừng tạm thời nếu Binance trả 429/418. Cần có mạng và app PC đang chạy; không chạy nền khi app tắt.
- Cảnh báo đăng bài giúp phân biệt tín hiệu và lệnh đã khớp nhưng **không tự động miễn trừ nghĩa vụ pháp lý**; người vận hành vẫn phải tuân thủ quy định nền tảng và pháp luật.

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

- **Hai nhánh Square độc lập:** bài BTC Futures đã khớp từ lệnh OCC và bài tín hiệu phân tích Scanner chưa khớp; không dùng tín hiệu Scanner làm lệnh giao dịch thật.\n
- API Futures và API Square được lưu **riêng biệt**. Không chia sẻ API key.
- Binance Square có giới hạn bài/ảnh, chính sách nội dung và giới hạn theo khu vực.
- Nhánh bài **TRADE BTC** chỉ đẩy khi Entry đã khớp và SL/TP xác minh. Nhánh **SIGNAL Scanner** được phép đăng giao cắt M15 mới nhưng bắt buộc ghi rõ *chưa phải giao dịch đã khớp* và không được gửi lệnh.
- Không phát lại tín hiệu trong thời gian mất kết nối. AUTO OFF khi khởi động lại.
- Đảo chiều thực tế: kiểm tra trạng thái Binance, đóng reduceOnly MARKET,
  xác nhận FLAT, mở chiều ngược MARKET và đặt STOP trước các TP.
- Không xóa thư mục `data/` khi cập nhật.
- Nếu Square trả HTTP 504 hoặc mạng mất khi gửi, có thể bài đã đăng.
  Không nhấn đăng lại trước khi kiểm tra trang Square của mình.

Kiểm thử tự động/Windows build không thể thay thế kiểm chứng thực tế tài khoản.
Không chứa khóa Futures/Square mẫu hoặc thông tin cá nhân trong Git.
