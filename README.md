EXTENSION GIÚP BẠN LẤY STICKER ZALO TRÊN WEB VỀ MÁY TÍNH THÀNH FILE GIF
## Cài đặt extension

### Bước 1: Mở trang quản lý extension

Mở:

`chrome://extensions/`

### Bước 2: Bật Developer mode

Bật **Developer mode** ở góc trên bên phải.

### Bước 3: Load extension

- bấm **Load unpacked**
- chọn chính thư mục này: `extensionsStickerZalo`

Sau khi load xong, extension sẽ xuất hiện với tên **Zalo Sticker to GIF**.

## Quyền mà extension đang dùng

Theo [manifest.json](manifest.json), extension đang dùng các quyền:

- `activeTab`
- `scripting`
- `downloads`
- `storage`

Và có `host_permissions` khá rộng, bao gồm cả `https://*/*`.

## Cách sử dụng

### 1. Mở Zalo Web

Mở `https://chat.zalo.me/` và đăng nhập.

### 2. Mở pack sticker muốn lấy

Vào một cuộc chat bất kỳ, mở khu vực sticker và di chuột (hover) vào những sticker muốn tải xuống để trình duyệt load dải ảnh.

Sau đó nhấn vào extension

### 3. Mở popup extension

Bấm icon extension **Zalo Sticker to GIF**.

### 4. Quét pack

Bấm **Quét pack**.

Khi đó popup sẽ:

- gửi message sang tab Zalo Web
- content script quét sticker hiện tại
- lấy danh sách sprite URL và preview
- hiển thị các sticker tìm được
- tự chọn sẵn toàn bộ sticker sau khi quét thành công

### 5. Điều chỉnh thông số

#### Duration mỗi frame (ms)

- mặc định: `100`
- giá trị này được dùng để tính delay của GIF
- code hiện tại convert sang đơn vị GIF bằng công thức:

`Math.max(2, Math.round(duration / 10))`

Ví dụ:

- `100` ms -> delay GIF khoảng `10`
- `50` ms -> delay GIF khoảng `5`
- nếu nhập quá nhỏ thì vẫn bị chặn tối thiểu ở mức `2`

#### Kích thước frame fallback

- mặc định: `130`
- được dùng khi code không suy ra được frame size chuẩn từ sprite
- nếu GIF bị cắt sai frame, đây là tham số nên thử chỉnh trước

### 6. Chọn sticker cần tải

Sau khi quét xong, bạn có thể:

- để nguyên toàn bộ sticker đang được chọn
- bỏ chọn một số sticker
- tick **Chọn tất cả** để chọn lại toàn bộ
- bấm **Tải GIF** ở từng dòng để tải riêng một sticker

### 7. Tải GIF

Có 2 cách:

- **Tải đã chọn**: tải hàng loạt tất cả sticker đang được chọn
- **Tải GIF**: tải riêng sticker tại dòng đó

Popup sẽ hiển thị trạng thái thành công/thất bại sau khi xử lý.

## Quy trình xử lý thực tế của extension

Khi tải một sticker, flow hiện tại là:

1. lấy `sticker.url`
2. `fetch` sprite blob với `credentials: "include"`
3. suy ra `frameSize`
4. cắt sprite theo từng frame vuông
5. bỏ frame rỗng
6. tạo GIF từ danh sách frame
7. chuyển blob GIF thành data URL
8. dùng `chrome.downloads.download()` để lưu file

## Hành vi quét sticker hiện tại

Code hiện tại không chỉ quét từ DOM mà còn kết hợp dữ liệu đã quan sát được từ network/resource.

Nó ưu tiên các URL có dạng sprite, sau đó:

- gom nhóm item theo `eid` trong query string nếu có
- nếu không có `eid` thì fallback bằng tổ hợp `previewUrl + url`
- chọn item “ưu tiên” trong nhóm
- sau cùng gán lại `displayName` thành dạng:
  - `sticker-1`
  - `sticker-2`
  - `sticker-3`

Điều này có nghĩa là tên hiển thị sau cùng trong popup không nhất thiết là tên alt/title gốc từ DOM.

## Giới hạn hiện tại theo code

Dưới đây là các giới hạn đang thấy rõ từ mã nguồn hiện tại:

1. **Chỉ hỗ trợ tốt sprite strip nằm ngang**
   Logic cắt frame hiện tại giả định sprite là một dải frame vuông theo chiều ngang.

2. **Tên file tải về chưa phản ánh tên pack hoặc tên sticker**
   File hiện luôn được đặt kiểu `sticker-N.gif` trong mỗi session chạy extension.

3. **Frame size phụ thuộc khá nhiều vào sprite thực tế**
   Nếu asset không đúng dạng width chia hết cho frame size, cần chỉnh fallback bằng tay.

4. **Bridge có patch `fetch` và `XMLHttpRequest` của trang**
   Đây là hành vi có chủ đích để bắt URL sprite.

5. **Code có phần debug trong popup.js nhưng popup.html hiện chưa render khu vực debug tương ứng**
   Trong [popup.js](popup.js) có `debugMetaEl` và `debugListEl`, nhưng [popup.html](popup.html) hiện không có các phần tử này.

## Khi nào nên quét lại

Nên quét lại nếu:

- vừa đổi sang pack sticker khác
- Zalo mới tải thêm asset
- danh sách sticker hiển thị chưa đủ
- tải GIF bị lỗi do sprite cũ hoặc thiếu frame

## Sự cố thường gặp

### Không quét được pack

Nguyên nhân có thể là:

- chưa mở đúng tab Zalo Web
- content script chưa inject xong
- pack sticker chưa được mở trên giao diện
- asset sticker chưa kịp load

Cách xử lý:

- reload tab Zalo Web
- mở lại pack sticker
- chờ vài giây rồi bấm **Quét pack** lại

### Quét được nhưng tải thất bại

Nguyên nhân có thể là:

- `sticker.url` không fetch được
- sprite không tách được frame hợp lệ
- frame size suy ra sai

Cách xử lý:

- quét lại pack
- thử tải từng sticker riêng
- chỉnh `Kích thước frame fallback`

### GIF bị sai nhịp hoặc sai khung

Cách xử lý:

- chỉnh lại `Duration mỗi frame (ms)`
- chỉnh lại `Kích thước frame fallback`
- quét lại sau khi Zalo đã load đầy đủ pack

## Cấu trúc thư mục chính

- [manifest.json](manifest.json) — manifest của extension
- [popup.html](popup.html) — giao diện popup
- [popup.js](popup.js) — quét, chọn và gửi lệnh tải
- [content.js](content.js) — quét sticker từ trang Zalo
- [page-bridge.js](page-bridge.js) — bắt sprite URL từ page context
- [background.js](background.js) — tải sprite và xuất GIF
- [lib/sprite.js](lib/sprite.js) — tách frame từ sprite
- [lib/gif.js](lib/gif.js) — encode GIF
- [lib/naming.js](lib/naming.js) — đặt tên file tải về
- [vendor/omggif-esm.js](vendor/omggif-esm.js) — ESM wrapper cho `omggif`
- [vendor/omggif.js](vendor/omggif.js) — thư viện GIF encoder/decoder vendor