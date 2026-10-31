# OCC Trading — Paper Portable

**[Hướng dẫn tiếng Việt](README_VI.md)** · Windows x64 · Chỉ mô phỏng, không lệnh thật.

Ứng dụng OCC dùng dữ liệu công khai Binance USD-M BTCUSDT perpetual, lưu lịch sử và thống kê thắng/thua bằng SQLite cục bộ.

- Cố định M15 / H4, SMMA 8, delay 0, BOTH, Classic SL/TP 0; giá trị mỗi vị thế khoảng 10% equity. Không đòn bẩy, không stop loss.
- Phí/trượt giá là giả định mô phỏng; chưa tính funding. Không API key, không kết nối tài khoản sàn.
- Dashboard chỉ bind 127.0.0.1:8080. Máy cần bật, có mạng và không ngủ; khởi động lại luôn ở trạng thái tạm dừng.
- Mã nguồn không chứa runtime nhị phân hay dữ liệu cá nhân. **Download ZIP từ GitHub chưa có runtime**: làm theo README_VI để thêm runtime chính thức, không cần cài Node.js hệ thống.
- Không có hosting hay triển khai đám mây trong kho này.

## Chạy và kiểm thử

Node.js 24+; không có dependency ngoài, không cần npm install.

```sh
node server.mjs
node --test
```

Windows portable dùng `runtime\node.exe`; bấm `START_WINDOWS.bat`. Dữ liệu được tạo trong `data/`; dừng chương trình trước khi sao lưu toàn bộ thư mục.

31 kiểm thử tự động đã chạy thành công trên Linux / Node.js 24: engine, feed fixtures, SQLite, restart/replay và thống kê vị thế. **Chưa kiểm thử trực tiếp trên Windows**. Kết nối Binance thực tế từ môi trường kiểm thử bị HTTP 451; chưa xác minh chu kỳ M15 trực tiếp hoặc parity TradingView. Không fallback sang giá giả hoặc chuyển vùng.

## Thành phần

- `engine.mjs`: logic tín hiệu / paper fills.
- `server-feed.mjs`: dữ liệu công khai Binance và đồng bộ lại.
- `store.mjs`, `stats.mjs`: nhật ký SQLite và thống kê vị thế đã đóng.
- `server.mjs`: HTTP localhost và giao diện.
- `*.test.mjs`, `test/`: kiểm thử.
- `PORTABLE_BUILD.md`, `RUNTIME_SOURCE.txt`: nguồn runtime, checksum và cách đóng gói.

Node.js và các thành phần của nó giữ giấy phép upstream riêng. Xem `LICENSE` trong ZIP Node.js chính thức; luôn giữ file này trong gói portable phân phối. Kho này không tự cấp thêm giấy phép cho mã ứng dụng.
