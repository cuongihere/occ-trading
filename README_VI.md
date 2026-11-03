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
- **Mô phỏng (Paper):** Engine hỗ trợ cờ `reverseOnSignal` (OFF mặc định) để tái hiện cách đóng vị thế cũ và mở theo tín hiệu đối nghịch như bản đầu; OFF tiếp tục giữ đến SL/TP. Chế độ Futures thật điều khiển độc lập bằng công tắc trên trang Binance.


**Chỉ sử dụng Multi TP v5:** SL mặc định 1%, TP 1/2/3% và chốt từng phần theo tỷ lệ 33/33/34. Hỗ trợ TP Percent hoặc Points giá tuyệt đối. **Không đảo lệnh**: vị thế đã mở chỉ đóng bằng SL hoặc TP, mọi tín hiệu ngược chiều trong lúc vị thế còn mở (kể cả phần còn lại sau TP1/TP2) đều bị bỏ qua. Chỉ khi đóng hết mới đợi tín hiệu giao cắt OCC M15 **mới** để vào tiếp, không xếp hàng hoặc hồi tố tín hiệu cũ. Xem [PINE_EXIT_MAPPING.md](PINE_EXIT_MAPPING.md) về quy tắc và giới hạn mô phỏng.

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


## OCC Binance Futures thật · dashboard một màn hình

- Mở **START_WINDOWS.bat** rồi vào `http://127.0.0.1:8080/binance`.
- Giao diện gọn một màn hình trên desktop: **Ví Futures, Available, Equity, P&L chưa thực hiện, BTC position, P&L bot đã đối soát**, cấu hình SL/TP và lịch sử lệnh. Đã **loại bỏ giá Entry giả định và phần xem trước SL/TP**.
- **Cấu hình** (USDT ký quỹ/lệnh, đòn bẩy, Long/Short, SL, TP1/2/3, % chia) được ghi vào `data/futures-browser-settings.json`; app tự lấy lại khi mở. Tự lưu sau thay đổi hoặc chọn **Lưu cấu hình** khi Auto OFF.
- **Cảnh báo ký quỹ/khối lượng ngay khi nhập:** ô dưới các mức TP gọi kiểm tra read-only trên máy, dùng giá BTCUSDT Futures trực tiếp và bộ lọc MARKET_LOT_SIZE/minNotional đã đọc từ Binance. Nếu một trong 3 TP thấp hơn minQty sau khi làm tròn bước lot, hiển thị cảnh báo màu vàng và ước tính **ký quỹ tối thiểu (USDT)** cho đòn bẩy và tỷ lệ TP đã nhập. Đổi ký quỹ, đòn bẩy hoặc tỷ lệ TP đều kiểm tra lại; trạng thái tự làm mới sau 15 giây. Nếu thiếu kết nối/giá trực tiếp, hiển thị **chưa thể kiểm tra** thay vì đoán. Khi có dữ liệu hiện hành, cấu hình không đủ lot bị từ chối lúc lưu; AUTO không thể bật nếu kiểm tra chưa đạt. Khi đang AUTO ON, không sửa thông số. Giá có thể đổi trước tín hiệu nên lần vào lệnh vẫn kiểm tra lại trên server, có thể bỏ qua tín hiệu nếu lot không đủ. Tăng đòn bẩy làm tăng rủi ro thanh lý, không được tự điều chỉnh đòn bẩy.

- **API Key/Secret**: nhập trên browser, đánh dấu **Lưu API mã hóa trên Windows** (mặc định ON). Key được mã hóa bằng **Windows DPAPI CurrentUser**, lưu tại `data/futures-api.dpapi.json`, không lưu trong JavaScript localStorage hay commit lên Git. App tự giải mã và kết nối Binance Futures khi mở lại trên **cùng tài khoản Windows**. Nếu chạy trên Windows user khác/máy khác, cần nhập lại Key/Secret.
- Nút **Xóa API đã lưu** xóa file được mã hóa và ngắt kết nối. Nút **Ngắt kết nối** chỉ xóa Key/Secret khỏi RAM, không xóa bản mã hóa đã lưu.
- DPAPI bảo vệ dữ liệu nằm trên đĩa khi máy bị đọc bởi tài khoản Windows khác; **phần mềm độc hại chạy dưới cùng Windows user vẫn có thể truy cập và giải mã khóa**. Chỉ cấp quyền giao dịch Futures cần thiết, tuyệt đối không cấp quyền rút tiền và dùng IP whitelist khi có thể.
- **Công tắc “Đảo chiều theo OCC” (mặc định OFF):** Nằm ngay dưới cấu hình các TP trên trang `/binance`; ghi nhớ trong `data/futures-browser-settings.json`, độc lập với công tắc AUTO. Có thể bật/tắt khi AUTO ON nếu bot không bận gửi/đối soát lệnh. **OFF:** giữ vị thế BTCUSDT (kể cả phần còn lại sau TP1/TP2) đến khi SL/TP trên Binance đóng hết; bỏ qua tín hiệu OCC đối nghịch. **ON:** khi có tín hiệu OCC mới đảo chiều, nếu vị thế đang được OCC quản lý và SL/TP trên sàn còn đúng, bot gửi MARKET `reduceOnly=true` để đóng phần BTC còn lại, xác minh `FILLED` và vị thế `FLAT`, chỉ hủy các Algo SL/TP thuộc OCC sau khi đã FLAT, xác minh sạch toàn bộ lệnh, rồi xét mở Entry theo chiều mới và đặt SL + TP mới. Không sử dụng lệnh quay đầu thông thường để tránh mở hai vị thế. Nếu một bước Binance không rõ kết quả, bot chuyển **KHÓA AN TOÀN**, không gửi lệnh tiếp theo và yêu cầu đối soát thủ công. Không tự đảo từ vị thế ngoài OCC, không đảo khi tín hiệu cùng chiều hoặc chế độ LONG/SHORT không cho phép. Bật đảo chiều tăng tần suất giao dịch, phí và rủi ro trượt giá; **không đảm bảo có thể mở lệnh mới nếu sàn từ chối hoặc ký quỹ không đủ**. Không xác nhận hiệu quả end-to-end trên Binance Futures tiền thật.

- **Auto Trade mặc định OFF sau mỗi lần khởi động/thoát app**, kể cả khi API đã tự kết nối. Muốn ON phải xác nhận nguy cơ giao dịch tiền thật. **Sau khi đã ON, mất luồng giá tạm thời sẽ KHÔNG tự chuyển công tắc sang OFF**: bot không mở lệnh mới khi feed không khỏe và chỉ tiếp tục với tín hiệu LIVE hợp lệ sau đồng bộ lại; tuyệt đối không bù lệnh lúc offline. Lỗi kiểm tra trước khi gửi Entry chỉ bỏ qua tín hiệu, không OFF. Nếu có lệnh thật với kết quả không chắc chắn, SL không được xác minh hoặc đối soát vị thế lỗi, giao diện giữ **AUTO ON · KHÓA AN TOÀN**, dừng đặt lệnh mới cho đến khi bạn OFF và đối soát thủ công; không tự khôi phục thực thi trong trường hợp đó. Nhấn OFF không tự đóng vị thế đang mở, SL/TP đã được Binance chấp nhận vẫn nằm trên sàn.
- **Bố cục trang Binance (gọn, không trùng dữ liệu):** một khung **Vị thế BTCUSDT & trạng thái bot** duy nhất ở hàng trên gồm Entry/Mark/Liquidation/P&L, Margin, đòn bẩy, vốn vị thế/giá trị/ROI và các cảnh báo. Bỏ khung Tổng quan trùng lặp ở hàng dưới. SL/TP thực tế và các kịch bản P&L hiện thành **2 bảng hàng/cột** trực tiếp phía dưới, chỉ còn các cột thiết yếu (giá, BTC, tỷ lệ, GROSS, trạng thái; hoặc kịch bản, BTC đã chốt/còn, GROSS). Giá và lượng lấy từ Binance, không tạo lệnh. Trên màn hình hẹp, mỗi bảng tự chuyển thành các dòng có nhãn thay vì cuộn ngang trong panel; trên màn hình thấp cuộn **trang chính**, không cuộn nội bộ.
- **Phân tích vị thế trực tiếp tại `/binance`**: mục **Vị thế & lệnh trên sàn · Phân tích SL/TP** lấy dữ liệu mới từ `GET /fapi/v3/positionRisk`, `GET /fapi/v1/openAlgoOrders`, `GET /fapi/v1/openOrders` (read-only, mỗi ~12 giây). Hiển thị vị thế LONG/SHORT, số BTC còn lại, giá vào/Mark/Liquidation, vốn vị thế tham khảo, giá trị danh nghĩa, ROI ước tính, từng lệnh STOP/TP thực sự hiện diện trên Binance (giá, BTC, % vị thế, trạng thái, kiểu kích hoạt, ID quản lý/checkpoint) và P&L **GROSS dự kiến** theo các kịch bản SL ngay, TP1 rồi SL, TP1+TP2 rồi SL, chốt hết TP. Công thức cho mỗi phần vị thế: `(giá thoát - giá vào) × BTC phần đó × (+1 LONG / -1 SHORT)`; kịch bản kết hợp chốt từng TP rồi chạm SL cho BTC còn lại. **Không cộng lãi đã chốt trước thời điểm truy vấn**, không trừ phí, funding, slippage, không đảm bảo khớp tại giá kích hoạt. Nếu thiếu/không xác nhận được lệnh SL hoặc lệnh mở vượt khối lượng thì hiển thị cảnh báo/không dựng kịch bản giả. Mọi thông tin lệnh đã hiển thị được lấy từ Binance, không suy luận rằng chỉ vì người dùng điền TP trong form thì sàn đã có lệnh.
- **Đối soát sau khi mở lại app:** Khi API Binance (được lưu bằng Windows DPAPI) kết nối lại, OCC sẽ tự đọc vị thế BTCUSDT, lệnh thường và lệnh Algo SL/TP. Chỉ khi checkpoint cũ đã ở trạng thái **PROTECTED** và sàn xác minh **BTCUSDT FLAT + không còn lệnh thường + không còn SL/TP**, bot mới tự ghi checkpoint `IDLE`, intent `CLEARED` và gỡ `HALTED`. Quy trình chỉ kiểm tra số dư/vị thế và dữ liệu lệnh, **không tự đặt/hủy lệnh, không mở AUTO**. Các checkpoint không chắc chắn (ENTRY_SENDING, STOP chưa xác minh, v.v.) hoặc còn vị thế/lệnh được giữ nguyên KHÓA AN TOÀN để đối soát thủ công.
- **Nút Kiểm tra / mở khóa:** Có thể nhấn khi AUTO OFF; nếu API không kết nối nhưng DPAPI còn lưu, nút sẽ thử kết nối lại, rồi kiểm tra Binance. Nếu BTCUSDT chưa hết vị thế hoặc còn bất kỳ lệnh treo, việc mở khóa bị từ chối và hiển thị lỗi cụ thể. Khi đã xác nhận sạch lệnh, nút gỡ HALTED nhưng **AUTO vẫn OFF**, bạn cần chủ động bật lại. Không sử dụng chế độ này để xử lý lệnh chưa có xác nhận thực thi trên Binance; kiểm tra sàn trước khi thao tác.

- Số dư, Equity, P&L chưa thực hiện và thông tin vị thế lấy trực tiếp từ REST Binance; tự đồng bộ định kỳ. Báo cáo lệnh **do bot OCC đã đối soát** lưu SQLite riêng `data/binance-live-stats.sqlite`, không cộng lệnh thủ công hoặc Paper. **Lưu ý**: thống kê bot có thể chưa đầy đủ vì tích hợp lệnh Algo kích hoạt/funding chưa hoàn tất; không diễn giải 0 là tài khoản không có giao dịch.
- Sau khi Entry khớp, bot cố đặt SL close-all trước TP1/TP2/TP3. Nhưng chưa có xác nhận end-to-end bằng tiền thật với Binance Production. **Đừng bật Auto tiền thật khi chưa kiểm tra kỹ cơ chế lệnh bảo vệ trên tài khoản**. Không có đảm bảo SL khớp đúng giá, có nguy cơ lỗ hoặc thanh lý.


## Đồng bộ đòn bẩy trên Binance

Ô **Đòn bẩy (x)** trong OCC là **cấu hình bot**, không tự đổi thông số của tài khoản Futures trên Binance khi chỉ bấm **Lưu cấu hình**. Ví dụ chọn 5x trong bot nhưng Binance đang 150x: trang hiển thị **Bot 5x / Binance 150x · Chưa đồng bộ** và bot không cho bật Auto.

Khi đã kết nối API BTCUSDT và đã tắt Auto, không có vị thế BTCUSDT, không còn lệnh thường/SL/TP BTCUSDT, bấm **Đặt 5x trên Binance**. App sẽ yêu cầu xác nhận, gọi `POST /fapi/v1/leverage` (chỉ BTCUSDT), kiểm tra mã xác nhận từ sàn và gọi lại `GET /fapi/v1/symbolConfig` để bảo đảm thực sự là 5x. Không lặp lại lệnh POST nếu kết quả kết nối không rõ. Nếu API không có quyền Futures Trading hoặc Binance từ chối, trạng thái đòn bẩy sàn vẫn được hiển thị theo API và Auto tiếp tục bị khóa khi chưa trùng cấu hình.

Không thay đổi đòn bẩy BTCUSDT từ app khi đang có vị thế/lệnh mở; không đổi Cross/Isolated hay One-way ngầm.


## Giá BTCUSDT Futures thực trên dashboard

Trong màn hình `/binance`, cạnh công tắc Auto có ô **BTCUSDT FUTURES · LAST** cập nhật giá giao dịch gần nhất từ luồng công khai Binance USDⓈ-M `btcusdt@aggTrade`, cùng **Mark Price** từ `btcusdt@markPrice@1s` và giờ nhận giá tại máy (giờ Việt Nam). Không dùng số dư Paper hay giá Entry để hiển thị giá thị trường. Tự làm mới mỗi giây, không cần API Key; khi feed ngắt hoặc giá quá 10 giây thì hiển thị dấu gạch ngang và cảnh báo **MẤT LUỒNG GIÁ** để tránh nhầm giá cũ là giá hiện tại. Số liệu trong vị thế cũng dùng Mark Price của luồng công khai khi còn kết nối.

Giá BTCUSDT LAST/Mark được chuyển xuống ô trống trong khung **API Binance**, hiển thị chính giữa với giá LAST màu vàng sáng kích thước lớn và Mark màu xanh cyan. Thanh trên cùng chỉ còn trạng thái kết nối, công tắc Auto và điều hướng; cơ chế đọc giá thật và báo giá cũ không thay đổi.
