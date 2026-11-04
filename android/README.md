# OCC Trading Android — bản chạy trực tiếp trên điện thoại

## Trạng thái hiện tại

Đây là **Android APK Preview v0.1**: ứng dụng độc lập (không cần PC/VPS/Termux), đọc giá Binance USD-M Futures BTCUSDT và chạy bộ nhận diện tín hiệu OCC SMMA8 H4/M15 **gốc** được copy từ `engine.mjs` (chỉ phần tín hiệu). Native Java làm cầu nối chỉ đọc REST công khai; WebSocket theo dõi giá, Mark Price và nến 15m. Khi app ở foreground, Android dùng `FLAG_KEEP_SCREEN_ON` để màn hình không tự tắt.

**KHÔNG giao dịch tiền thật; KHÔNG có chức năng nhập/lưu API Key; KHÔNG có nút Auto đặt lệnh.** Không nhầm bản Preview với OCC Trading Futures desktop đã có thực thi Binance.

Mở app + giữ màn hình sáng làm giảm gián đoạn nhưng không bảo đảm uptime: có thể mất Wi‑Fi/4G, dịch vụ Binance bị giới hạn theo vùng, pin cạn, Android kill app, reboot... Không nên dùng điện thoại như một máy chủ giao dịch thật mà không có fail-safe.

## Build APK

1. GitHub Actions → **Android standalone preview APK** → workflow run gần nhất **Success**.
2. Tải artifact **OCC_Android_Standalone_Preview_APK**, giải nén lấy `app-debug.apk`.
3. Cài APK trên Android. Đây là APK debug, có thể bị cảnh báo vì cài từ nguồn ngoài.
4. Để máy có Internet, mở app; giao diện báo trạng thái Binance và tín hiệu LIVE mới.

Workflow: `.github/workflows/android-apk.yml`. Code: `android/app/src/main/`. Yêu cầu build: JDK 17, Android SDK 35, Gradle 8.13, Android Gradle Plugin 8.13.2. Có thể build bằng Android Studio qua thư mục `android/`.

## Bước cần làm trước khi cho phép Auto giao dịch thật

- Port toàn bộ quản lý lệnh, checkpoint, stop loss, TP1/2/3 và xác minh readback Binance Futures sang Android (không thể dùng Windows DPAPI / Node `node:sqlite` trực tiếp).
- Android Keystore để mã hóa khóa giao dịch, không lưu plaintext; không cấp quyền rút tiền; whitelist IP nếu vận hành được.
- Cơ chế đảm bảo chỉ một thiết bị/tiến trình điều khiển giao dịch; không đồng thời chạy Auto trên Windows và Android.
- Khởi động lại, mất mạng, lệnh khớp một phần, SL thất bại, lệnh không rõ kết quả phải chuyển HALT và đối soát Binance trước khi cho phép đặt lệnh mới.
- Kiểm thử giả lập Binance đầy đủ và paper-mode trước, rồi thử với số vốn nhỏ khi đã tự đánh giá rủi ro.
- App mở với màn sáng không ngăn OS/mạng gián đoạn. Nếu muốn chạy nền cần thiết kế Foreground Service, nhưng nó cũng không bảo đảm 100% uptime.

## Kiến trúc Preview

- `engine.js`: bản trình duyệt của `engine.mjs`, giữ nguyên thuật toán OCC đã duyệt; không đặt lệnh.
- `server-feed.js`: logic nến, đồng bộ và WebSocket gốc; REST công khai được gọi qua native allowlist.
- `MainActivity.java`: WebView offline-hosted và kết nối Binance REST **chỉ đọc** bằng native `HttpsURLConnection`.
- `app.js`: truyền dữ liệu cho bộ chỉ báo, hiển thị tín hiệu; không có API giao dịch/ghi.

Ứng dụng không tự động tạo lệnh Futures. Đây là bước nền để port an toàn sang Android, không phải bản Auto Trade hoàn chỉnh.
