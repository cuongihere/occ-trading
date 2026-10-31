# BTCUSDT Binance Futures production-only execution

## Trạng thái

App /binance chỉ cho Binance Futures THẬT BTCUSDT. Nút Auto thật nối tới worker backend và cần xác nhận bằng chuỗi CHAP NHAN BTC FUTURES mỗi lần bật.
Worker giới hạn BTCUSDT, One-way, ISOLATED, đúng leverage, tài khoản không có lệnh/vị thế không thuộc bot. Dữ liệu Paper và tiền thật tách riêng.
Entry MARKET chỉ được gửi trên tín hiệu M15 mới; sau khi Binance xác nhận FILLED, bot gửi SL close-all rồi TP1/TP2/TP3 reduce-only, đối soát từng lệnh.
Trước gửi lệnh, intent lưu cục bộ; sự cố kết nối/khớp không rõ sẽ HALT, không lặp đơn. Nếu không xác minh được STOP, worker cố đóng MARKET reduce-only nếu có thể.
OFF chỉ ngừng mở lệnh mới; không hủy SL/TP đang trên Binance. Restart Auto OFF và khóa khi còn vị thế/lệnh chưa đối soát.

## GIỚI HẠN

Đã có các kiểm thử giả lập API trên Windows, nhưng CHƯA kiểm chứng end-to-end bằng Binance Futures Production.
Funding, lệnh algo kích hoạt tạo order ID thực và P&L đầy đủ vẫn cần đồng bộ user data trước khi có thể coi báo cáo thật là hoàn chỉnh.
Khả năng mất mạng, lỗi API, stop không khớp và thanh lý có thể gây mất vốn. Theo dõi vị thế và SL/TP trực tiếp trên Binance.
API Key/Secret không được lưu lên GitHub hoặc ổ đĩa; chỉ giữ trong RAM app tới khi ngắt kết nối.
