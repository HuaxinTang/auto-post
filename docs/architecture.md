# Auto Post 组网架构

> 更新于 2026-10-15（M0 完成时）

## 当前打样组网（全部在一台机器，已运行）

```
┌─────────────────────────── 你的电脑（Windows · 住宅 IP）─────────────────────────────┐
│                                                                                     │
│   你的浏览器 ──HTTP──► Web 控制台 (Next.js :3000)                                    │
│                            │  HTTP REST                                             │
│                            ▼                                                        │
│                         API (NestJS :3001)                                          │
│                            │  TCP                                                   │
│                    ┌───────┴────────┐                                               │
│                    ▼                ▼                                               │
│              Postgres(Docker)   Redis(Docker)                                       │
│                    ▲                ▲                                               │
│                    └── TCP(BullMQ) ─┘                                               │
│                        Worker（M3 启用，当前空壳）                                   │
│                                                                                     │
│   执行器 Agent ──WS 出站──► API ◄── HTTP 上传截图/二维码                            │
│       │                                                                            │
│       ▼ Playwright chromium（反检测参数）                                           │
│   creator.douyin.com ◄── 浏览器流量从本机住宅 IP 直连                               │
│       ▲                                                                            │
│       └── 你的手机抖音 App 扫码（登录时一次性交互，不进组网）                        │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## 目标组网（云端 + 多执行器 IP 矩阵）

```
                          ┌───────────── 云端 VPS（公网，唯一入站口）─────────────┐
                          │                                                      │
                          │  Caddy :443 ──► Web (Next.js)                        │
                          │                  │ HTTP REST                         │
                          │                  ▼                                   │
                          │               API (NestJS)                           │
                          │               │            │                         │
                          │          TCP  ▼            ▼ TCP(BullMQ)             │
                          │        Postgres ◄──────► Redis                       │
                          │               ▲            ▲                         │
                          │               └── Worker ──┘                         │
                          │   存储 MinIO/S3 ◄── 截图/二维码/媒体                  │
                          └──────────────────────────────────────────────────────┘
                              ▲                ▲                    ▲
          WS出站+HTTP上传(无入站端口) │                │                    │ HTTP(你/客户访问控制台)
                              │                │                    │
  ┌──执行器1·宽带IP──┐   ┌──执行器2·热点IP──┐  ┌──执行器3·CPE IP──┐  ┌── 任意用户浏览器 ─┐
  │ Agent            │   │ Agent            │  │ Agent            │  └──────────────────┘
  │  └─chromium      │   │  └─chromium      │  │  └─chromium      │
  │      │           │   │      │           │  │      │           │
  │      ▼           │   │      ▼           │  │      ▼           │
  │ creator.douyin   │   │ creator.douyin   │  │ creator.douyin   │
  │ (宽带出口IP)     │   │ (运营商出口IP)   │  │ (另一宽带出口IP) │
  └──────────────────┘   └──────────────────┘  └──────────────────┘
```

## 节点关系表

| 连接 | 方向 | 协议 | 作用 | 说明 |
|---|---|---|---|---|
| Agent → API | **出站** | WS + HTTP | 任务接收、事件回传、截图上传 | 只需 agent 能访问 API，**无需任何入站端口/内网穿透**——NAT 友好 |
| Agent → 抖音 | 直连 | HTTPS | 登录、发布、对账 | 从执行器本机 IP 出去，**IP 隔离是防封号核心** |
| 手机 ↔ 抖音 | 一次性 | HTTPS | 扫码确认登录 | 手机只跟抖音通信，不连我们的系统 |
| Web → API | HTTP | REST | 控制台所有操作 | 用户只接触云端，永远不直连执行器 |
| API/Worker → Postgres/Redis | 内网 | TCP | 状态真相源 + 队列 | 云端内部 |
| Agent/浏览器 → 存储 | HTTP | multipart | 截图、二维码、媒体文件 | 大件不走 WS |

## 任务数据流

```
控制台 ──创建任务──► API ──WS task.assigned──► Agent ──浏览器操作──► 抖音
控制台 ◄──轮询──── API ◄──WS task.event───── Agent ◄──截图/扫码态── 浏览器
截图/二维码：Agent ──HTTP 上传──► API ──► 存储 ◄──HTTP 读取── 控制台
```

## 执行器注册流程

```
执行器机器（住宅 IP）                          云端/本机 API
─────────────────                            ──────────────────
agent 启动
  │
  │ ① HTTP POST /api/executors/enroll
  │    { enrollCode, name, os, version, capabilities }
  ├──────────────────────────────────────────►
  │                                           ② 校验 enrollCode（DEV_ENROLL_CODE）
  │                                             生成随机 token（只存 SHA-256 hash）
  │                                             Executor 表插入一行（状态 OFFLINE）
  │ ③ 返回 { executorId, token } ◄──────────────
  │
  │ ④ WS 连接 ws://<api>/executor/ws
  │ ⑤ 发送 hello { token, capabilities, ... }
  ├──────────────────────────────────────────►
  │                                           ⑥ token hash 匹配 → 标记 ONLINE
  │                                             此后每 15s 心跳，60s 无心跳 → OFFLINE
```

## 两个核心设计原则

1. **执行器对云端只有出站连接**——执行器可以藏在任何 NAT/热点后面，云端永远找不到它，但它能找到云端
2. **浏览器流量从不经过云端**——云 VPS 不碰抖音，风控只看到住宅 IP 的正常浏览器

## 已知待办（M1 修复）

- agent 每次重启会重新注册新 Executor 记录，旧的残留 OFFLINE → M1 改为本地持久化 token 复用
- 账号→执行器亲和性：`PlatformAccount.executorId` 绑定，派发按「能力 → 亲和性 → 空闲」三级路由（多执行器下账号登录态所在机器必须固定）
