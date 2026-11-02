# OCC Multi TP v5 — quy tắc theo Pine Script gốc

Chỉ dùng **Multi TP v5** cho mọi phiên mới. Giao diện không có Classic v3.

## Tham số mặc định

- SL: **1%** giá vào (0 = tắt SL).
- TP mode: **Percent**, có thể đổi sang **Points** (chênh lệch giá tuyệt đối, không phải ticks).
- TP1: **1%**, chốt **33%** vị thế ban đầu.
- TP2: **2%**, chốt **33%** vị thế ban đầu.
- TP3: **3%**, chốt **34% còn lại**.
- Với LONG, SL thấp hơn giá vào và TP cao hơn. Với SHORT, hướng tính ngược lại.
- Các mức 0 tắt mục tiêu tương ứng. SL áp dụng cho phần vị thế còn lại. **Không đảo chiều theo tín hiệu OCC**: khi còn vị thế (kể cả sau khi chốt TP1/TP2), bỏ qua tín hiệu mới. Vị thế chỉ đóng hết qua SL hoặc các TP đã cấu hình; khi đã FLAT, bot chờ **giao cắt OCC mới trên nến M15 đóng** để vào lại, không khớp tín hiệu xảy ra lúc đang giữ lệnh. Nếu tắt cả SL và mọi TP thì vị thế sẽ tiếp tục mở cho đến khi có phương án đóng khác; tín hiệu OCC không tự đóng lệnh. Đây là quy tắc OCC đã tùy biến, có thể khác hành vi đảo lệnh trong Pine Script gốc.
- TP1 Qty + TP2 Qty tối đa bằng 100% trên cơ chế phân bổ của engine; phần nhỏ hơn bước khối lượng Binance được dồn vào mức TP đang được sử dụng cuối cùng.

## Tương thích phiên cũ

Phiên đã lưu trước khi nâng cấp vẫn được giữ nguyên trong SQLite để tránh thay đổi lịch sử và vị thế mô phỏng. Nếu checkpoint cũ đang dùng Classic, app **không cho bấm Bắt đầu** trên phiên đó. Hãy vào Thiết lập và chọn **Tạo phiên mới** để mở phiên Multi; thao tác này được xác nhận trên giao diện, không xóa lịch sử vị thế cũ. Mã hỗ trợ Classic chỉ được giữ nội bộ để đọc phiên cũ, không thể chọn Classic cho phiên mới qua dashboard.

## Giới hạn paper trading so với Pine

- Các chỉ báo OCC được cập nhật khi nến M15 hoàn tất; stop/limit đang có được theo dõi bằng aggTrade khi nguồn dữ liệu khỏe.
- TP limit mô phỏng khớp ở target và SL khớp theo giá quan sát cộng slippage bất lợi; khác broker emulator TradingView. Không tạo fill từ nến đã qua khi mất kết nối.
- Phí từng lần khớp được hạch toán; funding chưa được tính.
- Một vị thế chốt 3 phần vẫn là **1 vị thế đã đóng** trong báo cáo, tính P&L theo tổng fill trừ mọi phí.
- Không cam kết giá khớp, thứ tự và lịch sử 100% giống TradingView. Phần hình vẽ Visual của Pine chưa được tái tạo toàn bộ.
