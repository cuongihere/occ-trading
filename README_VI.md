# OCC Trading — Một màn hình quản lý BTC và nhiều coin Futures (Windows)

## Windows — gia cố đảo chiều OCC sau khi đã đóng vị thế (16/11/2026)

- Trước khi gửi MARKET reduceOnly đóng LONG/SHORT, AUTO phải có giá Binance trực tiếp còn hiệu lực, bộ ba TP BTC chia được, cấu hình One-way/ISOLATED/đòn bẩy đúng và tài sản dự kiến đủ ký quỹ chiều ngược. Nếu không đủ, **không đóng vị thế cũ**; STOP cũ vẫn hoạt động.
- Khi Binance xác nhận đã FLAT và dọn sạch SL/TP cũ, bot **không đòi cập nhật aggTrade lần hai** (giá có thể bất ngờ quá hạn khi đang đóng). Dùng giá đã kiểm tra để tính khối lượng, xác nhận tài khoản FLAT và thử **đọc lại** số dư khả dụng tối đa 6 lần nếu Binance đang chậm giải phóng ký quỹ. Không thử lại bất cứ POST đặt lệnh nào có kết quả chưa rõ.
- Khi đủ điều kiện, mở ngay MARKET chiều ngược, xác minh fill, đặt STOP close-all trước TP1/2/3. Bất kỳ POST/FILLED/STOP chưa chắc chắn đều khóa an toàn thay vì gửi trùng.
- Ghi SQLite và báo cáo lịch sử bị lỗi không được phép chặn thao tác đảo chiều hay việc đặt STOP. Trạng thái đảo chiều gần nhất được lưu tại `data/futures-last-reversal.json`, đồng thời hiển thị trong khung Bot: **ĐANG ĐÓNG → ĐÃ ĐÓNG → ĐANG MỞ → ĐẢO XONG**, hoặc **ĐẢO THẤT BẠI**.
- Đây là chuỗi nhiều API Binance, **không có lệnh đảo chiều nguyên tử**; không thể cam kết SHORT luôn khớp khi Binance từ chối lệnh, mạng lỗi, ký quỹ thiếu hay người dùng tắt AUTO giữa chừng. Khi xảy ra lỗi sau khi đã FLAT, bot khóa và báo rõ để kiểm tra; không tự đoán gửi lại.
- Test tự động gồm: giá aggTrade hết hạn sau khi đóng, Binance chậm cập nhật balance, SQLite lỗi khi ghi REVERSE/ENTRY, vốn không đủ trước khi đóng và Binance từ chối MARKET mở chiều ngược.

## Chart Windows: chuỗi lệnh thật và khung thông số (16/11/2026)

- Một chart OCC đang chọn: BTCUSDT hoặc coin USDT Perpetual bất kỳ đã thêm, có OCC Open/Close + giao cắt LONG/SHORT + fill Binance thực tế.
- Gom lệnh theo Group ID và Binance Order ID, vẽ nối ENTRY → SL/TP/CLOSE/REVERSE bằng giá và thời gian khớp thực.
- Nhãn ngay trên chart: LONG ENTRY, SL HIT, SHORT ENTRY, TP1/TP2/TP3, REVERSE CLOSE. Rê chuột hoặc click marker/nhãn để mở thông số tại khung CHI TIẾT LỆNH bên phải chart.
- Khung chính hiện giá khớp, khối lượng BTC, thời gian, Order ID, P&L nhóm (chưa funding), phí, mức OCC và các bước Entry/Exit. Click bước lệnh hoặc nút Đến vị trí lệnh để xem tại nến giao dịch.
- LONG dính SL rồi xuất hiện SHORT được ghi SAU SL → LỆNH MỚI. Đây chỉ là hai fill Binance theo thời gian, không mặc nhiên là đảo chiều tự động. REVERSE chỉ được gắn khi lệnh thoát thực tế có role REVERSE.
- Lệnh cũ thiếu liên kết Order ID với tín hiệu vẫn báo chưa xác minh; SL/TP đang mở chỉ vẽ từ Binance Algo đã xác minh.
- Không thay đổi logic thực thi lệnh và quản lý SL/TP. Giữ nguyên thư mục data khi cập nhật.


**Giao dịch Futures nhiều mã theo chung một OCC H4/M15**, không có Paper Trading trên bản phát hành. Mỗi coin có ký quỹ, leverage, LIMIT/MARKET, SL, TP1/2/3 và đảo chiều riêng. Biểu đồ và bảng vị thế ở một màn hình; đổi tab coin không ảnh hưởng các coin khác.

## Nâng cấp quản lý đa coin trên một màn hình (23/11/2026)

- Thanh chọn coin nằm ngay trên chart hiện tại: **BTCUSDT, ETHUSDT, SOLUSDT…**, nhấn **+ Coin** để thêm. Chỉ nhận hợp đồng Binance USD-M USDT Perpetual đang TRADING; tối đa 12 mã bổ sung nhằm kiểm soát rate limit.
- Mỗi lần chọn coin chỉ đổi biểu đồ OCC, lệnh Binance, lịch sử và các nút quản lý của coin đang chọn. Bảng vị thế ở dưới vẫn tổng hợp tất cả mã, không có tab AUTO đa mã riêng.
- Trong popup **Cài đặt mã**, chỉnh ký quỹ USDT, leverage 1–20x, LONG/SHORT, MARKET/LIMIT Pullback, SL%, TP1/2/3, tỷ lệ chốt, đảo chiều OCC. Có nút sao chép thông số BTC; nguồn tín hiệu SMMA8 H4/M15 hoàn toàn giống BTC cũ.
- **AUTO coin** chạy độc lập. **Chọn AUTO tổng** chỉ đưa coin vào danh sách được phép bật bằng một nút; không tự đặt lệnh. **BẬT AUTO TỔNG** yêu cầu xác nhận tiền thật, **TẮT TẤT CẢ** giữ các STOP/TP đang trên Binance.
- Mỗi coin có checkpoint và nhật ký lệnh riêng. Khi Binance gửi ACK không rõ, lỗi mạng, thiếu STOP, sai leverage, không đủ lot/notional của TP hoặc có vị thế chưa xác minh: bot khóa, **không gửi lệnh trùng hoặc tự nhận quyền quản lý**. Chỉ tính PnL từng coin từ fill Binance đã xác minh; không trộn ETH với BTC.
- Một luồng xử lý Entry tuần tự kiểm tra lại ký quỹ Binance trước từng coin. Một coin chỉ có tối đa một vị thế bot; không tự mở chồng lệnh. Đảo chiều vẫn đóng reduceOnly → xác nhận FLAT → dọn SL/TP cũ → MARKET chiều ngược → STOP rồi TP.
- Sau khi khởi động lại, **tất cả AUTO đều OFF**; có thể bật lại để xác minh/tiếp quản vị thế bot cũ. Nếu còn lệnh không rõ, kiểm tra trực tiếp Binance.
- Dữ liệu BTC cũ vẫn giữ tại `data/futures-*` và `binance-live-stats.sqlite`. Các coin mới ghi `futures-SYMBOL-*`, `binance-SYMBOL-live-stats.sqlite` và `unified-symbols.json`; **không xóa thư mục `data/`** khi cập nhật.
- Binance Square **chỉ đăng BTCUSDT** sau khi Entry thật FILLED có STOP/TP xác minh; ETH/SOL/altcoin không đăng Square. Scanner toàn thị trường không quay lại.
- Khi nâng cấp từ bản đa mã cũ, các checkpoint `multi-*` không tự chuyển sang bộ máy mới. Trước khi sử dụng AUTO, tự kiểm tra tất cả vị thế và SL/TP cũ trực tiếp trên Binance; không dùng hai bản app cùng tài khoản.

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

- Square **chỉ đăng BTCUSDT đã khớp Entry thực** sau khi xác minh STOP close-all và TP1–TP3; không còn Scanner hay bài tín hiệu altcoin.
- API Futures và API Square được lưu **riêng biệt**. Không chia sẻ API key.
- Binance Square có giới hạn bài/ảnh, chính sách nội dung và giới hạn theo khu vực.
- Futures Transport yêu cầu **một symbol được phê duyệt trên mỗi phiên thực thi**, không có endpoint Scanner toàn thị trường; mỗi coin được kiểm tra trên Binance trước khi thêm.
- Không phát lại tín hiệu trong thời gian mất kết nối. AUTO OFF khi khởi động lại.
- Đảo chiều thực tế: kiểm tra trạng thái Binance, đóng reduceOnly MARKET,
  xác nhận FLAT, mở chiều ngược MARKET và đặt STOP trước các TP.
- Không xóa thư mục `data/` khi cập nhật.
- Nếu Square trả HTTP 504 hoặc mạng mất khi gửi, có thể bài đã đăng.
  Không nhấn đăng lại trước khi kiểm tra trang Square của mình.

Kiểm thử tự động/Windows build không thể thay thế kiểm chứng thực tế tài khoản.
Không chứa khóa Futures/Square mẫu hoặc thông tin cá nhân trong Git.
