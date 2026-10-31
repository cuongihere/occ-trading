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

- Mỗi lần mở app khôi phục cấu hình và tình trạng bật/tạm dừng đã lưu. Nếu lần trước bật mô phỏng, app **chỉ tiếp tục sau khi đồng bộ và xác nhận dữ liệu Binance khỏe**; không tạo lệnh bù trong lúc tắt.
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
- Lưu thông số Multi TP (SL, TP1/TP2/TP3, tỷ lệ chốt, phí và slippage) áp dụng trên tài khoản hiện tại khi đã tạm dừng và không còn vị thế; không tạo phiên mới hay đặt lại vốn. Lịch sử các phiên cũ giữ lại.

Tỷ lệ thắng = số vị thế thắng chia tổng số vị thế đóng, bao gồm vị thế hòa. Thống kê dựa trên P&L trừ **cả phí mở và đóng**; slippage đã có trong giá mô phỏng. Vị thế đang mở không tính thắng/thua. Funding chưa được tính.

## 5. Cấu hình chiến lược và SL/TP

**BTCUSDT perpetual · M15/H4 · SMMA 8 · delay 0 · BOTH · Multi TP v5**.

**Chỉ sử dụng Multi TP v5:** SL mặc định 1%, TP 1/2/3% và chốt từng phần theo tỷ lệ 33/33/34. Hỗ trợ TP Percent hoặc Points giá tuyệt đối. Xem [PINE_EXIT_MAPPING.md](PINE_EXIT_MAPPING.md) về quy tắc và giới hạn mô phỏng.

Khoảng 10% equity được dùng làm **giá trị danh nghĩa mỗi vị thế**, không phải ký quỹ đòn bẩy. **Chỉ sử dụng Multi TP v5 (SL % và chốt lời TP1/TP2/TP3).** Nến H4 đang hình thành có thể biến động tín hiệu. Tín hiệu mô phỏng theo thời gian thực chưa được xác nhận giống TradingView backtest hoặc giao dịch thật.

## 6. Lưu dữ liệu, backup và cập nhật

Dữ liệu nằm trong thư mục **data/** cạnh START_WINDOWS.bat, gồm SQLite, WAL/SHM và các checkpoint. **Không sửa/xóa data khi server đang chạy.**

Để sao lưu hoặc đổi máy: nhấn Ctrl+C, chờ server dừng hẳn rồi copy **toàn bộ thư mục data/**. Đừng chỉ copy một file SQLite khi còn chạy.

Để nâng cấp: tắt ứng dụng cũ, giải nén ZIP mới vào folder khác, copy **data/** của bản cũ sang folder mới trước khi chạy. Không ghi đè data cũ bằng dữ liệu rỗng. Runtime và dữ liệu đều nằm trong folder portable, có thể di chuyển folder khi chương trình đã dừng.

## 7. Giới hạn

Dashboard chỉ bind 127.0.0.1, không cung cấp dịch vụ công khai. Không có giá giả trong production. Binance có thể giới hạn kết nối theo vùng. Funding chưa có, giả định phí và khớp không thay thế giao dịch thực tế. Workflow chạy kiểm thử trên Windows; chỉ tin bản ZIP nếu workflow có dấu ✓. Không có cam kết parity TradingView.

## Liên tục tài khoản, thống kê tích lũy và khoảng nghỉ

- **Bản mới không tạo phiên mới khi bạn sửa Multi TP**. Khi đã tạm dừng và không còn vị thế mở, chọn Lưu thông số Multi TP để thay SL, TP1/2/3, tỷ lệ chốt, phí và slippage. Vốn, session ID, số dư, tất cả giao dịch và tín hiệu đã có **không bị xóa hay reset**.
- **Khi đóng bằng Ctrl+C**: ứng dụng ghi sự kiện process_stop cùng checkpoint hiện tại vào SQLite. Mỗi lần giá, nến hay trạng thái thay đổi đều được ghi trước đó theo giao dịch SQLite; đóng cửa sổ đột ngột/mất điện vẫn khôi phục từ checkpoint cuối, nhưng thời điểm bắt đầu offline chỉ là ước tính.
- **Khi mở lại**: dùng lại cùng tài khoản/vị thế/cấu hình, giữ nguyện vọng bật trade từ lần trước. Nếu trước khi tắt đã bật mô phỏng, ứng dụng tự đồng bộ dữ liệu mới và chỉ bắt đầu nhận tín hiệu mới khi feed Binance khỏe, không bù lệnh hoặc suy đoán giá offline. Nếu trước khi tắt bạn chủ động tạm dừng, khi mở lại vẫn tạm dừng.
- **Nhật ký ngừng giao dịch**: bảng trên dashboard ghi khoảng tạm dừng, mất kết nối, tắt app và lúc chạy lại, theo giờ Việt Nam. Ghi rõ mốc ước tính khi tắt đột ngột. Các ngắt quãng mới chỉ được ghi từ phiên bản hỗ trợ tính năng này; không thể dựng lại chính xác những khoảng cũ chưa lưu.
- **Tổng thống kê**: mặc định xem tổng vị thế đóng, win rate, phí và P&L của toàn bộ lịch sử. Các đợt cũ do nhấn Tạo phiên mới trước đây vẫn được giữ dưới mục xem riêng. Không cộng vốn đầu kỳ của nhiều đợt cũ thành một equity duy nhất, vì đó là các phép thử có vốn riêng; equity ở ô trên chỉ là tài khoản hiện tại.
- **Giới hạn**: Dữ liệu/khớp lệnh chỉ mô phỏng, không tương đương hoàn toàn Pine TradingView, không tính funding. Muốn sao lưu, dừng chương trình rồi copy toàn bộ data/; không copy SQLite đang mở.

## Kiểm tra API Binance Futures (chỉ đọc)

Bản portable có CHECK_BINANCE_WINDOWS.bat để kiểm tra API key và BTCUSDT USD-M Futures trên máy. Chương trình KHÔNG có khả năng đặt lệnh thật; paper trading và dữ liệu SQLite giữ riêng. Xem [BINANCE_API_SETUP.md](BINANCE_API_SETUP.md). Tuyệt đối không gửi API key/secret vào chat hoặc commit vào GitHub.

## Màn hình Binance Futures riêng

Trong dashboard Paper, bấm **Binance Futures · Cài đặt riêng** (địa chỉ localhost:8080/binance). Màn hình này cho nhập trực tiếp **USDT ký quỹ mỗi lệnh** và **đòn bẩy** (ví dụ 20 USDT × 5x = 100 USDT giá trị vị thế dự kiến), chọn LONG/SHORT, tùy chỉnh Multi TP v5 và xem trước giá. Đã bỏ hai ô % Equity và giới hạn USDT. Đây là phép tính minh họa, chưa kiểm tra số dư và quy tắc giao dịch Binance; ký quỹ không đồng nghĩa mức lỗ tối đa. Công tắc thực thi tiền thật hiển thị **OFF / KHÓA**, bởi phần thực thi lệnh thật chưa được kiểm tra đủ điều kiện; không có lệnh nào được gửi lên Binance từ màn hình này. Nút Lưu chỉ lưu bản nháp bằng localStorage của trình duyệt, không phải cấu hình live backend. Kiểm tra kết nối tài khoản read-only bằng CHECK_BINANCE_WINDOWS.bat.

## Báo cáo hiệu suất Binance Futures thực (tách biệt với Paper)

Mở **/binance** trong dashboard OCC để xem mục **Thống kê giao dịch thật do OCC thực hiện**:
- Tổng vị thế đã đóng, Thắng/Thua/Hòa, Win rate, P&L thực hiện (realizedPnl), phí tính bằng USDT và **P&L sau phí USDT, chưa tính funding**.
- Biểu đồ P&L tích lũy của các vị thế đã đóng; lịch sử BTCUSDT có giờ vào/ra, LONG/SHORT, entry/exit, khối lượng, TP/SL, phí và kết quả.
- TP1/TP2/TP3 là các lần khớp từng phần; chỉ khi đóng hết vị thế mới tính thành 1 giao dịch.
- Chỉ lấy **fill thật do Binance xác minh**, đã gắn với **orderId thuộc OCC** trong SQLite `data/binance-live-stats.sqlite`. Không lấy lệnh thủ công Binance, không trộn dữ liệu paper.
- Khi chạy **CHECK_BINANCE_WINDOWS.bat**, tiện ích cũng tìm và đồng bộ khớp lệnh đã được đăng ký của bot (nếu có). Cần chạy lại để cập nhật sau lần đặt lệnh mới; hiện chưa có worker live đặt lệnh thật.
- Phải đăng ký **orderId, groupId, clientId bắt đầu bằng OCCBTC- và role (ENTRY/TP1/TP2/TP3/SL/CLOSE/REVERSE)** trong ledger khi có bộ thực thi live tương lai. Mỗi lần kiểm tra chỉ đọc sẽ truy vấn `GET /fapi/v1/userTrades` cho các orderId đã đăng ký. Chưa có ID được đăng ký → bảng trống, không được tự gán lệnh Binance của người dùng là lệnh OCC.
- Funding chưa được phân bổ theo từng vị thế; các phí không phải USDT cũng chưa được quy đổi. Vì vậy không thể coi **netExFundingUSDT** là P&L ròng đầy đủ. Giao diện sẽ đánh dấu vị thế phí khác USDT là chưa xác minh P&L ròng.
- Binance có giới hạn truy vấn lịch sử; cần đồng bộ thường xuyên để giữ được các fill trong dữ liệu cục bộ.

## Cài đặt Binance API ngay trên trình duyệt (Demo Auto)

1. Mở `http://127.0.0.1:8080/binance` từ **START_WINDOWS.bat** và chọn **Binance Futures thật · tiền thử**.
2. Nhập **API Key + API Secret** vào hai ô mật khẩu và nhấn **Kết nối & kiểm tra API**. Key chỉ được giữ trong RAM của tiến trình Node đang chạy, không lưu trên ổ đĩa và không lưu localStorage.
3. Chọn số ký quỹ USDT/lệnh, đòn bẩy, chiều LONG/SHORT, SL và TP1/2/3; nhấn **Lưu cấu hình** (chỉ lưu tham số, không lưu key).
4. Cài trên Binance Futures thật: **One-way, Isolated BTCUSDT, đòn bẩy trùng cấu hình, không có lệnh/vị thế BTCUSDT khác**. Khi luồng giá đã khỏe, bật **Auto Trade** trên trang để thử.
5. Bot chỉ dùng **tín hiệu OCC M15 mới**, không hồi diễn lệnh lịch sử. Trước lệnh kiểm tra lượng USDT ký quỹ đủ và từng TP đạt quy tắc `stepSize/minQty`; 20 USDT × 5x thường không thể tách 3 TP trên BTCUSDT.
6. Sau khi gửi lệnh Entry trên Demo, bot xác nhận thực tế `FILLED`, rồi gửi SL đóng toàn bộ và TP1–TP3 từng phần; xác minh lại các lệnh trên sàn. Khi không chắc chắn, bot sẽ khóa Auto và không gửi lại mù quáng.
7. Nút **OFF** chặn mở lệnh mới, không hủy SL/TP đã được Binance nhận. Nếu app khởi động lại với lệnh chưa đối soát, Auto vẫn OFF và cần kiểm tra trên Binance Futures thật. Nút **Kiểm tra đã sạch lệnh** chỉ mở khóa khi Binance xác nhận BTCUSDT không còn vị thế hoặc lệnh.
8. Nếu chọn **Binance thật · chỉ đọc**, app chỉ xác minh tài khoản/số dư; công tắc Auto bị khóa. **Chưa thể dùng tiền thật trong bản này.** API Futures phải đúng quyền và Binance phải hỗ trợ tại khu vực của bạn.

Lưu ý: Tín hiệu Demo hiện lấy từ dữ liệu công khai BTCUSDT thực (Binance Futures) còn khớp lệnh diễn ra trên Demo. Kết quả thử có thể khác thực tế. App chưa có worker User Data Stream để xác minh toàn bộ khớp, funding và tính P&L Demo chi tiết; báo cáo giao dịch thật trong app tách riêng và **không tính Demo là lãi/lỗ tiền thật**.

## Binance Futures THẬT · BTCUSDT

Giao diện /binance chỉ còn Binance Futures thật. Key và Secret nhập ngay trên trình duyệt, chỉ giữ RAM. Auto yêu cầu xác nhận bằng câu CHAP NHAN BTC FUTURES. Cài đặt USDT ký quỹ × đòn bẩy, TP1/2/3, SL và LONG/SHORT. Khi OFF không mở lệnh mới nhưng SL/TP đã đặt vẫn còn trên Binance. Dùng One-way, ISOLATED và đòn bẩy khớp cài đặt; bot từ chối nếu ba TP không đạt khối lượng tối thiểu. Sau Entry xác nhận FILLED mới gửi SL rồi ba TP; khi lỗi bot HALT và cố gắng đóng reduce-only nếu không có stop trên sàn.

**Chưa kiểm chứng trực tiếp trên Binance Production:** Chỉ có kiểm thử tự động bằng API giả lập; không đảm bảo khớp SL, TP hay đóng lệnh khi mất mạng. Giao dịch Futures có thể lỗ và bị thanh lý, cần theo dõi trực tiếp trên Binance. Thống kê khớp lệnh thật còn thiếu liên kết hoàn chỉnh với các TP/SL đã kích hoạt và funding.
