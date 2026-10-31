# Binance BTCUSDT Futures · Dashboard

Mở `http://127.0.0.1:8080/binance` sau khi chạy `START_WINDOWS.bat`.

- Trên desktop chỉ có một dashboard: API, trạng thái Auto, cấu hình BTCUSDT, ví Futures, Equity, lãi/lỗ đang mở, vị thế, thống kê bot.
- Nhập API Key/Secret một lần, đánh dấu lưu mã hóa Windows DPAPI. Lần sau dùng đúng **Windows user** để tự kết nối lại. Không cần nhập lại, không cần chạy CHECK_BINANCE_WINDOWS.bat.
- Thông số giao dịch tự lưu vào `data/`; không lưu trong trình duyệt. Sau restart Auto mặc định OFF, phải xác nhận lại trước khi mở lệnh thật.
- API mã hóa bằng DPAPI CurrentUser, không thể tự giải mã trên Windows user khác. Phần mềm cùng Windows user có thể truy cập bản giải mã. Có nút Xóa API đã lưu nếu không muốn giữ.
- Kiểm tra quyền Binance USDⓈ-M Futures và IP whitelist. Không cấp quyền rút tiền.
- Chỉ BTCUSDT Perpetual; One-way, ISOLATED và đúng leverage, không có vị thế/lệnh bất thường khi bật Auto.
- Dashboard hiện số dư từ Binance trực tiếp. P&L bot chỉ gồm fills đã được đối soát, chưa gồm funding/phí khác USDT, nên có thể thiếu khi lệnh Algo chưa đồng bộ.

**CẢNH BÁO:** Bot Auto tiền thật chưa được kiểm thử end-to-end trực tiếp trên Binance Production. Có nguy cơ không đặt thành công lệnh bảo vệ, lỗi API hoặc thanh lý. Đừng giao dịch với khoản tiền bạn không thể mất.

Tài liệu API: https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account
