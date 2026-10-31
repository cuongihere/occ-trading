# OCC Paper Portable — Windows x64 (Intel/AMD 64-bit)

**Chỉ mô phỏng bằng tiền ảo. Không kết nối tài khoản sàn, không API key, không gửi lệnh thật.**

## Lấy runtime cho mã nguồn GitHub (một lần)

Kho mã nguồn này **không chứa node.exe** hoặc dữ liệu giao dịch cá nhân. ZIP tải bằng nút **Code → Download ZIP** của GitHub là mã nguồn, chưa phải gói portable hoàn chỉnh.

1. Giải nén mã nguồn.
2. Tải runtime chính thức [Node.js v24.22.2 Windows x64 ZIP](https://nodejs.org/dist/v24.22.2/node-v24.22.2-win-x64.zip).
3. Kiểm tra SHA256 của ZIP bằng PowerShell:
   `Get-FileHash .\node-v24.22.2-win-x64.zip -Algorithm SHA256`
   Kết quả phải là `ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2`.
4. Giải nén ZIP Node.js. Tạo thư mục `runtime` cạnh `server.mjs`, rồi chép `node.exe`, `LICENSE`, `README.md`, `CHANGELOG.md` từ thư mục Node vừa giải nén vào `runtime`. Giữ giấy phép gốc khi chia sẻ gói.
5. Bấm đúp `START_WINDOWS.bat`. **Không chạy installer, không cần npm, không cài Node.js vào hệ thống.**

Xem [PORTABLE_BUILD.md](PORTABLE_BUILD.md) để đóng gói lại bằng PowerShell với kiểm tra hash. Không tắt bảo vệ Windows hoặc bỏ qua cảnh báo bảo mật.

## Mở ứng dụng (sau khi đã có thư mục runtime)

1. Tải ZIP, chọn **Extract All / Giải nén tất cả** vào một thư mục bạn có quyền ghi. Không mở chương trình trực tiếp bên trong ZIP.
2. **Không cần cài Node.js.** Gói portable đã kèm runtime Node.js chính thức trong `runtime`. Giữ nguyên toàn bộ thư mục sau giải nén. Không thay đổi PATH, không cài dịch vụ, không có tự cập nhật.
3. Bấm đúp **`START_WINDOWS.bat`**. Giữ cửa sổ lệnh mở.
4. Trình duyệt sẽ mở **http://127.0.0.1:8080** sau vài giây. Nếu không tự mở, nhập địa chỉ này thủ công. Chỉ máy của bạn truy cập được địa chỉ này; không cần hosting.
5. Chờ đồng bộ Binance rồi bấm **Bắt đầu** trong giao diện để bắt đầu mô phỏng. Việc mở ứng dụng không tự bật giao dịch mô phỏng.

Không chạy hai bản cùng thư mục dữ liệu. Nếu báo cổng 8080 đang dùng, đóng bản OCC cũ trước khi thử lại. Không cần đổi firewall hay mở cổng Internet.

## Khi nào ứng dụng tiếp tục chạy?

- Đóng **tab/trình duyệt**: chương trình vẫn chạy nếu cửa sổ lệnh còn mở.
- Máy phải **đang bật, không ngủ, có mạng**, và cửa sổ lệnh phải còn chạy. Khóa màn hình không đồng nghĩa máy không ngủ.
- Ngủ máy, tắt máy, đóng cửa sổ lệnh hoặc nhấn **Ctrl+C**: việc thu thập và mô phỏng ngừng. Không có dịch vụ chạy ở nơi khác.
- Sau gián đoạn, ứng dụng đồng bộ lại nến thật; **không tạo lệnh quá khứ để bù lợi nhuận**. Kiểm tra trạng thái và bấm Bắt đầu khi muốn tiếp tục.
- Nút tạm dừng dừng quyết định giao dịch mới; không tự đóng vị thế đang mô phỏng.

## Giá và cấu hình

- Nguồn duy nhất: API công khai **Binance USD-M BTCUSDT perpetual**, không phải spot, không giá giả hoặc dữ liệu ngẫu nhiên.
- Giá giao dịch gần nhất và mark price là hai loại giá khác nhau. Khớp mô phỏng lấy sự kiện giá giao dịch hợp lệ sau khi có tín hiệu, cộng giả định trượt giá/phí; không phải cam kết khớp thật.
- OCC cố định **M15 / H4 · SMMA 8 · delay 0 · BOTH · Classic SL/TP = 0**. Không có lựa chọn delay 1. Quy mô mỗi lần mở là khoảng 10% equity dưới dạng giá trị vị thế, không phải 10% ký quỹ với đòn bẩy.
- **KHÔNG STOP LOSS.** Funding hiện chưa được tính; kết quả không phải lãi/lỗ ròng đầy đủ như tài khoản thật.
- H4 đang hình thành có thể thay đổi. Đây là mô phỏng tiến về phía trước, **chưa được xác thực trùng hoàn toàn với lịch sử TradingView**.
- Giá/nến quá hạn hoặc mất kết nối làm dừng lệnh mới cho đến khi đồng bộ nhất quán.
- Nếu Binance chặn theo khu vực (HTTP 451/403), ứng dụng báo chặn và không thay giá hoặc chuyển vùng để lách hạn chế. Cần dùng dịch vụ đúng điều kiện Binance áp dụng cho bạn; gói này không bảo đảm mọi mạng đều truy cập được.

## Dữ liệu, xuất file và đặt lại

- Dữ liệu phiên lưu cục bộ trong thư mục **`data`** cạnh `START_WINDOWS.bat`. Giữ nguyên thư mục này để giữ lịch sử khi đóng/mở chương trình.
- Dùng chức năng **xuất CSV** và nhật ký tín hiệu trong giao diện để lưu bản sao. Các mốc thời gian trong file xuất có nhãn riêng; đừng nhầm giờ UTC với giờ Việt Nam UTC+7.
- Đặt lại hoặc đổi vốn/phí là thao tác cần **xác nhận** trong giao diện, không chỉnh lại âm thầm lãi/lỗ của phiên cũ. Xuất dữ liệu cần giữ trước khi xác nhận đặt lại.
- Muốn sao lưu thư mục `data`, hãy **Ctrl+C và chờ chương trình dừng trước**, rồi sao chép toàn bộ thư mục. Đừng chỉ chép một file SQLite khi ứng dụng đang chạy.
- Không sửa/xóa file cơ sở dữ liệu đang được sử dụng. Nhật ký phục vụ kiểm tra nội bộ; chủ máy vẫn có thể sửa file, nên đây không phải bằng chứng chống can thiệp độc lập.

## Giới hạn kiểm thử

Mã và các bài kiểm thử tự động đã được kiểm tra trong môi trường Linux. **Chưa chạy kiểm thử trực tiếp trên Windows**, nên luồng bấm đúp/mở trình duyệt chưa được xác nhận trên máy Windows thật. Không có lời khẳng định kết nối Binance trực tiếp đã thành công từ môi trường kiểm thử: yêu cầu thực tế ở đó nhận HTTP 451.

## Tổng hợp giao dịch và thắng/thua

Ứng dụng lưu các lần khớp và phiên cũ vào SQLite trên máy. Trong **Kết quả vị thế đã đóng**, chọn **Phiên hiện tại**, một phiên theo ngày/giờ, hoặc **Tất cả phiên**. Đặt lại vốn tạo phiên mới; không xóa hồ sơ cũ.

- Một giao dịch được tính khi **vị thế đã mở rồi đóng đủ khối lượng**. Hai lần khớp mở/đóng không bị đếm thành hai giao dịch. Đảo chiều đóng vị thế cũ rồi mở vị thế mới.
- Thắng/thua dựa trên **P&L sau cả phí mở và phí đóng**. Trượt giá đã nằm trong giá khớp, không trừ lần nữa. Chưa tính funding. Giá trị tuyệt đối P&L ≤ 0,00000001 USDT được coi là hòa.
- Tỷ lệ thắng = số vị thế thắng / tổng vị thế đã đóng; vị thế hòa vẫn nằm trong mẫu số. Không có vị thế đóng thì hiển thị 0%, không phải kết luận chiến lược có tỷ lệ thắng bằng 0.
- Vị thế còn mở hoặc bị để lại ở phiên cũ sau đặt lại được đánh dấu **chưa đóng**, không tính thắng/thua, không tự tạo giá thoát. Tổng phí mọi lần khớp vẫn bao gồm phí mở của các vị thế này.
- Có số lệnh đã đóng, thắng/thua/hòa, tỷ lệ thắng, P&L đã đóng sau phí và chuỗi thua dài nhất. Chuỗi tính theo thứ tự đóng trong phạm vi phiên đã chọn; hòa/thắng ngắt chuỗi thua.
- Xem từng vị thế với thời gian vào/ra UTC+7, chiều, khối lượng, giá vào/ra, tổng phí và P&L sau phí. **CSV vị thế đóng** và **CSV từng lần khớp** xuất đúng phạm vi phiên đang chọn. Thời gian CSV là Unix epoch milliseconds UTC.
- Tất cả phiên cộng số giao dịch, phí và P&L; **không cộng số dư hoặc vốn của nhiều phiên thành một tài khoản**. Thẻ tài sản/vị thế phía trên luôn là phiên hiện tại.

## Di chuyển bản portable

Dừng chương trình bằng Ctrl+C rồi di chuyển **toàn bộ thư mục**, bao gồm `data`, sang vị trí mới có quyền ghi. Không di chuyển/sao chép cơ sở dữ liệu khi đang chạy. Gói ZIP ban đầu không chứa dữ liệu giao dịch của bạn hay giá mẫu. Lịch sử mới sẽ được tạo trong `data` khi chạy. Runtime đi kèm dành riêng cho **Windows x64**; bản này chưa được xác minh trên Windows ARM. Không chạy trực tiếp bên trong ZIP.

Giấy phép và các thông báo bên thứ ba của Node.js được giữ trong `runtime/LICENSE`; nguồn chính thức và bằng chứng kiểm tra SHA256 xem `RUNTIME_SOURCE.txt`. Bản portable không cài phần mềm vào hệ thống. Nếu Windows hoặc phần mềm bảo vệ chặn, kiểm tra thông báo và nguồn file; không cần tắt bảo vệ để sử dụng ứng dụng.
