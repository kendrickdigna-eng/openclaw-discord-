#!/bin/bash
# ============================================
# 🦞 打包管理面板（用于迁移到新服务器）
# ============================================
# 用法: bash pack.sh
# 会在当前目录生成 openclaw-admin.tar.gz
# ============================================

set -e

ADMIN_DIR="/opt/openclaw-admin"
PACK_FILE="openclaw-admin.tar.gz"

echo "📦 打包中..."

cd /opt
tar czf "$PACK_FILE" \
  --exclude='openclaw-admin/node_modules' \
  --exclude='openclaw-admin/data' \
  --exclude='openclaw-admin/*.log' \
  --exclude='openclaw-admin/*.bak' \
  --exclude='openclaw-admin/.env' \
  openclaw-admin/

SIZE=$(du -h "$PACK_FILE" | cut -f1)
echo ""
echo "✅ 打包完成: /opt/${PACK_FILE} (${SIZE})"
echo ""
echo "迁移到新服务器:"
echo "  1. scp /opt/${PACK_FILE} user@new-server:/opt/"
echo "  2. ssh user@new-server"
echo "  3. cd /opt && tar xzf ${PACK_FILE}"
echo "  4. bash /opt/openclaw-admin/deploy.sh"
echo ""
echo "或一行搞定:"
echo "  scp /opt/${PACK_FILE} user@new-server:/opt/ && ssh user@new-server 'cd /opt && tar xzf ${PACK_FILE} && bash /opt/openclaw-admin/deploy.sh'"
