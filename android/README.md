# OCC Trading Android · v0.3.3

## Sửa giá LAST và Auto (v0.3.3)

- Mã nguồn phát hiện trường hợp WebSocket báo LIVE nhờ Mark/candle hoặc giao dịch trùng, nhưng giá LAST không nhận cập nhật mới.
- Điều kiện LIVE/Auto dùng cùng một giao dịch BTCUSDT `aggTrade` duy nhất và thời gian nhận trực tiếp trong 10 giây gần nhất. Không nới lỏng xác minh để cho phép giao dịch khi giá cũ.
- Khi giá LAST quá hạn, giao diện hiện `GIÁ CŨ`, thay LAST bằng `—`, ghi giờ nhận cuối và có nút `Nối lại giá`.
- Không sử dụng giá cũ khi bật Auto hoặc vào lệnh; sau khi khôi phục cần chờ nến/tín hiệu OCC LIVE mới.



APK Android độc lập: không cần PC/VPS, chạy trong lúc ứng dụng đang mở. Màn hình được giữ sáng bằng FLAG_KEEP_SCREEN_ON.

## Kiểm tra Auto (v0.3.2)

- Nút **Kiểm tra Auto** nằm cạnh **Bật Auto**: đọc trực tiếp tài khoản và filter Binance, hiển thị ngay kết quả trước khi xác nhận tiền thật.
- Tách rõ nguyên nhân không bật: API chưa kết nối, giá chưa LIVE, còn vị thế BTCUSDT, lệnh thường/Algo, sai ISOLATED, sai leverage, không đủ ký quỹ chia 3 TP.
- Ước lượng ký quỹ tối thiểu theo giá Binance và tỷ lệ TP, không tự tăng số tiền giao dịch. Bật Auto sẽ luôn kiểm tra lại một lần nữa sau xác nhận.

## Các sửa lỗi trước đó (v0.3.1)

- Đăng ký Android WebChromeClient để `confirm()` và `prompt()` hiển thị hộp thoại xác nhận tiền thật; trước đó WebView bỏ qua, dẫn đến nhấn nút nhưng không có phản hồi.
- Nút Bật Auto có thể nhấn ngay cả khi thiếu điều kiện, nhưng sẽ chỉ báo nguyên nhân và **không gửi lệnh** nếu API, giá LIVE, checkpoint hoặc cấu hình chưa hợp lệ.
- Chuyển thông báo cạnh nút Auto. Khi xác nhận thành công: **AUTO ON · CHỜ TÍN HIỆU OCC M15 MỚI**. Không mở lệnh ngay khi bấm nút.
- Đồng bộ các ô cấu hình ngay trước khi kiểm tra; nếu ký quỹ không đủ để tạo 3 TP theo LOT_SIZE, tính mức ký quỹ tối thiểu ước tính từ giá BTC, đòn bẩy và filters Binance; không âm thầm tăng tiền vào lệnh.
- Tách các tác vụ Binance REST công khai, đọc tài khoản và gửi lệnh thành các hàng đợi native riêng để tránh nghẽn mạng trong lúc khởi tạo.

## Entry LIMIT chờ hồi giá (tùy chọn, MARKET vẫn mặc định)

- Chọn `Cấu hình Auto → Kiểu vào lệnh: LIMIT chờ hồi giá`. Mốc giá mặc định **giá giao cắt hai đường MA OCC trên nến M15 đã xác nhận** (`crossPrice=(openSeries+closeSeries)/2`); có thể chuyển sang giá đóng nến M15.
- LIMIT LONG = giá *thấp hơn* cả mốc giao cắt và BTCUSDT LAST hiện tại, LIMIT SHORT = giá *cao hơn*. Lệch mặc định 0,05% và làm tròn theo PRICE_FILTER Binance, không thay đổi SL/TP 1/2/3% hay tỷ lệ 33/33/34. Giá MA có thể xa giá giao dịch thực, dẫn đến không khớp.
- Chờ tối đa 90 giây khi app còn hoạt động. Hết thời gian hoặc Binance báo `PARTIALLY_FILLED`, OCC hủy phần LIMIT chưa khớp trước rồi mới xác minh vị thế và đặt STOP trước TP. Nếu lượng BTC khớp không đủ lot chia 3 TP, app giữ STOP close-all, tắt Auto và yêu cầu người dùng xử lý phần còn lại.
- Để tránh GTC tồn tại vô hạn nếu Android bị tắt đột ngột, LIMIT đặt lên Binance bằng `timeInForce=GTD` với hạn dự phòng khoảng **11 phút** (do Binance yêu cầu GTD từ 600 giây trở lên). Khả năng hủy sau 90 giây **phụ thuộc app còn chạy, có mạng và API Binance hoạt động**.
- **RỦI RO QUAN TRỌNG:** nếu Android bị kill, mất mạng hoặc mất điện thoại trong thời gian LIMIT chờ, lệnh có thể khớp sau đó nhưng STOP/TP chưa được app đặt. Không có OCO/SL tự động đi kèm một cách nguyên tử trên sàn với lệnh entry này. Không coi đây là phiên bản giao dịch 24/7 an toàn không giám sát. Nhấn `Tắt Auto` hoặc `Hủy LIMIT` khi app còn mạng để hủy lệnh và đối soát Binance.
- LIMIT không chắc tốt hơn MARKET: có thể bỏ lỡ xu hướng, khớp một phần, hoặc vẫn chịu phí taker nếu lệnh đã trở thành marketable lúc gửi. Không tự chuyển LIMIT sang MARKET để đuổi giá.
- Trước khi giao dịch thật phải thử từng kịch bản và xác nhận trong Binance: LIMIT NEW/PARTIALLY_FILLED/FILLED, hủy, STOP, TP, khởi động lại; thử bằng số vốn chịu rủi ro.

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
