# Startup – Khởi Nghiệp Đâu Dễ

Game quản lý doanh nghiệp trực tuyến nhiều người chơi, với một nền kinh tế chung vận hành 24/7 trên server.
Đây là **source mới hoàn toàn**, không dùng lại code, database hay cấu trúc của dự án Startup cũ.

- **Đồng hồ thế giới:** 1 phút thực = 30 phút game · 1 ngày game = 48 phút thực · 1 tháng = 7 ngày game · 1 năm = 12 tháng.
- **Kế toán kép:** mọi biến động tiền và hàng đều có bút toán cân bằng. Database từ chối mọi giao dịch làm âm tài khoản tiền.
- **Không có nút "nhận tiền":** doanh thu đến từ người dân và doanh nghiệp khác mua hàng thật. Hàng phải được sản xuất bằng nguyên liệu, máy móc và nhân công theo ca.

## Cấu trúc

```text
startup-vn/
├── apps/
│   ├── web/        React + Vite + Tailwind + React Router + TanStack Query + Zustand + Recharts
│   ├── server/     Fastify API: xác thực, phân quyền, validation, rate limit, WebSocket
│   └── worker/     Tiến trình duy nhất làm thời gian trôi: lập lịch tick, chạy job, chu kỳ Reviewer
├── packages/
│   ├── shared/     Đồng hồ game, định dạng tiền, schema zod dùng chung cho client và server
│   └── engine/     Toàn bộ luật chơi và kinh tế (sổ cái, sản xuất, thị trường, ngân hàng, sàn, cộng đồng)
├── infra/
│   ├── migrations/ SQL migrations
│   ├── docker/     Dockerfile + docker-compose (Postgres, API, worker, backup)
│   └── scripts/    backup, restore
├── docs/           Kiến trúc, trạng thái tính năng, triển khai
└── .github/workflows/ci.yml
```

So với cấu trúc gợi ý ban đầu, `game-engine` và `economy` được gộp thành một package `engine`: luật chơi và sổ cái phải chạy chung một transaction, nên tách hai package chỉ tạo thêm ranh giới giả. Thư mục `ui` riêng chưa cần, vì hiện chỉ có một ứng dụng web. Lý do chưa dùng Redis được giải thích trong [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Chạy ở máy phát triển

Yêu cầu: Node 20+, pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp .env.example .env            # sửa DATABASE_URL
export $(grep -v '^#' .env | xargs)
pnpm seed                       # chạy migration + tạo thế giới (idempotent)
pnpm admin:create               # tạo tài khoản Admin; mật khẩu do bạn nhập, không có mật khẩu mặc định
pnpm dev:server                 # API :8080
pnpm dev:worker                 # đồng hồ thế giới
pnpm dev:web                    # giao diện :5173
```

## Kiểm thử

```bash
export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5433/startup_test   # database riêng, sẽ bị xóa sạch khi test
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Kết quả và phạm vi kiểm thử: [docs/STATUS.md](docs/STATUS.md).

## Triển khai

Xem [docs/DEPLOY.md](docs/DEPLOY.md). Frontend chạy trên Cloudflare Pages. Backend, PostgreSQL và worker chạy trên VPS bằng Docker Compose. Production chỉ được triển khai sau khi chủ dự án phê duyệt.
