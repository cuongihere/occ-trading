# OCC Multi TP v5 — quy tắc theo Pine Script gốc

Chỉ dùng **Multi TP v5** cho mọi phiên mới. Giao diện không có Classic v3.

## Tham số mặc định

- SL: **1%** giá vào (0 = tắt SL).
- TP mode: **Percent**, có thể đổi sang **Points** (chênh lệch giá tuyệt đối, không phải ticks).
- TP1: **1%**, chốt **33%** vị thế ban đầu.
- TP2: **2%**, chốt **33%** vị thế ban đầu.
- TP3: **3%**, chốt **34% còn lại**.
- Với LONG, SL thấp hơn giá vào và TP cao hơn. Với SHORT, hướng tính ngược lại.
- Các mức 0 tắt mục tiêu tương ứng. SL áp dụng cho phần vị thế còn lại. **Công tắc đảo chiều OCC**: OFF (mặc định) bỏ qua tín hiệu mới khi còn vị thế, chỉ thoát qua SL/TP; sau khi FLAT chờ giao cắt M15 mới. ON khôi phục cách đóng phần còn lại vì tín hiệu OCC đối nghịch rồi mở chiều mới (Paper ghi `REVERSE`). Với Binance Futures thật, việc đóng chiều cũ phải dùng reduceOnly, xác minh đã FLAT, dọn SL/TP cũ trước khi mở chiều mới; nếu kết quả không chắc chắn thì khóa an toàn, không tự retry. Nếu tắt cả SL và mọi TP trong Paper, chế độ OFF có thể để vị thế mở vô thời hạn; chế độ ON cho phép tín hiệu đối nghịch đóng/đảo.
- TP1 Qty + TP2 Qty tối đa bằng 100% trên cơ chế phân bổ của engine; phần nhỏ hơn bước khối lượng Binance được dồn vào mức TP đang được sử dụng cuối cùng.

## Tương thích phiên cũ

Phiên đã lưu trước khi nâng cấp vẫn được giữ nguyên trong SQLite để tránh thay đổi lịch sử và vị thế mô phỏng. Nếu checkpoint cũ đang dùng Classic, app **không cho bấm Bắt đầu** trên phiên đó. Hãy vào Thiết lập và chọn **Tạo phiên mới** để mở phiên Multi; thao tác này được xác nhận trên giao diện, không xóa lịch sử vị thế cũ. Mã hỗ trợ Classic chỉ được giữ nội bộ để đọc phiên cũ, không thể chọn Classic cho phiên mới qua dashboard.

## Giới hạn paper trading so với Pine

- Các chỉ báo OCC được cập nhật khi nến M15 hoàn tất; stop/limit đang có được theo dõi bằng aggTrade khi nguồn dữ liệu khỏe.
- TP limit mô phỏng khớp ở target và SL khớp theo giá quan sát cộng slippage bất lợi; khác broker emulator TradingView. Không tạo fill từ nến đã qua khi mất kết nối.
- Phí từng lần khớp được hạch toán; funding chưa được tính.
- Một vị thế chốt 3 phần vẫn là **1 vị thế đã đóng** trong báo cáo, tính P&L theo tổng fill trừ mọi phí.
- Không cam kết giá khớp, thứ tự và lịch sử 100% giống TradingView. Phần hình vẽ Visual của Pine chưa được tái tạo toàn bộ.

## Đối chiếu THỜI ĐIỂM vào/đóng lệnh với Pine OCC R5.1

**Không dùng biểu tượng Entry trong lịch sử Pine khi bật `Fixed HTF=H4` và `lookahead_on` làm mốc live**: Pine có thể vẽ lại quá khứ do dữ liệu H4 tương lai. Không thể làm bot tiền thật vào tại thời điểm chưa biết tín hiệu.

- OCC PC/Android mặc định: Binance BTCUSDT USD-M, SMMA 8 H4 đang hình thành, cập nhật khi nến M15 kết thúc, delayOffset 0. So sánh cùng ticker và khung M15; trong Pine phải chọn **Fixed HTF=H4**. Pine bạn cung cấp mặc định **OFF** (SMMA trên khung biểu đồ) nên kết quả khác nếu không đổi.
- Pine `calc_on_every_tick=false`, `process_orders_on_close=false` (mặc định): phát hiện signal ở M15 close; broker emulator giả lập MARKET khớp ở tick tiếp theo, thường là M15 open mới.
- OCC đọc WebSocket `kline_15m` với `k.x=true`, gửi MARKET sau Binance readback an toàn. Sẽ phát sinh thời gian mạng / kiểm tra API; không có cách thực thi lệnh trước khi biết nến đã đóng.
- OCC PC dùng quote `aggTrade` vừa nhận (tối đa 5 giây, phải xác minh LIVE) thay cho một lượt `GET /fapi/v1/ticker/price`; Android lấy account và exchange filters song song. Đây là tối ưu độ trễ, **không** thay tín hiệu/SL/TP.
- Để kiểm tra trễ thực, trang PC hiển thị thời gian từ **mở nến mới tới lúc gửi MARKET**, và thời gian Binance trả ACK riêng. Android hiển thị thời gian nhận tín hiệu M15 và ACK Entry. Thời điểm ACK không nhất thiết là thời gian khớp: xác minh thêm `order.updateTime`/`userTrades.time` từ Binance.
- **Đóng lệnh:** OCC Auto mặc định `reverseOnSignal=false`, vị thế vẫn được bảo vệ bằng SL + TP1/2/3 trên Binance. Trong Pine với `tradeType=BOTH`, `strategy.entry` có thể đảo vị thế ngay ở tín hiệu ngược, nên **thời điểm đóng không thể khớp** nếu tiếp tục để chế độ đảo chiều OFF. Không tự thay đổi default; bật đảo chiều có chủ đích khi cần so sánh.
- Với Pine `strategy.exit(...limit,stop)`, TradingView giả lập giá khớp từ OHLC/intrabar emulator; OCC dùng STOP_MARKET/TAKE_PROFIT_MARKET thực trên Binance (giá trigger ≠ giá fill), có phí và trượt giá. Thời điểm khớp thực chỉ lấy từ Binance.
- Cần so sánh log trên **tín hiệu realtime**, cùng M15 và H4, không so sánh các mũi tên lịch sử có thể repaint.

