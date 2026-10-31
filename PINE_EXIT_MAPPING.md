# OCC Pine v5: SL/TP mapping

Nguồn tham chiếu: bản Pine người dùng cung cấp, tiêu đề "OCC Strategy R5.1 V3 Match + V5 Visual TP/SL".

## Classic v3 (Pine mặc định)

Exit Mode = Classic v3; Classic Stop Loss Points = 0; Classic Target Profit Points = 0. Giá trị 0 tắt ngưỡng tương ứng. Số points trong Pine là **ticks** (syminfo.mintick), KHÔNG phải USD hay phần trăm. App lấy tickSize trực tiếp từ Binance PRICE_FILTER.

- LONG: SL = entry - SL points × tickSize; TP = entry + TP points × tickSize.
- SHORT: SL = entry + SL points × tickSize; TP = entry - TP points × tickSize.
- Lệnh ngược OCC vẫn đóng/đảo vị thế nếu chưa chạm mức SL/TP.

## Multi TP v5

Theo Pine mặc định: SL = **1%** giá vào; TP mode = **Percent**; TP1/2/3 = **1%/2%/3%**; TP1 Qty = **33%**, TP2 Qty = **33%**, TP3 Qty = max(0, 100 - 33 - 33) = **34%**.

- SL LONG = entry × (1 - SL%/100); SL SHORT = entry × (1 + SL%/100).
- TP Percent LONG/SHORT = entry × (1 ± TP%/100), dấu + cho LONG, - cho SHORT.
- TP Points LONG/SHORT = entry ± TP points, là khoảng giá **tuyệt đối**, KHÔNG nhân tickSize.
- TPn = 0 tắt riêng target đó; SL% = 0 tắt SL. Các tranche có cả SL và target tắt sẽ giữ tới khi bị đảo chiều.
- Mỗi TP chốt tỷ lệ khối lượng được phân bổ; stop áp dụng cho từng phần còn lại; tín hiệu đảo chiều đóng khối lượng chưa khớp.
- Khối lượng mô phỏng được làm tròn theo qtyStep Binance, phần dư về mức TP cuối có tỷ lệ dương, nên vị thế rất nhỏ có thể không đúng chính xác 33/33/34.
- Nếu TP1% + TP2% > 100%, mức sau được giới hạn theo phần khối lượng còn lại.

## Live-paper và Pine không tuyệt đối trùng nhau

- Pine calc_on_every_tick=false tạo tín hiệu trên nến, trong khi stop/limit đã đặt có thể khớp trong nến. App chỉ phát tín hiệu OCC trên nến M15 hoàn tất, kiểm tra SL/TP theo từng sự kiện aggTrade nhận được từ Binance khi feed khỏe.
- TP limit mô phỏng khớp tại target, SL stop-market khớp theo giá quan sát có cộng slippage bất lợi. Gaps, tick feed và mô phỏng khớp có thể khác TradingView broker emulator.
- Khi tạm dừng, app không mở/đảo vị thế mới nhưng tiếp tục xử lý SL/TP đang có nếu feed còn khỏe. Mất mạng không sinh lệnh khớp giá quá khứ.
- Một vị thế chốt ba TP vẫn tính một vị thế đã đóng trong win rate; các fill có reason TP1, TP2, TP3, SL, CLASSIC, REVERSE.
- Funding chưa được tính. Các line/box/label Visual Pine chưa được tái tạo toàn bộ; dashboard hiển thị Entry và các mức SL/TP hiện hành.
- Chiến lược OCC M15/H4 hiện tại không phải trình chạy nguyên văn Pine/TradingView, và kết quả không được bảo đảm parity 100%.

## Sử dụng

Dashboard > Thiết lập mô phỏng > Exit Mode > Classic v3 hoặc Multi TP v5 > Tạo phiên mới. Chỉ áp dụng cấu hình cho phiên mới, không sửa nhật ký phiên cũ. Sao lưu data/ khi đã dừng ứng dụng trước khi nâng cấp.
