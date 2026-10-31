# OCC Trading — Hướng dẫn Windows Portable

**Chỉ mô phỏng. Không đặt lệnh thật, không kết nối tài khoản Binance và không sử dụng API key.**

## 1. Tải gói đã có đầy đủ thành phần

1. Vào [GitHub Actions – Windows portable](https://github.com/cuongihere/occ-trading/actions/workflows/windows-portable.yml).
2. Chọn workflow gần nhất báo **Success** (✓). Tải artifact tên **OCC_Portable_Windows_x64** ở cuối trang. Có thể cần đăng nhập GitHub.
3. Giải nén file tải về; bên trong có **OCC_Portable_Windows_x64.zip**. Giải nén tiếp để có thư mục **OCC_Portable**.
4. Trong OCC_Portable, bấm đúp **START_WINDOWS.bat**. Giao diện mở tại **http://127.0.0.1:8080**.
5. Đợi Binance đồng bộ xong, sau đó bấm **Bắt đầu mô phỏng**.

Gói này có sẵn runtime Node.js chính thức trong thư mục **runtime/**, bao gồm node.exe và file LICENSE upstream. Không cần cài Node.js, Python, npm, hay chương trình hỗ trợ. Không cần quyền Administrator, thay đổi PATH hoặc registry. Chỉ hỗ trợ Windows x64.

## 2. Nếu tải bằng Code → Download ZIP của GitHub

Đây là source ZIP **chưa chứa node.exe**. Khi bạn bấm START_WINDOWS.bat lần đầu, script BOOTSTRAP_RUNTIME.ps1:
- Tải Node.js v24.22.2 Windows x64 từ **nodejs.org HTTPS** vào thư mục tạm nằm trong folder app;
- Kiểm tra SHA256 của toàn bộ ZIP và node.exe; nếu sai sẽ dừng, không chạy file tải;
- Chép các file chính thức vào **runtime/**; xóa tệp tải tạm;
- Các lần chạy sau xác minh runtime và dùng bản đã tải, không cần tải lại nếu hợp lệ.

Lần đầu cần Internet và quyền ghi vào thư mục. PowerShell có sẵn trên Windows được khởi chạy với ExecutionPolicy Bypass **trong tiến trình đó**, không chỉnh chính sách máy và không tắt Microsoft Defender. Nếu có cảnh báo, hãy xác minh nguồn ZIP/code trước khi chạy. Xem RUNTIME_SOURCE.txt để đối chiếu checksum.

## 3. Vận hành

- Mỗi lần mở app mặc định **tạm dừng**, không tự bắt đầu giao dịch mô phỏng.
- Nút **Bắt đầu mô phỏng** chỉ hoạt động khi feed đủ dữ liệu; **Tạm dừng** không đóng vị thế đang mở.
- **Kết nối lại Binance** để đồng bộ lại. Nếu API báo HTTP 451/403 theo vùng, app sẽ không đổi endpoint/lách hạn chế.
- Đóng tab trình duyệt không dừng server. Dừng bằng **Ctrl+C** tại cửa sổ lệnh.
- Máy phải đang bật, không ngủ và có mạng. Không có dịch vụ đám mây/VPS.
- Đừng mở hai bản cùng thư mục data. Nếu cổng 8080 đang bận, đóng bản OCC đang chạy trước.

## 4. Dashboard và số liệu

- Giá BTC và mark price, equity ảo, P&L phiên, vị thế LONG/SHORT.
- Biểu đồ P&L cộng dồn của **vị thế đã đóng**; thắng/thua/hòa, tỷ lệ thắng và chuỗi thua.
- Chọn phiên hiện tại, toàn bộ phiên hoặc từng phiên; bảng hiển thị 100 vị thế mới nhất.
- Xuất **CSV đầy đủ** vị thế đã đóng, từng lần khớp và JSON tín hiệu.
- Tạo phiên mới cho phép chỉnh vốn, phí, slippage và SL/TP (Classic v3 / Multi TP v5), bắt buộc xác nhận. Lịch sử phiên cũ giữ lại.

Tỷ lệ thắng = số vị thế thắng chia tổng số vị thế đóng, bao gồm vị thế hòa. Thống kê dựa trên P&L trừ **cả phí mở và đóng**; slippage đã có trong giá mô phỏng. Vị thế đang mở không tính thắng/thua. Funding chưa được tính.

## 5. Cấu hình chiến lược và SL/TP

**BTCUSDT perpetual · M15/H4 · SMMA 8 · delay 0 · BOTH · Classic SL/TP=0**.

**Exit Mode theo Pine:** Classic mặc định SL 0 tick/TP 0 tick (tắt); Multi TP mặc định SL 1%, TP 1/2/3% và chia 33/33/34. Hỗ trợ TP Percent hoặc Points giá tuyệt đối. Xem [PINE_EXIT_MAPPING.md](PINE_EXIT_MAPPING.md) về quy tắc và giới hạn mô phỏng.

Khoảng 10% equity được dùng làm **giá trị danh nghĩa mỗi vị thế**, không phải ký quỹ đòn bẩy. **Có SL/TP cấu hình được theo Classic v3 hoặc Multi TP v5.** Nến H4 đang hình thành có thể biến động tín hiệu. Tín hiệu mô phỏng theo thời gian thực chưa được xác nhận giống TradingView backtest hoặc giao dịch thật.

## 6. Lưu dữ liệu, backup và cập nhật

Dữ liệu nằm trong thư mục **data/** cạnh START_WINDOWS.bat, gồm SQLite, WAL/SHM và các checkpoint. **Không sửa/xóa data khi server đang chạy.**

Để sao lưu hoặc đổi máy: nhấn Ctrl+C, chờ server dừng hẳn rồi copy **toàn bộ thư mục data/**. Đừng chỉ copy một file SQLite khi còn chạy.

Để nâng cấp: tắt ứng dụng cũ, giải nén ZIP mới vào folder khác, copy **data/** của bản cũ sang folder mới trước khi chạy. Không ghi đè data cũ bằng dữ liệu rỗng. Runtime và dữ liệu đều nằm trong folder portable, có thể di chuyển folder khi chương trình đã dừng.

## 7. Giới hạn

Dashboard chỉ bind 127.0.0.1, không cung cấp dịch vụ công khai. Không có giá giả trong production. Binance có thể giới hạn kết nối theo vùng. Funding chưa có, giả định phí và khớp không thay thế giao dịch thực tế. Workflow chạy kiểm thử trên Windows; chỉ tin bản ZIP nếu workflow có dấu ✓. Không có cam kết parity TradingView.
