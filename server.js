const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = parseInt(process.env.ADMIN_PORT || '3000', 10);
const CONFIG_PATH = process.env.OPENCLAW_CONFIG || path.join(process.env.HOME || '/root', '.openclaw/openclaw.json');
const WORKSPACES_DIR = path.dirname(CONFIG_PATH);
const DATA_DIR = __dirname;
const GROUPS_FILE = path.join(DATA_DIR, 'data', 'groups.json');
const LABELS_FILE = path.join(DATA_DIR, 'data', 'labels.json');

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ============ Auth ============
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.headers.authorization === `Bearer ${getGatewayToken()}`) return next();
  res.status(401).json({ error: '未授权' });
}

function getGatewayToken() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return config.gateway?.auth?.token || '';
  } catch { return ''; }
}

// ============ Config Helpers ============
function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function maskToken(token) {
  if (!token || token.length < 8) return '••••••••';
  return token.slice(0, 4) + '••••••••' + token.slice(-4);
}

// ============ Auth Routes ============
app.post('/api/auth/login', (req, res) => {
  const { token } = req.body;
  const gwToken = getGatewayToken();
  if (token === gwToken) {
    req.session.authenticated = true;
    req.session.token = token;
    res.json({ success: true, message: '登录成功' });
  } else {
    res.status(401).json({ error: 'Token 无效' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// ============ Agent Management ============
app.get('/api/agents', requireAuth, (req, res) => {
  try {
    const config = readConfig();
    const agents = [];
    // Read from config.agents.list
    const agentList = config.agents?.list || [];
    for (const entry of agentList) {
      const agentId = typeof entry === 'string' ? entry : entry.id;
      const wsPath = typeof entry === 'object' && entry.workspace ? entry.workspace : path.join(WORKSPACES_DIR, `workspace-${agentId}`);
      const files = ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'USER.md', 'TOOLS.md'];
      const existing = files.filter(f => fs.existsSync(path.join(wsPath, f)));
      agents.push({ id: agentId, workspace: wsPath, files: existing });
    }
    // Also check main workspace
    const mainPath = path.join(WORKSPACES_DIR, 'workspace');
    if (fs.existsSync(mainPath)) {
      const files = ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'USER.md', 'TOOLS.md'];
      const existing = files.filter(f => fs.existsSync(path.join(mainPath, f)));
      agents.unshift({ id: 'main', workspace: mainPath, files: existing });
    }
    res.json(agents);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agents', requireAuth, (req, res) => {
  try {
    const { id } = req.body;
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return res.status(400).json({ error: '无效的 Agent ID' });
    }
    const wsPath = path.join(WORKSPACES_DIR, `workspace-${id}`);
    if (fs.existsSync(wsPath)) {
      return res.status(400).json({ error: 'Agent 已存在' });
    }
    fs.mkdirSync(wsPath, { recursive: true });
    fs.writeFileSync(path.join(wsPath, 'SOUL.md'), `# SOUL.md - ${id}\n\n_描述这个 Agent 的身份和行为。_\n\n## Core Truths\n\n- 用自己的话填写你的核心特征\n\n## Boundaries\n\n- 填写你的边界规则\n`, 'utf8');
    fs.writeFileSync(path.join(wsPath, 'AGENTS.md'), `# AGENTS.md - ${id}\n\n## 工作空间说明\n\n这是 Agent "${id}" 的工作空间。\n\n## 规则\n\n- 遵循 SOUL.md 中定义的角色\n\n## 记忆\n\n使用 memory/ 目录存放日志，MEMORY.md 存放长期记忆。\n`, 'utf8');
    fs.writeFileSync(path.join(wsPath, 'USER.md'), `# USER.md - About Your Human\n\n- **Name:**\n- **Notes:**\n`, 'utf8');
    fs.writeFileSync(path.join(wsPath, 'TOOLS.md'), `# TOOLS.md - ${id}\n\n## 工具配置\n\n在此记录此 Agent 特有的工具配置。\n`, 'utf8');

    const config = readConfig();
    if (!config.agents) config.agents = {};
    if (!config.agents.list) config.agents.list = [];
    // Check if already exists (by id)
    const exists = config.agents.list.some(a => (typeof a === 'string' ? a : a.id) === id);
    if (!exists) {
      config.agents.list.push({ id, workspace: wsPath });
      writeConfig(config);
    }
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/agents/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'main') return res.status(400).json({ error: '不能删除主 Agent' });
    const config = readConfig();
    // Find workspace path from config
    let wsPath = path.join(WORKSPACES_DIR, `workspace-${id}`);
    const entry = (config.agents?.list || []).find(a => (typeof a === 'string' ? a : a.id) === id);
    if (typeof entry === 'object' && entry.workspace) wsPath = entry.workspace;
    
    if (fs.existsSync(wsPath)) {
      fs.rmSync(wsPath, { recursive: true, force: true });
    }
    if (config.agents?.list) {
      config.agents.list = config.agents.list.filter(a => (typeof a === 'string' ? a : a.id) !== id);
      writeConfig(config);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ File Editor ============
app.get('/api/agents/:id/files/:filename', requireAuth, (req, res) => {
  try {
    const { id, filename } = req.params;
    const allowed = ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md', 'HEARTBEAT.md'];
    if (!allowed.includes(filename)) return res.status(400).json({ error: '不允许的文件名' });
    let wsDir = id === 'main' ? 'workspace' : `workspace-${id}`;
    let wsPath = path.join(WORKSPACES_DIR, wsDir);
    if (!fs.existsSync(wsPath) && id !== 'main') {
      const config = readConfig();
      const entry = (config.agents?.list || []).find(a => (typeof a === 'string' ? a : a.id) === id);
      if (typeof entry === 'object' && entry.workspace) wsPath = entry.workspace;
    }
    const filePath = path.join(wsPath, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    res.json({ content: fs.readFileSync(filePath, 'utf8') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/agents/:id/files/:filename', requireAuth, (req, res) => {
  try {
    const { id, filename } = req.params;
    const { content } = req.body;
    const allowed = ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md', 'HEARTBEAT.md'];
    if (!allowed.includes(filename)) return res.status(400).json({ error: '不允许的文件名' });
    let wsDir = id === 'main' ? 'workspace' : `workspace-${id}`;
    let wsPath = path.join(WORKSPACES_DIR, wsDir);
    if (!fs.existsSync(wsPath) && id !== 'main') {
      const config = readConfig();
      const entry = (config.agents?.list || []).find(a => (typeof a === 'string' ? a : a.id) === id);
      if (typeof entry === 'object' && entry.workspace) wsPath = entry.workspace;
    }
    fs.writeFileSync(path.join(wsPath, filename), content, 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Discord Multi-Account Management ============
// GET: full discord config (tokens masked)
app.get('/api/discord', requireAuth, (req, res) => {
  try {
    const config = readConfig();
    const discord = config.channels?.discord || {};
    const accounts = discord.accounts || {};
    const maskedAccounts = {};
    for (const [name, acc] of Object.entries(accounts)) {
      maskedAccounts[name] = {
        ...acc,
        token: acc.token ? maskToken(acc.token) : '',
        _hasToken: !!acc.token
      };
      // Mask guild-level info stays as-is (no secrets there)
    }
    res.json({
      enabled: discord.enabled !== false,
      allowBots: discord.allowBots || false,
      groupPolicy: discord.groupPolicy || 'open',
      accounts: maskedAccounts
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT: global discord settings
app.put('/api/discord', requireAuth, (req, res) => {
  try {
    const config = readConfig();
    if (!config.channels) config.channels = {};
    if (!config.channels.discord) config.channels.discord = {};
    const d = config.channels.discord;
    if (req.body.enabled !== undefined) d.enabled = req.body.enabled;
    if (req.body.allowBots !== undefined) d.allowBots = req.body.allowBots;
    if (req.body.groupPolicy !== undefined) d.groupPolicy = req.body.groupPolicy;
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST: add discord account
app.post('/api/discord/accounts', requireAuth, (req, res) => {
  try {
    const { name, token, groupPolicy } = req.body;
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: '无效的账号名' });
    if (!token || !token.trim()) return res.status(400).json({ error: 'Token 不能为空' });
    const config = readConfig();
    if (!config.channels) config.channels = {};
    if (!config.channels.discord) config.channels.discord = {};
    if (!config.channels.discord.accounts) config.channels.discord.accounts = {};
    if (config.channels.discord.accounts[name]) return res.status(400).json({ error: '账号名已存在' });
    config.channels.discord.accounts[name] = {
      token: token.trim(),
      groupPolicy: groupPolicy || 'allowlist',
      guilds: {}
    };
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT: update discord account
app.put('/api/discord/accounts/:name', requireAuth, (req, res) => {
  try {
    const { name } = req.params;
    const config = readConfig();
    const acc = config.channels?.discord?.accounts?.[name];
    if (!acc) return res.status(404).json({ error: '账号不存在' });
    if (req.body.token && req.body.token.trim() && !req.body.token.includes('••••')) {
      acc.token = req.body.token.trim();
    }
    if (req.body.groupPolicy !== undefined) acc.groupPolicy = req.body.groupPolicy;
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE: discord account
app.delete('/api/discord/accounts/:name', requireAuth, (req, res) => {
  try {
    const { name } = req.params;
    const config = readConfig();
    if (!config.channels?.discord?.accounts?.[name]) return res.status(404).json({ error: '账号不存在' });
    delete config.channels.discord.accounts[name];
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST: add guild to account
app.post('/api/discord/accounts/:name/guilds', requireAuth, (req, res) => {
  try {
    const { name } = req.params;
    const { guildId, requireMention } = req.body;
    if (!guildId || !guildId.trim()) return res.status(400).json({ error: 'Guild ID 不能为空' });
    const config = readConfig();
    const acc = config.channels?.discord?.accounts?.[name];
    if (!acc) return res.status(404).json({ error: '账号不存在' });
    if (!acc.guilds) acc.guilds = {};
    if (acc.guilds[guildId.trim()]) return res.status(400).json({ error: 'Guild 已存在' });
    acc.guilds[guildId.trim()] = {
      requireMention: requireMention !== undefined ? requireMention : true,
      channels: {},
      users: []
    };
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT: update guild
app.put('/api/discord/accounts/:name/guilds/:guildId', requireAuth, (req, res) => {
  try {
    const { name, guildId } = req.params;
    const config = readConfig();
    const guild = config.channels?.discord?.accounts?.[name]?.guilds?.[guildId];
    if (!guild) return res.status(404).json({ error: 'Guild 不存在' });
    if (req.body.requireMention !== undefined) guild.requireMention = req.body.requireMention;
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE: guild from account
app.delete('/api/discord/accounts/:name/guilds/:guildId', requireAuth, (req, res) => {
  try {
    const { name, guildId } = req.params;
    const config = readConfig();
    const acc = config.channels?.discord?.accounts?.[name];
    if (!acc?.guilds?.[guildId]) return res.status(404).json({ error: 'Guild 不存在' });
    delete acc.guilds[guildId];
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST: add channel to guild
app.post('/api/discord/accounts/:name/guilds/:guildId/channels', requireAuth, (req, res) => {
  try {
    const { name, guildId } = req.params;
    const { channelId, allow, requireMention } = req.body;
    if (!channelId || !channelId.trim()) return res.status(400).json({ error: 'Channel ID 不能为空' });
    const config = readConfig();
    const guild = config.channels?.discord?.accounts?.[name]?.guilds?.[guildId];
    if (!guild) return res.status(404).json({ error: 'Guild 不存在' });
    if (!guild.channels) guild.channels = {};
    if (guild.channels[channelId.trim()]) return res.status(400).json({ error: 'Channel 已存在' });
    guild.channels[channelId.trim()] = {
      allow: allow !== undefined ? allow : true,
      requireMention: requireMention !== undefined ? requireMention : true
    };
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT: update channel in guild
app.put('/api/discord/accounts/:name/guilds/:guildId/channels/:channelId', requireAuth, (req, res) => {
  try {
    const { name, guildId, channelId } = req.params;
    const config = readConfig();
    const ch = config.channels?.discord?.accounts?.[name]?.guilds?.[guildId]?.channels?.[channelId];
    if (!ch) return res.status(404).json({ error: 'Channel 不存在' });
    if (req.body.allow !== undefined) ch.allow = req.body.allow;
    if (req.body.requireMention !== undefined) ch.requireMention = req.body.requireMention;
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE: channel from guild
app.delete('/api/discord/accounts/:name/guilds/:guildId/channels/:channelId', requireAuth, (req, res) => {
  try {
    const { name, guildId, channelId } = req.params;
    const config = readConfig();
    const guild = config.channels?.discord?.accounts?.[name]?.guilds?.[guildId];
    if (!guild?.channels?.[channelId]) return res.status(404).json({ error: 'Channel 不存在' });
    delete guild.channels[channelId];
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST: add user to guild whitelist
app.post('/api/discord/accounts/:name/guilds/:guildId/users', requireAuth, (req, res) => {
  try {
    const { name, guildId } = req.params;
    const { userId } = req.body;
    if (!userId || !userId.trim()) return res.status(400).json({ error: '用户 ID 不能为空' });
    const config = readConfig();
    const guild = config.channels?.discord?.accounts?.[name]?.guilds?.[guildId];
    if (!guild) return res.status(404).json({ error: 'Guild 不存在' });
    if (!guild.users) guild.users = [];
    if (guild.users.includes(userId.trim())) return res.status(400).json({ error: '用户已存在' });
    guild.users.push(userId.trim());
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE: user from guild whitelist
app.delete('/api/discord/accounts/:name/guilds/:guildId/users/:userId', requireAuth, (req, res) => {
  try {
    const { name, guildId, userId } = req.params;
    const config = readConfig();
    const guild = config.channels?.discord?.accounts?.[name]?.guilds?.[guildId];
    if (!guild) return res.status(404).json({ error: 'Guild 不存在' });
    if (!guild.users) guild.users = [];
    guild.users = guild.users.filter(u => u !== userId);
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Bindings Management (top-level bindings array) ============
app.get('/api/bindings', requireAuth, (req, res) => {
  try {
    const config = readConfig();
    res.json(config.bindings || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bindings', requireAuth, (req, res) => {
  try {
    const { agentId, channel, accountId } = req.body;
    if (!agentId || !channel) return res.status(400).json({ error: 'agentId 和 channel 不能为空' });
    const config = readConfig();
    if (!config.bindings) config.bindings = [];
    config.bindings.push({ agentId, match: { channel, accountId: accountId || '' } });
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/bindings/:index', requireAuth, (req, res) => {
  try {
    const idx = parseInt(req.params.index);
    const config = readConfig();
    if (!config.bindings || !config.bindings[idx]) return res.status(404).json({ error: '绑定不存在' });
    config.bindings.splice(idx, 1);
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Hooks Management ============
app.get('/api/hooks', requireAuth, (req, res) => {
  try {
    const config = readConfig();
    const internal = config.hooks?.internal || {};
    res.json({
      enabled: internal.enabled !== false,
      entries: internal.entries || {}
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/hooks', requireAuth, (req, res) => {
  try {
    const config = readConfig();
    if (!config.hooks) config.hooks = {};
    if (!config.hooks.internal) config.hooks.internal = {};
    const hi = config.hooks.internal;
    if (req.body.enabled !== undefined) hi.enabled = req.body.enabled;
    if (req.body.entries) {
      if (!hi.entries) hi.entries = {};
      for (const [key, val] of Object.entries(req.body.entries)) {
        if (hi.entries[key]) {
          hi.entries[key].enabled = val.enabled !== undefined ? val.enabled : hi.entries[key].enabled;
        } else {
          hi.entries[key] = { enabled: val.enabled !== undefined ? val.enabled : true };
        }
      }
    }
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Gateway Management ============
app.get('/api/gateway/status', requireAuth, (req, res) => {
  try {
    let status = 'unknown';
    let info = '';
    // First try systemd status (most reliable)
    try {
      const sysOut = execSync('systemctl is-active openclaw-gateway 2>/dev/null', { timeout: 3000 }).toString().trim();
      if (sysOut === 'active') status = 'running';
      else if (sysOut === 'inactive' || sysOut === 'failed') status = 'stopped';
    } catch {}
    // Fallback: check process
    if (status === 'unknown') {
      try {
        const ps = execSync("ps aux | grep -E 'openclaw.*gateway|node.*openclaw' | grep -v grep | head -1", { timeout: 3000 }).toString();
        status = ps.trim() ? 'running' : 'stopped';
      } catch {}
    }
    // Get full status info
    try { info = execSync('openclaw status 2>&1 | head -30', { timeout: 8000 }).toString(); } catch (e) { info = e.stdout?.toString() || e.stderr?.toString() || ''; }

    let pid = null, uptime = null, memory = null;
    try {
      const ps = execSync("ps aux | grep -E 'openclaw.*gateway|node.*openclaw' | grep -v grep | head -1", { timeout: 3000 }).toString();
      const parts = ps.trim().split(/\s+/);
      pid = parts[1] || null;
      memory = parts[3] || null;
      if (pid) {
        const etime = execSync(`ps -o etime= -p ${pid} 2>/dev/null`, { timeout: 3000 }).toString().trim();
        uptime = etime || null;
      }
    } catch {}
    const config = readConfig();
    const gwConfig = config.gateway || {};
    res.json({ status, info, pid, uptime, memory, port: gwConfig.port, mode: gwConfig.mode, bind: gwConfig.bind, authMode: gwConfig.auth?.mode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gateway/start', requireAuth, (req, res) => {
  try { execSync('openclaw gateway start 2>&1', { timeout: 10000 }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.stderr?.toString() || e.message }); }
});

app.post('/api/gateway/stop', requireAuth, (req, res) => {
  try { execSync('openclaw gateway stop 2>&1', { timeout: 10000 }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.stderr?.toString() || e.message }); }
});

app.post('/api/gateway/restart', requireAuth, (req, res) => {
  try { execSync('openclaw gateway restart 2>&1', { timeout: 15000 }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.stderr?.toString() || e.message }); }
});

// ============ Settings (session + model) ============
app.get('/api/settings', requireAuth, (req, res) => {
  try {
    const config = readConfig();
    res.json({
      idleMinutes: config.session?.idleMinutes || null,
      dmScope: config.session?.dmScope || 'all',
      primaryModel: config.agents?.defaults?.model?.primary || '',
      fallbacks: config.agents?.defaults?.model?.fallbacks || [],
      maxConcurrent: config.agents?.defaults?.maxConcurrent || 4,
      toolProfile: config.tools?.profile || 'full'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/settings', requireAuth, (req, res) => {
  try {
    const config = readConfig();
    if (!config.session) config.session = {};
    if (req.body.idleMinutes !== undefined) config.session.idleMinutes = req.body.idleMinutes;
    if (req.body.dmScope !== undefined) config.session.dmScope = req.body.dmScope;
    if (req.body.primaryModel !== undefined) {
      if (!config.agents) config.agents = {};
      if (!config.agents.defaults) config.agents.defaults = {};
      if (!config.agents.defaults.model) config.agents.defaults.model = {};
      config.agents.defaults.model.primary = req.body.primaryModel;
    }
    if (req.body.fallbacks !== undefined) {
      if (!config.agents) config.agents = {};
      if (!config.agents.defaults) config.agents.defaults = {};
      if (!config.agents.defaults.model) config.agents.defaults.model = {};
      config.agents.defaults.model.fallbacks = req.body.fallbacks;
    }
    if (req.body.maxConcurrent !== undefined) {
      if (!config.agents) config.agents = {};
      if (!config.agents.defaults) config.agents.defaults = {};
      config.agents.defaults.maxConcurrent = req.body.maxConcurrent;
    }
    if (req.body.toolProfile !== undefined) {
      if (!config.tools) config.tools = {};
      config.tools.profile = req.body.toolProfile;
    }
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Groups (local) ============
function readGroups() {
  if (!fs.existsSync(GROUPS_FILE)) return [];
  return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
}
function writeGroups(groups) {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2), 'utf8');
}

app.get('/api/groups', requireAuth, (req, res) => { res.json(readGroups()); });

app.post('/api/groups', requireAuth, (req, res) => {
  try {
    const groups = readGroups();
    const group = { id: Date.now().toString(36), name: req.body.name, description: req.body.description || '', agents: req.body.agents || [], channelId: req.body.channelId || '', createdAt: new Date().toISOString() };
    groups.push(group);
    writeGroups(groups);
    res.json(group);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/groups/:id', requireAuth, (req, res) => {
  try {
    const groups = readGroups();
    const idx = groups.findIndex(g => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '分组不存在' });
    Object.assign(groups[idx], req.body, { id: req.params.id });
    writeGroups(groups);
    res.json(groups[idx]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/groups/:id', requireAuth, (req, res) => {
  try {
    let groups = readGroups();
    groups = groups.filter(g => g.id !== req.params.id);
    writeGroups(groups);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ Labels (guild/channel display names) ============
function readLabels() {
  if (!fs.existsSync(LABELS_FILE)) return { guilds: {}, channels: {} };
  try { return JSON.parse(fs.readFileSync(LABELS_FILE, 'utf8')); } catch { return { guilds: {}, channels: {} }; }
}
function writeLabels(labels) {
  fs.writeFileSync(LABELS_FILE, JSON.stringify(labels, null, 2), 'utf8');
}

app.get('/api/labels', requireAuth, (req, res) => { res.json(readLabels()); });

app.put('/api/labels', requireAuth, (req, res) => {
  try {
    const labels = readLabels();
    if (req.body.guilds) { if (!labels.guilds) labels.guilds = {}; Object.assign(labels.guilds, req.body.guilds); }
    if (req.body.channels) { if (!labels.channels) labels.channels = {}; Object.assign(labels.channels, req.body.channels); }
    writeLabels(labels);
    res.json(labels);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ Config Overview ============
app.get('/api/config', requireAuth, (req, res) => {
  try {
    const config = readConfig();
    res.json({
      meta: config.meta,
      gateway: { port: config.gateway?.port, mode: config.gateway?.mode, bind: config.gateway?.bind, authMode: config.gateway?.auth?.mode },
      agents: { defaults: config.agents?.defaults, list: config.agents?.list },
      channels: { discord: { enabled: config.channels?.discord?.enabled } },
      hooks: config.hooks,
      bindings: config.bindings,
      session: config.session,
      tools: config.tools
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ SPA Fallback ============
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 OpenClaw Admin Panel running at http://0.0.0.0:${PORT}`); });