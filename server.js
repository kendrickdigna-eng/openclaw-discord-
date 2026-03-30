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

// 写入配置
function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

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
// 强制禁用缓存
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
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
// 管理后台登录密码
const ADMIN_PASSWORD = '020402';

app.post('/api/auth/login', (req, res) => {
  const { token } = req.body;
  if (token === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.token = token;
    res.json({ success: true, message: '登录成功' });
  } else {
    res.status(401).json({ error: '密码错误' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// ============ System Status (openclaw status --json) ============
app.get('/api/system/status', requireAuth, (req, res) => {
  try {
    const output = execSync('openclaw status --json 2>&1', { timeout: 15000, });
    res.json(JSON.parse(output));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Skills Management ============
app.get('/api/skills', requireAuth, (req, res) => {
  try {
    const output = execSync('openclaw skills --json 2>&1', { timeout: 10000 });
    res.json(JSON.parse(output));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/skills', requireAuth, (req, res) => {
  try {
    const output = execSync('openclaw skills list --json', { timeout: 15000 });
    res.json(JSON.parse(output));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/skills/install', requireAuth, (req, res) => {
  try {
    const { slug, version, force } = req.body;
    if (!slug) return res.status(400).json({ error: '缺少 slug 参数' });
    
    let cmd = `openclaw skills install --json ${slug}`;
    if (version) cmd += ` --version ${version}`;
    if (force) cmd += ' --force';
    
    const output = execSync(cmd, { timeout: 60000 });
    res.json(JSON.parse(output));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/skills/update', requireAuth, (req, res) => {
  try {
    const { slug, version } = req.body;
    let cmd = 'openclaw skills update --json';
    if (slug) cmd += ` ${slug}`;
    if (version) cmd += ` --version ${version}`;
    
    const output = execSync(cmd, { timeout: 60000 });
    res.json(JSON.parse(output));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// ============ Agent Status ============
app.get('/api/agents/status', requireAuth, (req, res) => {
  try {
    const output = execSync('openclaw status --json 2>&1', { timeout: 15000 });
    const status = JSON.parse(output);
    
    // 从Gateway获取真实运行状态
    let gatewayAgents = [];
    try {
      const gwOutput = execSync('openclaw gateway status --json 2>&1', { timeout: 5000 });
      const gwStatus = JSON.parse(gwOutput);
      // Gateway返回的agents包含真实的运行状态
      gatewayAgents = (gwStatus.agents || []).map(a => ({
        agentId: a.agentId || a.id,
        status: a.status || 'unknown'
      }));
    } catch (e) {
      // 如果Gateway不可用，使用heartbeat状态
      gatewayAgents = (status.heartbeat?.agents || []).map(a => ({
        agentId: a.agentId,
        status: a.enabled ? 'running' : 'stopped'
      }));
    }
    
    res.json({ 
      agents: gatewayAgents, 
      defaultAgentId: status.heartbeat?.defaultAgentId 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Agent详情 ============
app.get('/api/agents/:id/info', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const config = readConfig();
    
    // 获取workspace路径
    let wsPath = path.join(WORKSPACES_DIR, `workspace-${id}`);
    const entry = (config.agents?.list || []).find(a => (typeof a === 'string' ? a : a.id) === id);
    if (typeof entry === 'object' && entry.workspace) wsPath = entry.workspace;
    
    // 读取IDENTITY.md获取显示名称
    let displayName = id;
    const identityPath = path.join(wsPath, 'IDENTITY.md');
    if (fs.existsSync(identityPath)) {
      const content = fs.readFileSync(identityPath, 'utf8');
      const match = content.match(/\*\*Name:\*\*\s*(.+)/);
      if (match) displayName = match[1].trim();
    }
    
    // 读取HEARTBEAT.md内容
    let heartbeatDoc = '';
    const heartbeatPath = path.join(wsPath, 'HEARTBEAT.md');
    if (fs.existsSync(heartbeatPath)) {
      heartbeatDoc = fs.readFileSync(heartbeatPath, 'utf8');
    }
    
    // 从sessions获取技能列表
    let skills = [];
    const sessionsPath = path.join(CONFIG_PATH, '../agents', id, 'sessions/sessions.json');
    if (fs.existsSync(sessionsPath)) {
      try {
        const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
        const firstKey = Object.keys(sessions)[0];
        if (firstKey && sessions[firstKey].skillsSnapshot?.skills) {
          skills = sessions[firstKey].skillsSnapshot.skills.map(s => s.name || s);
        }
      } catch {}
    }
    
    // 获取Discord账号信息
    let discordAccount = null;
    const discordAccounts = config.channels?.discord?.accounts || {};
    for (const [accName, acc] of Object.entries(discordAccounts)) {
      if (accName === id) {
        discordAccount = { name: accName, guilds: Object.keys(acc.guilds || {}) };
        break;
      }
    }
    
    // 获取绑定信息
    const binding = (config.bindings || []).find(b => b.agentId === id);
    
    // 获取心跳状态
    const heartbeat = (config.heartbeat?.agents || []).find(a => a.agentId === id);
    
    res.json({
      id,
      displayName,
      workspace: wsPath,
      skills,
      heartbeatDoc,
      discordAccount,
      binding,
      heartbeat: heartbeat || { enabled: false }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Agent会话 ============
app.get('/api/agents/:id/sessions', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const sessionsPath = path.join(CONFIG_PATH, '../agents', id, 'sessions/sessions.json');
    
    if (!fs.existsSync(sessionsPath)) {
      return res.json({ stores: [] });
    }
    
    const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    const stores = Object.entries(sessions).map(([key, data]) => ({
      storeKey: key,
      messageCount: data.messageCount || 0,
      lastUpdated: data.updatedAt ? new Date(data.updatedAt).toISOString() : null,
      groupId: data.groupId,
      groupChannel: data.groupChannel
    }));
    
    res.json({ stores });
  } catch (e) {
    res.json({ stores: [], error: e.message });
  }
});

app.post('/api/agents/:id/sessions/reset', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const sessionsPath = path.join(CONFIG_PATH, '../agents', id, 'sessions/sessions.json');
    if (fs.existsSync(sessionsPath)) {
      // 备份后清空
      const backupPath = sessionsPath + '.bak.' + Date.now();
      fs.copyFileSync(sessionsPath, backupPath);
      fs.writeFileSync(sessionsPath, '{}');
      res.json({ success: true, message: '会话已重置' });
    } else {
      res.json({ success: true, message: '无会话文件' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Agent心跳 ============
app.get('/api/agents/:id/heartbeat', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const config = readConfig();
    const heartbeat = (config.heartbeat?.agents || []).find(a => a.agentId === id);
    res.json(heartbeat || { agentId: id, enabled: false, every: 'disabled' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/agents/:id/heartbeat', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { enabled, every } = req.body;
    const config = readConfig();
    if (!config.heartbeat) config.heartbeat = { agents: [] };
    if (!config.heartbeat.agents) config.heartbeat.agents = [];
    
    const existing = config.heartbeat.agents.findIndex(a => a.agentId === id);
    const entry = {
      agentId: id,
      enabled: enabled === true,
      every: enabled ? (every || '30m') : 'disabled',
      everyMs: enabled ? parseInterval(every || '30m') : null
    };
    
    if (existing >= 0) {
      config.heartbeat.agents[existing] = entry;
    } else {
      config.heartbeat.agents.push(entry);
    }
    
    writeConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function parseInterval(str) {
  const match = str.match(/^(\d+)(m|h|d)$/);
  if (!match) return 1800000;
  const num = parseInt(match[1]);
  const unit = match[2];
  if (unit === 'm') return num * 60000;
  if (unit === 'h') return num * 3600000;
  if (unit === 'd') return num * 86400000;
  return 1800000;
}

// ============ Agent日志 ============
app.get('/api/agents/:id/logs', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const lines = parseInt(req.query.lines) || 100;
    
    // 日志可能在多个位置
    const logPaths = [
      path.join(CONFIG_PATH, '../logs'),  // 全局日志
      path.join(CONFIG_PATH, '../agents', id, 'logs'),  // Agent特定日志
      path.join(CONFIG_PATH, '../workspace-' + id, 'logs')  // workspace日志
    ];
    
    let logs = [];
    let logFile = null;
    
    for (const logDir of logPaths) {
      if (fs.existsSync(logDir)) {
        const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log') || f.endsWith('.jsonl')).sort().reverse();
        if (files.length > 0) {
          const latestLog = path.join(logDir, files[0]);
          const content = execSync(`tail -n ${lines} "${latestLog}"`, { encoding: 'utf8' });
          logs = content.split('\n').filter(l => l.trim());
          logFile = files[0];
          break;
        }
      }
    }
    
    if (logs.length > 0) {
      res.json({ logs, file: logFile });
    } else {
      res.json({ logs: [], message: '暂无日志文件' });
    }
  } catch (e) {
    res.json({ logs: [], error: e.message });
  }
});

// ============ Discord Channels (按Guild分组) ============
app.get('/api/discord/channels', requireAuth, (req, res) => {
  try {
    const config = readConfig();
    const bindings = config.bindings || [];
    const discordAccounts = config.channels?.discord?.accounts || {};
    
    // 辅助函数：获取Agent详情
    function getAgentDetails(agentId) {
      let displayName = agentId;
      let skills = [];
      
      let wsPath = path.join(WORKSPACES_DIR, `workspace-${agentId}`);
      const entry = (config.agents?.list || []).find(a => (typeof a === 'string' ? a : a.id) === agentId);
      if (typeof entry === 'object' && entry.workspace) wsPath = entry.workspace;
      
      const identityPath = path.join(wsPath, 'IDENTITY.md');
      if (fs.existsSync(identityPath)) {
        const content = fs.readFileSync(identityPath, 'utf8');
        const match = content.match(/\*\*Name:\*\*\s*(.+)/);
        if (match) displayName = match[1].trim();
      }
      
      const sessionsPath = path.join(CONFIG_PATH, '../agents', agentId, 'sessions/sessions.json');
      if (fs.existsSync(sessionsPath)) {
        try {
          const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
          const firstKey = Object.keys(sessions)[0];
          if (firstKey && sessions[firstKey].skillsSnapshot?.skills) {
            skills = sessions[firstKey].skillsSnapshot.skills.map(s => s.name || s);
          }
        } catch {}
      }
      
      return { displayName, skills };
    }
    
    // 按Guild分组
    const guilds = {};
    
    // 从Discord账号配置中获取Guild信息
    for (const [accName, acc] of Object.entries(discordAccounts)) {
      const accGuilds = acc.guilds || {};
      for (const [guildId, guild] of Object.entries(accGuilds)) {
        if (!guilds[guildId]) {
          guilds[guildId] = {
            guildId,
            guildName: guild.name || guildId,
            channels: {}
          };
        }
        
        // 处理该Guild下的频道
        const channels = guild.channels || {};
        for (const [channelId, channelConfig] of Object.entries(channels)) {
          if (!guilds[guildId].channels[channelId]) {
            guilds[guildId].channels[channelId] = {
              channelId,
              channelName: channelConfig.name || channelId,
              agents: []
            };
          }
          
          // 查找绑定到这个账号和guild的Agent
          const binding = bindings.find(b => 
            b.match?.accountId === accName && 
            b.match?.channel === 'discord'
          );
          
          if (binding) {
            const details = getAgentDetails(binding.agentId);
            // 避免重复添加
            if (!guilds[guildId].channels[channelId].agents.find(a => a.agentId === binding.agentId)) {
              guilds[guildId].channels[channelId].agents.push({
                agentId: binding.agentId,
                accountId: accName,
                displayName: details.displayName,
                skills: details.skills
              });
            }
          }
        }
      }
    }
    
    // 转换为数组格式
    const result = Object.values(guilds).map(g => ({
      guildId: g.guildId,
      guildName: g.guildName,
      channels: Object.values(g.channels)
    }));
    
    res.json({ guilds: result, discordEnabled: config.channels?.discord?.enabled !== false });
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