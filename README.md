# OCC Trading — Windows Portable Paper Trader

**[Hướng dẫn tiếng Việt](README_VI.md)** · Windows x64 · BTCUSDT Binance USD-M Futures · chỉ mô phỏng.

## Tải gói portable chạy ngay

1. Mở [GitHub Actions – Windows portable](https://github.com/cuongihere/occ-trading/actions/workflows/windows-portable.yml).
2. Chọn lần chạy mới nhất **thành công** (dấu ✓), tải artifact **OCC_Portable_Windows_x64** trong mục Artifacts.
3. Giải nén ZIP của GitHub, rồi giải nén file **OCC_Portable_Windows_x64.zip** bên trong.
4. Vào thư mục **OCC_Portable** và bấm **START_WINDOWS.bat**. Dashboard mở tại http://127.0.0.1:8080.

Gói đã build có sẵn runtime/node.exe chính thức được xác minh SHA256, **không cần cài Node.js, npm hay thư viện nào**. Chạy app vẫn cần Internet để lấy dữ liệu Binance.

Nếu chỉ tải bằng Code → Download ZIP, đó là mã nguồn chưa có runtime. START_WINDOWS.bat sẽ tự tải Node.js chính thức **một lần vào chính thư mục runtime/** rồi xác minh SHA256; cần mạng ở lần đầu.

## Ứng dụng

- OCC R5.1: SMMA8, M15/H4, delay 0, BOTH; H4 đang hình thành có thể đổi tín hiệu.
- Paper position ~10% equity, không đòn bẩy, chỉ dùng Multi TP v5, chốt từng phần TP1/TP2/TP3 và SL %, chưa tính funding.
- Binance BTCUSDT perpetual public data; không API key, tài khoản hay lệnh thật.
- Dashboard mới, biểu đồ P&L đã đóng, lịch sử phiên, thắng/thua, CSV/JSON.
- SQLite và lịch sử trong data/ cùng thư mục. Xem [Pine SL/TP mapping](PINE_EXIT_MAPPING.md). Sau khi mở lại, ứng dụng tự tiếp tục nếu trước đó bạn đã bật mô phỏng (chỉ sau khi đồng bộ Binance); nếu đã tạm dừng thì vẫn tạm dừng.

## Phát triển / kiểm thử

Yêu cầu Node.js 24+ cho dev; không có npm dependencies:

~~~sh
node --test
node server.mjs
~~~

Kết quả mô phỏng chưa được xác minh parity TradingView hoặc khả năng khớp lệnh thật. Nếu nguồn Binance trả 451/403 theo vùng, app không bypass. Dùng Windows artifact chỉ khi workflow báo thành công. Xem README_VI.md để biết chi tiết.

## Dữ liệu xuyên lần mở

SQLite checkpoint giữ vốn, vị thế, lệnh, P&L và cấu hình. Sửa Multi TP khi tạm dừng/không còn vị thế không tạo phiên mới. Bảng thời gian gián đoạn ghi tắt app, mất kết nối, thời điểm khôi phục (giờ Việt Nam); không replay fills trong lúc offline. Thống kê mặc định là tổng lịch sử vị thế đóng; equity vẫn là số dư tài khoản hiện tại, không cộng vốn từng đợt thử cũ.
