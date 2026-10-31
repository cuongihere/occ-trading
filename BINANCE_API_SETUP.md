# OCC Binance BTCUSDT Futures — Tài khoản thật

## Dùng trên Windows Portable

1. Mở START_WINDOWS.bat, truy cập http://127.0.0.1:8080/binance.
2. Nhập API Key và API Secret Binance Futures THẬT trực tiếp trong trình duyệt. Không gửi cho ChatGPT hay ghi vào GitHub. Cần quyền Futures trading; không bật rút tiền.
3. Kiểm tra kết nối, số dư/vị thế. Chỉnh USDT ký quỹ / lệnh, đòn bẩy, SL và TP từng phần.
4. Thiết lập trên Binance: BTCUSDT Perpetual, One-way, ISOLATED, đúng leverage và không có lệnh/vị thế BTCUSDT đang mở trước khi bật.
5. Bật Auto chỉ sau khi đã đọc cảnh báo và nhập chính xác chuỗi xác nhận tiền thật trên giao diện.
6. Auto OFF chỉ ngăn mở lệnh mới. Không hủy SL/TP đã có trên sàn. Nếu HALTED, xem Binance trước khi làm gì khác.

## Cơ chế và giới hạn

- Đặt Entry MARKET BTCUSDT khi có tín hiệu OCC M15 mới và nguồn giá khỏe.
- Chỉ sau khi xác nhận Entry FILLED và vị thế trên Binance mới đặt STOP_MARKET close-all rồi TP1, TP2, TP3 reduce-only.
- Ghi dấu lệnh trước khi gửi, không tự gửi lại nếu timeout; mất xác nhận SL sẽ cố đóng MARKET reduce-only, nhưng có thể không thành công nếu mạng/sàn lỗi.
- App khởi động lại Auto OFF, khóa khi vị thế hoặc lệnh chưa được đối soát.
- Không đủ khối lượng tối thiểu BTC cho ba TP sẽ bỏ tín hiệu thay vì đặt Entry rồi thất bại bảo vệ.
- Khóa API/Secret chỉ giữ trong RAM, không lưu file. Khóa phải có quyền Futures Trade và giới hạn IP đúng.
- **CHƯA được kiểm chứng bằng tài khoản Binance Production thật.** Kiểm thử hiện có dùng mock. Đặt lệnh Futures có rủi ro mất vốn và thanh lý. Theo dõi trực tiếp lệnh trên Binance.
- Báo cáo P&L sau phí/funding chưa đối soát đầy đủ lệnh algo kích hoạt. Không dựa riêng vào số liệu trong app để đánh giá kết quả thực.

Tài liệu chính thức: https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade
