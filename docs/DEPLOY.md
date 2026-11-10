# Triển khai

## Mô hình

| Thành phần | Nơi chạy | Ghi chú |
|---|---|---|
| Web (tĩnh) | Cloudflare Pages | `apps/web/dist`; `_redirects` cho SPA, `_headers` cho bảo mật và cache |
| API + worker + PostgreSQL + backup | VPS, Docker Compose | Mạng và volume riêng; API chỉ bind `127.0.0.1` |

Cloudflare Pages không chạy được PostgreSQL hay worker liên tục, nên backend bắt buộc chạy trên VPS.

## Môi trường

| Môi trường | Web | API | Database |
|---|---|---|---|
| Local | `pnpm dev:web` | `pnpm dev:server` | Postgres local |
| Preview | Cloudflare Pages, deployment nhánh `preview` | Compose `STARTUP_ENV=preview`, ví dụ cổng 8090 | Volume riêng của preview |
| Production | `startupvn.pages.dev` (deployment nhánh `main`) | Compose `STARTUP_ENV=production`, cổng khác | Volume riêng của production |

Preview và Production là hai stack Compose khác tên (`name: startup-${STARTUP_ENV}`), nên không dùng chung database.

## Backend trên VPS (Preview)

```bash
git clone <repo-mới> /opt/startup-vn && cd /opt/startup-vn
cp infra/docker/.env.example infra/docker/.env      # đặt POSTGRES_PASSWORD, CORS_ORIGINS, API_PORT
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d --build
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env exec api node -e "fetch('http://127.0.0.1:8080/health').then(r=>r.text()).then(console.log)"
```

Tạo Admin (một lần; mật khẩu được nhập tay khi lệnh hỏi, không lưu vào file):

```bash
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env run --rm -it api node apps/server/dist/create-admin.js
```

Reverse proxy (Nginx hoặc Caddy) cấp TLS cho một subdomain API, ví dụ `api-preview.<domain>`, rồi chuyển tiếp tới `127.0.0.1:${API_PORT}` (bật header upgrade cho `/ws`).

## Frontend trên Cloudflare Pages

- Build: `VITE_API_URL=https://api-preview.<domain> pnpm --filter @startup/web build`.
- **Preview** (không ảnh hưởng Production):

```bash
npx wrangler pages deploy apps/web/dist --project-name <project> --branch preview
```

- **Production** (chỉ khi chủ dự án đã phê duyệt):

```bash
npx wrangler pages deploy apps/web/dist --project-name <project> --branch main
```

- CI (`.github/workflows/ci.yml`) có hai job deploy chạy thủ công:
  - `preview`: tạo Preview deployment.
  - `production`: gắn GitHub Environment `production`. Hãy bật "Required reviewers" để bắt buộc phê duyệt.

Cần xác định project Cloudflare Pages hiện đang phục vụ `startupvn.pages.dev`. **Không deploy vào project đó** cho tới khi có xác nhận. Cách an toàn nhất: tạo một project Pages mới cho source mới, kiểm tra kỹ, rồi mới quyết định chuyển domain.

## Monitoring

- Đặt `METRICS_TOKEN` trong `infra/docker/.env` và ghi cùng giá trị vào file `infra/docker/metrics_token` (file này không được commit).
- Bật Prometheus:

```bash
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env --profile monitoring up -d
```

- Luật cảnh báo nằm ở `infra/monitoring/alerts.yml`: đồng hồ thế giới trễ, mất heartbeat của worker, job lỗi hoặc tồn đọng, sổ cái lệch, tỷ lệ lỗi 5xx, cảnh báo thao túng chưa xử lý. Prometheus chỉ bind `127.0.0.1`; nối Alertmanager hoặc Grafana tùy hạ tầng.

## Backup và khôi phục

- Container `backup` chạy `pg_dump -Fc` mỗi 24 giờ vào volume `backups`, giữ 14 ngày.
- Khôi phục vào **database mới** và tự kiểm tra sổ cái:

```bash
infra/scripts/restore.sh /path/startup-<ts>.dump startup_restore
```

Chỉ chuyển `DATABASE_URL` khi `postings_sum = 0` và `drifted_accounts = 0`.

## Rollback

- **Frontend:** trên Cloudflare Pages, chọn deployment trước rồi bấm "Rollback to this deployment".
- **Backend:** checkout tag hoặc commit trước rồi chạy lại `docker compose up -d --build`.
  - Migration chỉ thêm và chạy trong transaction; không có migration xóa dữ liệu.
  - Nếu một bản phát hành có migration không tương thích ngược, khôi phục từ backup ngay trước khi triển khai, theo quy trình ở trên.
