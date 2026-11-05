# OCC Trading Android · v0.3.1

APK Android độc lập: không cần PC/VPS, chạy trong lúc ứng dụng đang mở. Màn hình được giữ sáng bằng FLAG_KEEP_SCREEN_ON.

## Sửa lỗi nút Bật Auto (v0.3.1)

- Đăng ký Android WebChromeClient để `confirm()` và `prompt()` hiển thị hộp thoại xác nhận tiền thật; trước đó WebView bỏ qua, dẫn đến nhấn nút nhưng không có phản hồi.
- Nút Bật Auto có thể nhấn ngay cả khi thiếu điều kiện, nhưng sẽ chỉ báo nguyên nhân và **không gửi lệnh** nếu API, giá LIVE, checkpoint hoặc cấu hình chưa hợp lệ.
- Chuyển thông báo cạnh nút Auto. Khi xác nhận thành công: **AUTO ON · CHỜ TÍN HIỆU OCC M15 MỚI**. Không mở lệnh ngay khi bấm nút.
- Đồng bộ các ô cấu hình ngay trước khi kiểm tra; nếu ký quỹ không đủ để tạo 3 TP theo LOT_SIZE, tính mức ký quỹ tối thiểu ước tính từ giá BTC, đòn bẩy và filters Binance; không âm thầm tăng tiền vào lệnh.
- Tách các tác vụ Binance REST công khai, đọc tài khoản và gửi lệnh thành các hàng đợi native riêng để tránh nghẽn mạng trong lúc khởi tạo.

## Chức năng

- OCC SMMA8 H4/M15 nguyên bản; chỉ nhận tín hiệu nến LIVE và không phát lại tín hiệu cũ.
- Binance USD-M BTCUSDT: ví, Equity, P&L, vị thế, giá Entry/Mark/Thanh lý.
- API Key/Secret mã hóa AES-GCM bằng Android Keystore; không lưu localStorage.
- Cấu hình ký quỹ, leverage (đặt lên Binance sau xác nhận), LONG/SHORT, SL và TP1–TP3 theo % hoặc Points, tỷ lệ chốt.
- Bật/tắt Auto với xác nhận tiền thật; khi có tín hiệu mới vào MARKET, xác minh Binance Entry, đặt STOP close-all trước và TP1/2/3 reduceOnly sau.
- Chế độ đảo chiều OCC: đóng MARKET reduceOnly và chỉ xét Entry mới khi Binance xác nhận đã FLAT, không mở vị thế chồng.
- Manual chốt riêng TP1/TP2/TP3: xác minh Algo, hủy TP mục tiêu trước, gửi MARKET giảm lượng chính xác và xác minh lại.
- Manual đóng toàn bộ MARKET: xác minh vị thế OCC, close reduceOnly, sau đó chỉ dọn Algo được OCC xác minh.
- Đồng bộ và phát hiện TP đã khớp dựa vào Binance Algo FINISHED + actualOrderId + child order FILLED; không suy đoán TP khớp chỉ vì lệnh biến mất.
- Checkpoint bền vững trước POST/DELETE, native Android giới hạn mỗi intent một lần gửi; nếu ACK không chắc chắn, HALT và không thử lại lệnh.
- Khi STOP đầu tiên không thiết lập được, thử đóng emergency reduceOnly **một lần** chỉ khi hai lần Binance readback xác minh vị thế thuộc OCC, không có lệnh thường và không có Algo.
- Tự giám sát vị thế đang mở, dọn Algo OCC khi FLAT; khi mở app trở lại Auto luôn OFF và khóa checkpoint chưa đối soát.
- Income BTCUSDT 7 ngày (Realized, commission, funding), userTrades, xuất CSV.

## An toàn và giới hạn

- Không có chế độ chạy nền 24/7; màn hình sáng **không bảo đảm** app không bị Android hay mạng ngắt.
- Bản mới được kiểm thử tự động bằng Binance giả lập và biên dịch APK. **Chưa xác nhận hoạt động end-to-end với tài khoản Binance Futures Production và chưa thử trên điện thoại thật.**
- API chỉ giao dịch BTCUSDT và điều kiện One-way, ISOLATED, leverage đúng cấu hình; không sử dụng để vượt hạn chế dịch vụ theo khu vực.
- Khi lệnh hoặc checkpoint chưa chắc chắn: kiểm tra Binance và bấm **Kiểm tra OCC**. Không tự mở Auto lại. Nếu đang có vị thế không có SL thực tế, xử lý ngay trên Binance.
- Không chạy Auto đồng thời trên PC và Android với cùng tài khoản BTCUSDT.
- API Key nên giới hạn quyền Futures, không cấp quyền rút tiền; dùng IP whitelist khi khả thi.
- Các lệnh Market, Stop và Take Profit có thể trượt giá, bị từ chối hoặc không khớp toàn bộ, dẫn đến mất vốn.

## Build

Workflow GitHub Actions `.github/workflows/android-apk.yml` biên dịch APK với Android Gradle Plugin 8.13.2, Android SDK 35, JDK 17. Đầu ra: `android/app/build/outputs/apk/debug/app-debug.apk`.

Mã: `android/app/src/main/assets/{engine.js,server-feed.js,trade-core.js,trade-execution.js,trade-recovery.js,app.js}`, Java bridge `android/app/src/main/java/com/occtrading/mobile/MainActivity.java`.

APK v0.3 dùng package `com.occtrading.mobile`, cập nhật trực tiếp từ v0.2 nếu Android cho phép cùng chữ ký debug; nếu chữ ký thay đổi do GitHub runner khác nhau, phải gỡ bản trước rồi cài mới, sao lưu cấu hình trước khi gỡ.
