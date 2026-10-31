# OCC Windows x64 portable build

## Tải gói có runtime sẵn

Vào [Actions: Build and test Windows portable](https://github.com/cuongihere/occ-trading/actions/workflows/windows-portable.yml); lấy artifact ở workflow **Success**. Giải nén ZIP của Actions, sau đó giải nén OCC_Portable_Windows_x64.zip. Folder OCC_Portable có runtime, server, dashboard và START_WINDOWS.bat. Tải ZIP nguồn từ Code → Download ZIP không phải gói đầy đủ; launcher sẽ tự bootstrap runtime vào folder app trong lần chạy đầu.

## Tự build trên Windows

Mở PowerShell tại thư mục repository và chạy:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\BUILD_PORTABLE.ps1
~~~

Kết quả: **dist/OCC_Portable_Windows_x64.zip** (chứa thư mục OCC_Portable đầy đủ runtime). Script thay thế staging và ZIP cũ trong dist/, không xóa hoặc copy dữ liệu data/ của người dùng. Chỉ cần PowerShell mặc định trên Windows và kết nối Internet khi build.

## Bảo đảm tính toàn vẹn

Node.js v24.22.2 chính thức: https://nodejs.org/dist/v24.22.2/node-v24.22.2-win-x64.zip

Archive SHA256: **ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2**

node.exe SHA256: **1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9**

Nguồn upstream checksum: https://nodejs.org/dist/v24.22.2/SHASUMS256.txt

Chỉ copy node.exe, LICENSE, README.md, CHANGELOG.md từ ZIP gốc sau khi xác minh. Không bao gồm thư mục data/, key, log, dữ liệu cá nhân. Script không sửa PATH, registry hoặc cài dịch vụ. ExecutionPolicy Bypass chỉ áp dụng trong tiến trình khởi chạy script; không tắt antivirus. Xem workflow log để biết kết quả chạy kiểm thử thực tế trên Windows.
