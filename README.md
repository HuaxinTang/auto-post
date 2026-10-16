# Auto Post

开源社交媒体内容发布工具（打样版）。第一阶段：抖音图文发布，浏览器自动化接入。

## 架构

- `apps/web` — Next.js 控制台（:3000）
- `apps/api` — NestJS API + 执行器 WS 网关（:3001）
- `apps/worker` — BullMQ 任务处理器（M3 启用）
- `apps/agent` — 本地 Playwright 执行器（部署在住宅 IP 机器）
- `libs/contracts` — 执行器协议（zod，两端共享）
- `libs/db` — Prisma 数据模型
- `libs/platforms` — 平台 Provider 抽象（抖音 browser provider）
- `libs/queue` — BullMQ 封装
- `libs/crypto` — 登录态 AES-256-GCM 加解密
- `libs/storage` — S3/MinIO 适配（磁盘 fallback）

## 快速开始（开发）

```bash
# 1. 基础设施（需 Docker Desktop）
docker compose -f docker/docker-compose.dev.yml up -d postgres redis

# 2. 依赖与数据库
corepack pnpm install
cd libs/db && cp ../../.env .env && corepack pnpm exec prisma migrate dev

# 3. 构建 libs（api/worker 依赖其 dist 产物）
corepack pnpm nx run-many -t build -p contracts db crypto storage queue platforms

# 4. 启动 API（3001）
cd apps/api && cp ../../.env .env && node dist/main.js   # 或 nest start --watch

# 5. 启动 Web（3000）
cd apps/web && corepack pnpm exec next dev

# 6. 启动执行器（本机）
cd apps/agent && corepack pnpm exec playwright install chromium
corepack pnpm exec tsx --env-file=../../.env src/main.ts
```

Web 打开 http://localhost:3000/executors → 运行冒烟测试，验证执行器连通。

## 关键环境变量（.env）

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | Postgres 连接串 |
| `CREDENTIAL_ENC_KEY` | 登录态加密密钥（32B base64，生产必须更换） |
| `STORAGE_BACKEND` | `disk`（默认）或 S3（需 `S3_ENDPOINT`） |
| `DEV_ENROLL_CODE` | 执行器注册码（打样期） |
| `AGENT_API_URL` | 执行器连接的 API 地址 |
| `AGENT_HEADLESS` | 执行器无头模式（登录建议有头） |

## 安全提示

抖音对自动化有风控。执行器必须运行在住宅 IP 机器上，勿在云 VPS 直跑浏览器。默认发布模式为「存草稿 + 人工确认」。账号风控风险自负。
