# 🦞 OpenClaw Admin Panel

OpenClaw 多机器人协作系统的 Web 可视化管理面板。

通过浏览器管理 `openclaw.json` 中的所有配置：Discord 多账号、服务器/频道/用户权限、Agent 绑定、Hooks、模型设置等。

## 功能

| 模块 | 说明 |
|------|------|
| 📊 仪表盘 | 配置概览、Agent 数量、Gateway 状态、Discord 账号数 |
| 🤖 Agent 管理 | 创建/删除 Agent，编辑 SOUL.md、AGENTS.md 等文件 |
| 💬 Discord 管理 | 多账号 CRUD，服务器/频道/用户三级权限层级，Agent 快捷绑定 |
| 🔗 绑定管理 | 按服务器→频道分组展示绑定关系，支持自定义备注名 |
| 🪝 Hooks 管理 | session-memory / command-logger 开关 |
| 🖥️ Gateway 管理 | 启动/停止/重启，实时状态监控 |
| ⚙️ 系统设置 | 会话超时、DM 范围、模型配置、工具权限 |

## 快速开始

### 方式一：npx 直接运行（无需安装）

```bash
npx openclaw-admin
# 访问 http://localhost:3000
```

### 方式二：全局安装

```bash
npm install -g openclaw-admin
openclaw-admin --port 3000
```

### 方式三：安装为系统服务（推荐生产环境）

```bash
npx openclaw-admin --install
# 自动配置 systemd，开机自启，崩溃自动重启
```

## 前提条件

- Node.js 18+
- OpenClaw 已安装并初始化（`openclaw onboard`）
- `~/.openclaw/openclaw.json` 存在

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ADMIN_PORT` | `3000` | 面板端口 |
| `OPENCLAW_CONFIG` | `~/.openclaw/openclaw.json` | OpenClaw 配置文件路径 |

## 命令行参数

```
npx openclaw-admin [--port 3000] [--install]
  --port     指定端口（默认 3000）
  --install  安装为 systemd 服务
```

## 截图

（Discord 多账号管理，按服务器/频道分组的绑定视图）

## License

MIT
