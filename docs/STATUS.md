# Trạng thái tính năng

Ngày cập nhật: 10/11/2026 (đợt 2). Quy ước: **Xong** là đã có backend, giao diện và test. **Một phần** là đã chạy được nhưng thiếu một số khía cạnh của đặc tả. **Chưa làm** là chưa có code.

## Nền tảng

| Hệ thống | Trạng thái | Ghi chú |
|---|---|---|
| Monorepo, TypeScript strict, lint | Xong | |
| Database và migrations | Xong | 3 migration, có khóa advisory để chạy song song an toàn |
| Đăng ký, đăng nhập, phiên | Xong | scrypt, token băm, thu hồi phiên |
| Phân quyền player/admin | Xong | Chưa chia quyền chi tiết theo nhóm Admin |
| Đồng hồ 1:30, tick, job idempotent, bù tick khi khởi động lại | Xong | Có test |
| Sổ cái kép, chống chi trùng, append-only | Xong | Có test đồng thời |
| Realtime WebSocket | Xong | Thông báo và tick |
| Audit log | Xong | |
| Rate limit, validation, health check, graceful shutdown | Xong | |
| Backup và restore | Một phần | Có script; chưa chạy thử trên VPS (môi trường này không có Docker daemon) |
| Monitoring | Xong | `/metrics` chuẩn Prometheus (bảo vệ bằng token): HTTP, độ trễ tick, job, heartbeat worker, kiểm toán sổ cái, cảnh báo thị trường. Có luật cảnh báo và profile Docker `monitoring` |

## Gameplay

| Hệ thống | Trạng thái | Ghi chú |
|---|---|---|
| Thành lập doanh nghiệp (ngành, địa điểm, vốn, giấy phép theo giờ game) | Xong | 6 ngành, 6 địa điểm |
| 5 giai đoạn phát triển, điều kiện tổng hợp | Xong | Xét khi chốt tháng; giai đoạn không bị hạ |
| Nhân sự: tuyển, thương lượng, ca, phòng ban, chức danh, lương theo giờ, nợ lương, nghỉ việc, kỹ năng tăng theo kinh nghiệm | Xong | |
| Nhân sự: thưởng, phúc lợi (4 gói), nghỉ phép có lương (12 ngày/năm game), tăng ca sau 17:00 (150% lương) | Xong | Đào tạo riêng chưa có; kỹ năng vẫn tăng theo kinh nghiệm |
| Sản xuất: công thức, máy móc, công suất, hao mòn, bảo trì, khấu hao, giá vốn, hao hụt | Xong | Chưa mô hình chất lượng sản phẩm |
| Kho hàng | Xong | |
| Logistics: đơn vận chuyển, cước, ETA, trễ hạn | Xong | Chưa có lựa chọn hãng vận chuyển |
| Hợp đồng cung ứng dài hạn | Xong | Đề nghị và ký, đặt cọc qua tài khoản ký quỹ, giao định kỳ theo giá hợp đồng, nghiệm thu trong 1 ngày, khiếu nại do Admin phân xử, phạt giao trễ, vi phạm, đơn phương chấm dứt. NPC tự quyết định ký |
| Thị trường bán lẻ (cung cầu, giá, uy tín, thương hiệu, vị trí, cạnh tranh) | Xong | |
| Marketing | Xong | 4 kênh, kênh truyền hình khóa theo giai đoạn |
| Báo cáo tháng, thuế theo ngành, nợ thuế | Xong | |
| Bảng cân đối kế toán | Xong | |
| Báo cáo lưu chuyển tiền tệ | Xong | Phương pháp trực tiếp: kinh doanh, đầu tư, tài chính. Lãi vay tách khỏi nợ gốc. Lưu vào báo cáo tháng khi chốt |
| Ngân hàng: vay, lịch trả, lãi, quá hạn, nợ xấu, chuyển khoản | Xong | |
| Ngân hàng: tiền gửi có lãi, tài sản bảo đảm | Xong | Tiền gửi không kỳ hạn và có kỳ hạn 7/14/28 ngày, rút trước hạn mất lãi. Thế chấp thiết bị: tăng hạn mức 70% giá trị sổ sách, giảm lãi; vỡ nợ thì ngân hàng thu thiết bị, giảm nợ 60% giá trị sổ sách |
| Phá sản | Xong | Chưa có quy trình thanh lý tài sản cho chủ nợ |
| Doanh nghiệp NPC | Xong | 3 nhà cung cấp và 4 cửa hàng cạnh tranh |
| Chi nhánh, công ty mẹ/con, mua lại, sáp nhập | Xong | Chi nhánh tăng lưu lượng khách và có tiền thuê riêng. Chào mua 100% doanh nghiệp chưa niêm yết; NPC chỉ bán từ 130% giá trị sổ sách. Nắm trên 50% cổ phần là nắm quyền kiểm soát. Sáp nhập công ty con theo giá trị sổ sách. Chặn tự giao dịch |

## Tài chính nâng cao

| Hệ thống | Trạng thái | Ghi chú |
|---|---|---|
| IPO có điều kiện niêm yết | Xong | Điều kiện kiểm toán là báo cáo tháng có lãi |
| Sổ lệnh, lệnh giới hạn và lệnh thị trường, khớp giá–thời gian, khớp một phần, hủy lệnh, phong tỏa | Xong | Có test đồng thời |
| Cổ tức | Xong | |
| Công bố thông tin | Một phần | Tự động khi IPO và trả cổ tức; chưa có công bố thủ công |
| Tạm ngừng giao dịch | Xong | Admin, và tự động khi phá sản |
| Hủy niêm yết | Xong | Tự nguyện (mua lại toàn bộ cổ phiếu bên ngoài với giá không thấp hơn giá khớp gần nhất và giá IPO), bắt buộc (Admin), tự động khi phá sản và tạm ngừng quá 7 ngày |
| Giám sát thao túng | Xong | Mỗi giờ game: biến động giá bất thường (tự tạm ngừng khi trên 30%), giao dịch vòng, tập trung khối lượng. Admin xử lý cảnh báo |

## Cộng đồng

| Hệ thống | Trạng thái | Ghi chú |
|---|---|---|
| Thư viện doanh nghiệp (tìm kiếm, lọc, sắp xếp, hồ sơ, lịch sử) | Xong | |
| Đánh giá 1–5 sao, phản hồi của chủ doanh nghiệp, báo cáo vi phạm, kiểm duyệt | Xong | Chống tự đánh giá, cổ đông lớn, tài khoản mới, spam, nội dung rỗng |
| Reviewer: thư mời, bài kiểm tra 5 câu, 15 uy tín, trừ 1 điểm mỗi 7 ngày thực, tự thu hồi ở 0, điểm đánh giá, 5 cấp 100/200/450/900/1.900 | Xong | Có test |
| Reviewer đề cử | Xong | Chặn xung đột lợi ích; đếm theo số Reviewer khác nhau |
| Tuyển Chọn | Xong | Chỉ Admin cấp và thu hồi, bắt buộc có lý do |
| Yêu Thích | Xong | Ngưỡng đã duyệt; tự thu hồi khi không còn đạt (xem bên dưới) |
| Hộp thư, hỗ trợ, bảng xếp hạng, hồ sơ | Xong | |
| Admin Dashboard | Xong | Chưa có quản lý sự kiện |

## Giao diện

| Hạng mục | Trạng thái |
|---|---|
| Design system Sky Blue trên nền navy | Xong |
| Nút 3D, sóng ánh sáng định kỳ (chỉ nút CTA), hover, nhấn, loading, disabled, focus | Xong |
| Reduced motion | Xong |
| Responsive PC và mobile, vùng chạm 44 px, modal dạng bottom sheet | Xong (kiểm thử bằng Chromium giả lập iPhone 13; chưa thử trên Safari iOS và Chrome Android thật) |
| Đa ngôn ngữ (i18next, vi/en) | Một phần: hạ tầng và nút chuyển ngôn ngữ xong; đã dịch tiếng Anh cho khung điều hướng, trang đăng nhập, Dashboard, danh sách doanh nghiệp, hộp thoại chung. Các trang nghiệp vụ còn lại vẫn tiếng Việt (chuỗi chưa dịch tự hiển thị tiếng Việt). Có test chặn thiếu bản dịch |

## Kết quả kiểm thử thực tế

- `pnpm typecheck`, `pnpm lint`, `pnpm build`: qua.
- Unit và tích hợp: **85 test qua**, chạy trên PostgreSQL 16 thật.
  - shared: 6 test.
  - engine: 59 test, gồm 20 test cho các tính năng mở rộng.
  - API: 15 test, gồm `/metrics` và phân quyền các endpoint mới.
  - web: 5 test, gồm test chặn thiếu bản dịch.
- E2E bằng trình duyệt trên stack chạy thật: **26/26 mục qua**. Thêm mới so với lần trước: chính sách nhân sự, hợp đồng với NPC được tự ký, tab Tập đoàn, báo cáo lưu chuyển tiền tệ, tiền gửi, tab giám sát của Admin, giao diện tiếng Anh.
- Lỗi phát hiện và đã sửa khi làm đợt này:
  - Khi phá sản, lệnh chứng khoán của doanh nghiệp bị hủy nhưng tiền phong tỏa không được giải phóng.
  - Doanh nghiệp đang chờ giấy phép không đề nghị được hợp đồng mua.
  - Thứ tự kiểm tra khi chào mua làm hiện sai thông báo lỗi.

### Quan sát về cân bằng kinh tế (cần tinh chỉnh khi có người chơi thật)

- Các NPC lỗ nhẹ ở tháng đầu, rồi cửa hàng bán lẻ NPC tiến dần về hòa vốn. Nhà cung cấp lỗ vì chỉ có 4 cửa hàng NPC mua hàng; người chơi gia nhập sẽ tạo thêm cầu.
- Trợ cấp dân cư đã được giảm sau mô phỏng; con số chính xác cần điều chỉnh tiếp.

## Danh hiệu Yêu Thích

Thông số đã được chủ dự án duyệt ngày 10/11/2026:

| Thông số | Giá trị |
|---|---|
| Số đánh giá hợp lệ tối thiểu | 10, từ 10 tài khoản khác nhau |
| Điểm trung bình | ≥ 4,5 |
| Tỷ lệ đánh giá tích cực (4–5 sao) | ≥ 85% |
| Loại trừ | Doanh nghiệp có báo cáo thao túng đánh giá bị xác nhận |

**Không có thời hạn cố định:** danh hiệu được giữ chừng nào doanh nghiệp còn đạt đủ cả ba ngưỡng.

**Tự động mất danh hiệu:** ngay khi bất kỳ thông số nào xuống dưới ngưỡng. Hệ thống kiểm tra lại sau mỗi đánh giá mới, mỗi quyết định kiểm duyệt và mỗi chu kỳ tháng. Doanh nghiệp được thông báo kèm lý do; thao tác được ghi audit log.

**Xét chọn:** mỗi tháng game chọn ngẫu nhiên tối đa 5 doanh nghiệp mới trong nhóm đủ điều kiện. Các con số nằm ở `FAVORITE_PARAMS` trong `packages/engine/src/community.ts`.
