# OCC Trading Android (v0.2)

APK độc lập, không cần PC hoặc VPS. Ứng dụng giữ màn hình sáng khi mở (FLAG_KEEP_SCREEN_ON), dùng WebView chứa toàn bộ giao diện HTML/JS đóng gói trong APK.

## Đã hoạt động

- Giá BTCUSDT Futures LAST, Mark qua WebSocket Binance.
- Bộ chỉ báo OCC SMMA8 theo H4/M15 nguyên bản của desktop, chỉ nhận tín hiệu từ nến LIVE đóng hợp lệ.
- Kết nối API Binance Futures để **đọc** ví, Equity, ký quỹ, vị thế BTC, giá thanh lý, mức SL/TP đang mở.
- API Key/Secret chỉ gửi qua native Java và được mã hóa bằng Android Keystore (AES-GCM) nếu chọn lưu trên máy; không đưa vào tệp mã nguồn/JavaScript localStorage.
- Đối chiếu BTCUSDT Income 7 ngày và lịch sử `userTrades`, hiển thị Realized + phí + funding; xuất CSV qua Android Share sheet.
- Lưu cấu hình SL/TP vào bộ nhớ riêng của ứng dụng, giao diện gọn không có các đoạn hướng dẫn.

## CHƯA hoạt động

**Đây chưa phải bản tương đương Auto Trade Windows. AUTO trên Android bị KHÓA.**

Các tính năng chưa được chuyển: gửi lệnh MARKET tự động, đặt/cập nhật SL/TP, đảo chiều theo tín hiệu OCC, chốt thủ công và đối soát checkpoint sau đứt kết nối với lệnh thật. Lớp native cố tình chặn toàn bộ POST/DELETE của signed Binance Futures; chỉ cho phép GET. Các giá SL/TP hiện trên Android là lệnh được đọc từ Binance, không phải lệnh Android đặt.

Bộ máy đặt lệnh Futures phải được port và kiểm thử độc lập, gồm readback-verified ACK, SQLite/checkpoint durable, tránh duplicate order, phát hiện vị thế lạ, xử lý lệnh khớp một phần, manual reduceOnly và đối soát tất cả lệnh Algo. Không kích hoạt nút Auto tiền thật khi chưa có các điều kiện này.

## Build

GitHub Actions: `.github/workflows/android-apk.yml` → artifact `OCC_Android_Standalone_Preview_APK` → `app-debug.apk`.

Android SDK 35 + JDK 17 + AGP 8.13.2 + Gradle 8.13. Tích hợp sẵn các assets:
- `android/app/src/main/assets/engine.js` từ `engine.mjs`.
- `android/app/src/main/assets/server-feed.js` phiên bản dùng native public REST.
- `android/app/src/main/assets/app.js` UI và các API đọc.
- `android/app/src/main/java/com/occtrading/mobile/MainActivity.java` Android Keystore, HTTPS REST signing (signed GET allowlist).

**Hạn chế hoạt động:** Màn hình sáng giảm nguy cơ bị Android dừng trong foreground nhưng không bảo đảm uptime 24/7 khi mất mạng, máy nóng, pin cạn, reboot, hạn chế Binance theo vùng.
