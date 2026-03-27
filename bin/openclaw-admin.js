#!/usr/bin/env node
/**
 * 🦞 OpenClaw Admin Panel - CLI 入口
 * 
 * 用法:
 *   npx openclaw-admin              # 默认端口 3000 启动
 *   npx openclaw-admin --port 8080
 *   npx openclaw-admin --install   # 安装为 systemd 服务
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 解析参数
const args = process.argv.slice(2);
let port = 3000;
let shouldInstall = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[i + 1]); i++; }
  if (args[i] === '--install') shouldInstall = true;
}

const ADMIN_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = process.env.OPENCLAW_CONFIG ||
  path.join(process.env.HOME || '/root', '.openclaw/openclaw.json');

// 检查 openclaw.json
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('❌ 找不到 openclaw.json，请先安装并初始化 OpenClaw');
  console.error(`   查找路径: ${CONFIG_PATH}`);
  process.exit(1);
}

if (shouldInstall) {
  // 安装为 systemd 服务
  console.log('🔧 安装 systemd 服务...');

  const serviceContent = `[Unit]
Description=OpenClaw Admin Panel
After=network.target

[Service]
Type=simple
User=${process.getuid() === 0 ? 'root' : process.env.USER}
WorkingDirectory=${ADMIN_DIR}
Environment=ADMIN_PORT=${port}
Environment=OPENCLAW_CONFIG=${CONFIG_PATH}
ExecStart=${process.execPath} ${path.join(ADMIN_DIR, 'server.js')}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
`;

  const servicePath = '/etc/systemd/system/openclaw-admin.service';
  try {
    fs.writeFileSync(servicePath, serviceContent);
    execSync('systemctl daemon-reload');
    execSync('systemctl enable openclaw-admin');
    execSync('systemctl restart openclaw-admin');

    setTimeout(() => {
      try {
        const active = execSync('systemctl is-active openclaw-admin').toString().trim();
        if (active === 'active') {
          console.log('');
          console.log('═══════════════════════════════════════');
          console.log('  🦞 OpenClaw 管理面板安装成功！');
          console.log('═══════════════════════════════════════');
          console.log(`  📍 http://localhost:${port}`);

          try {
            const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            const token = config.gateway?.auth?.token;
            console.log(`  🔑 Token: ${token ? token.slice(0, 8) + '...' : '未设置'}`);
          } catch {}
          console.log('');
          console.log('  管理命令:');
          console.log('    systemctl status openclaw-admin');
          console.log('    systemctl restart openclaw-admin');
          console.log('    journalctl -u openclaw-admin -f');
          console.log('');
        }
      } catch {}
    }, 2000);
  } catch (e) {
    console.error('❌ 安装失败（可能需要 root 权限）:', e.message);
    process.exit(1);
  }
} else {
  // 直接启动
  process.env.ADMIN_PORT = String(port);
  process.env.OPENCLAW_CONFIG = CONFIG_PATH;
  require('../server.js');
}
