#!/bin/bash
# ============================================
# 🦞 OpenClaw 管理面板 - 一键部署脚本
# ============================================
# 用法:
#   curl -sL https://your-server/deploy.sh | bash
#   或: bash deploy.sh [--port 3000] [--config /root/.openclaw/openclaw.json]
#
# 前提:
#   - Node.js 18+ 已安装
#   - OpenClaw 已安装并初始化 (openclaw onboard)
#   - openclaw.json 已存在
# ============================================

set -e

# ---- 默认配置 ----
ADMIN_PORT=3000
ADMIN_DIR="/opt/openclaw-admin"
OPENCLAW_CONFIG=""

# ---- 解析参数 ----
while [[ $# -gt 0 ]]; do
  case $1 in
    --port) ADMIN_PORT="$2"; shift 2 ;;
    --config) OPENCLAW_CONFIG="$2"; shift 2 ;;
    --dir) ADMIN_DIR="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# ---- 颜色 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ---- 检查环境 ----
command -v node >/dev/null 2>&1 || error "Node.js 未安装，请先安装 Node.js 18+"
command -v npm >/dev/null 2>&1 || error "npm 未安装"

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_VERSION" -ge 18 ] 2>/dev/null || error "Node.js 版本过低 (当前 $(node -v))，需要 18+"

# ---- 检查 openclaw.json ----
if [ -z "$OPENCLAW_CONFIG" ]; then
  if [ -f "$HOME/.openclaw/openclaw.json" ]; then
    OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"
  elif [ -f "/root/.openclaw/openclaw.json" ]; then
    OPENCLAW_CONFIG="/root/.openclaw/openclaw.json"
  else
    error "找不到 openclaw.json，请先运行 openclaw onboard 并确保配置文件存在"
  fi
fi

OPENCLAW_HOME=$(dirname "$OPENCLAW_CONFIG")

# ---- 创建目录 ----
info "部署目录: $ADMIN_DIR"
mkdir -p "$ADMIN_DIR/public"
mkdir -p "$ADMIN_DIR/data"

# ---- 检查是否已有文件 ----
if [ -f "$ADMIN_DIR/server.js" ]; then
  warn "检测到已有部署，将更新文件（保留 data 目录）"
fi

# ---- 复制文件 ----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/server.js" ]; then
  cp "$SCRIPT_DIR/server.js" "$ADMIN_DIR/server.js"
  cp -r "$SCRIPT_DIR/public/"* "$ADMIN_DIR/public/"
fi

# ---- 如果是从压缩包部署 ----
# 用户可以先打包: tar czf openclaw-admin.tar.gz -C /opt openclaw-admin/ --exclude=data --exclude=node_modules
# 然后在新服务器: tar xzf openclaw-admin.tar.gz -C /opt

# ---- 安装依赖 ----
if [ ! -d "$ADMIN_DIR/node_modules" ]; then
  info "安装依赖..."
  cd "$ADMIN_DIR"
  npm init -y >/dev/null 2>&1
  npm install express express-session cookie-parser >/dev/null 2>&1
fi

# ---- 创建 systemd 服务 ----
info "配置 systemd 服务..."
SERVICE_NAME="openclaw-admin"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=OpenClaw Admin Panel
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$ADMIN_DIR
Environment=ADMIN_PORT=$ADMIN_PORT
Environment=OPENCLAW_CONFIG=$OPENCLAW_CONFIG
ExecStart=$(which node) $ADMIN_DIR/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME} >/dev/null 2>&1
systemctl restart ${SERVICE_NAME}

sleep 2

# ---- 验证 ----
if systemctl is-active --quiet ${SERVICE_NAME}; then
  # 获取服务器 IP
  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || curl -s ifconfig.me 2>/dev/null || echo "your-server-ip")

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  🦞 OpenClaw 管理面板部署成功！${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
  echo ""
  echo "  📍 访问地址: http://${SERVER_IP}:${ADMIN_PORT}"
  echo "  🔑 登录 Token: $(python3 -c "import json;print(json.load(open('$OPENCLAW_CONFIG')).get('gateway',{}).get('auth',{}).get('token','未设置'))" 2>/dev/null || echo '请查看 openclaw.json')"
  echo ""
  echo "  常用命令:"
  echo "    systemctl status ${SERVICE_NAME}   # 查看状态"
  echo "    systemctl restart ${SERVICE_NAME}  # 重启"
  echo "    journalctl -u ${SERVICE_NAME} -f   # 查看日志"
  echo ""
  echo "  配置文件: $OPENCLAW_CONFIG"
  echo "  面板端口: $ADMIN_PORT"
  echo ""
else
  error "服务启动失败，请查看: journalctl -u ${SERVICE_NAME} --no-pager -n 20"
fi
