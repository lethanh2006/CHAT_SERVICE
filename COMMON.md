# Common của Chat

Điểm bắt đầu là `src/main.ts`, sau đó đến `src/core/core.module.ts` để xem
cách đăng ký middleware, logger và exception filter dùng chung.

Luồng HTTP: `RequestIdMiddleware` → `ChatAuthGuard` → controller → service.
Nếu có lỗi, `GlobalExceptionFilter` tạo response và ghi log qua logger.

| Thư mục trong `src/common` | Trách nhiệm |
| --- | --- |
| `middleware` | Gắn `x-request-id` vào request, response và ngữ cảnh log. |
| `guards` | Xác thực identity từ Gateway hoặc Bearer JWT, gắn `request.user`. |
| `security` | Kiểm tra HMAC từ Gateway, thời hạn và chữ ký đã sử dụng. |
| `interfaces` | Kiểu user và request context dùng trong guard, controller, service. |
| `filters` | Xử lý lỗi HTTP; giữ cách trả lỗi upload ảnh và lỗi chung. |
| `logging` | Khởi tạo logger cho Chat, adapter Nest và flush khi dừng service. |
| `utils` | Hàm nhỏ dùng chung, hiện có chuyển giá trị bắt được thành `Error`. |

Các DTO, upload ảnh, truy vấn User Service và nghiệp vụ hội thoại nằm trong
`src/modules/chat`. Socket.IO đi qua `chat.gateway.ts`, tự xác thực JWT trong
handshake; không đi qua middleware và guard HTTP.

`@nrapp/observability` từ repo Logger cung cấp logger, request ID và xử lý lỗi
chung. Chỉ tạo thư mục khi có code dùng thật; test đặt cạnh file được kiểm tra.
