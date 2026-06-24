<h1 align="center"><img src="./client/public/incudal_logo.webp" width="100" align="absmiddle" alt="Incudal logo"> Incudal</h1>

<p align="center">基于 Incus 的 LXC / KVM NAT VPS 销售、交付与管理面板。</p>

> Incudal 是基于 BSD 3-Clause 协议的开源项目。在遵守该协议各项条款的前提下，任何人均可自由使用、修改和分发本项目代码。
> 
> **特此声明：**
> * **免责与无支持：** 本项目依“现状（As-is）”提供。除官方文档外，Incudal 不为任何用户提供额外的技术指导与帮助，不对使用产生的任何后果承担责任。
> * **禁止背书与推广：** Incudal 不对任何基于本项目的衍生程序或开源仓库提供背书。请勿使用 Incudal 的名称来认可或推广任何衍生产品。

## 项目简介

Incudal - 基于 Incus 的 NAT VPS 销售与管理面板。
项目支持 LXC / KVM 实例、套餐与镜像管理、账务计费、节点托管、用户后台、管理员后台以及宿主机 Agent。
演示站：https://demo.incudal.com | <a href="https://t.me/incudal_group">交流群聊</a>

## 主要功能

- 实例交付：基于 Incus 创建和管理 LXC / KVM 实例，支持 NAT 网络、系统镜像、套餐资源和节点绑定。
- 平台运营：提供用户端与管理员后台，覆盖用户、套餐、镜像、节点、工单、公告、日志和系统配置等管理流程。
- 计费与权益：支持余额、充值、消费记录、托管收益、支付渠道、积分、VIP 等级和会员福利。
- 节点与扩展：通过宿主机 Agent 上报资源与状态，并支持托管节点、反代建站、邮箱服务等扩展能力。

## 目录结构

```text
client/                 Vue 3 + Vite 前端
server/                 Fastify + Prisma 后端
agent/                  Go 宿主机 Agent
server/prisma/          数据库 schema 与 migrations
server/templates/       安装脚本、邮件等模板
.github/workflows/      CI、Docker、Agent Release 工作流
scripts/                本地开发和检查脚本
```

## 搭建教程

使用根目录的 `docker-compose.yml` 部署。Compose 会启动面板、PostgreSQL 和 Redis，并在容器启动时自动执行数据库迁移。

```bash
git clone https://github.com/qwer-xyz/incudal.git
cd incudal
cp .env.example .env
```

编辑 `.env`，至少修改以下配置：

```env
POSTGRES_PASSWORD=your_strong_database_password
REDIS_PASSWORD=your_strong_redis_password
JWT_SECRET=your_mixed_64_char_secret
COOKIE_SECRET=another_random_secret
ENCRYPTION_KEY=your_base64_32_byte_encryption_key
ADMIN_PASSWORD=your_admin_password
FRONTEND_URL=https://your-domain.example
APP_PORT=3000
```

`ENCRYPTION_KEY` 需要是 32 字节随机值的 Base64 编码，可用下面的命令生成：

```bash
openssl rand -base64 32
```

<strong>当前无论使用哪种部署方式，都需要在 `server/certs` 目录下生成或放置证书与密钥，并确保 Docker 容器具有读取权限。</strong>

配置完成后启动：

```bash
docker compose up -d --build
```

<strong>启动后请使用 Nginx、Caddy、OpenResty 等反向代理将你的域名转发到 `127.0.0.1:${APP_PORT}`，并在反向代理层配置 HTTPS。</strong>

`APP_PORT` 默认是 `3000`，如果你在 `.env` 中修改了该端口，反向代理目标端口也需要同步修改。

停止服务：

```bash
docker compose down
```

如需同时删除数据库和 Redis 数据卷：

```bash
docker compose down -v
```

容器启动时会执行 `prisma migrate deploy`，然后启动后端服务。

Agent 正式二进制不存放在面板仓库内，面板运行时会从 GitHub Release 查询和代理下载。如部署在私有仓库或 fork，可按需配置：

```env
INCUDAL_AGENT_RELEASE_REPOSITORY=qwer-xyz/incudal
INCUDAL_AGENT_RELEASE_TOKEN=github_pat_xxx
```

## 开发教程

### 本地依赖

- Node.js 20 或更高版本
- pnpm 9.14.2
- PostgreSQL
- Redis
- Go 1.22 或更高版本，仅开发 Agent 时需要

启用 pnpm：

```bash
corepack enable
corepack prepare pnpm@9.14.2 --activate
pnpm install
```

配置本地环境变量后执行数据库迁移：

```bash
pnpm --filter server exec prisma migrate deploy
```

启动前后端开发服务：

```bash
pnpm dev
```

默认开发端口：

```text
client: http://127.0.0.1:5173
server: http://127.0.0.1:8888
```

### 常用命令

```bash
pnpm --filter client type-check
pnpm --filter server type-check
pnpm build
pnpm lint
```

本地检查：

```shell
# Windows
.\scripts\local-ci.ps1
# macOS
.\scripts\local-ci-macos.sh
```

### 数据库开发

Prisma schema 位于 `server/prisma/schema.prisma`，迁移文件位于 `server/prisma/migrations/`。修改数据库结构后，应生成迁移并确认前后端类型检查通过。

常用命令：

```bash
pnpm --filter server exec prisma generate
pnpm --filter server exec prisma migrate dev
pnpm --filter server exec prisma migrate deploy
```

### Agent 开发与发布

Agent 位于 `agent/`，版本号统一由 `agent/VERSION` 控制。

本地测试：

```bash
cd agent
go test ./...
go run ./cmd/incudal-agent -config ./config.example.yaml -once
```

本地构建双架构产物：

```bash
bash agent/scripts/build-release.sh
```

`agent/dist` 只是本地临时构建目录，不提交到 Git。正式发布由 GitHub Actions `Agent Build & Release` 完成：当 `agent/VERSION` 变动并推送后，会发布 GitHub Release，并生成：

```text
incudal-agent-x86_64-v0.0.1
incudal-agent-aarch64-v0.0.1
```

## 开发约定

- 前端新增文案需要同步维护 `client/src/locales/` 下的多语言键。
- 后端新增管理接口应使用登录鉴权和管理员鉴权，并补充必要的字段校验和速率限制。
- 数据库变更需要提交 Prisma migration，不直接修改生产库结构。
- 不提交构建产物、临时文件、密钥、数据库 dump 或本地 `.env`。
