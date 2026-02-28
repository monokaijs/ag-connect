import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { networkInterfaces } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './db.mjs';
import { Workspace } from './models/workspace.mjs';
import { setupWorkspaceRoutes } from './workspace-routes.mjs';
import { setupOAuthRoutes } from './oauth.mjs';
import { startConversationMonitor } from './conversation-monitor.mjs';
import { vncWss } from './vnc.mjs';
import { terminalWss } from './terminal.mjs';
import { startHealthChecker } from './health-checker.mjs';
import { setupGitRoutes } from './git-routes.mjs';
import { setupSettingsRoutes } from './settings-routes.mjs';
import { setupAuthRoutes, requireAuth, verifyWsToken } from './auth.mjs';
import { setupPushRoutes, tryInitFromDb } from './push.mjs';
import { cliWss, setBroadcast } from './cli-ws.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
};

const PORT = parseInt(getArg('--port') || process.env.PORT || '8787');
const HOST = getArg('--host') || '0.0.0.0';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'web', 'dist')));
app.use(express.static(join(__dirname, '..', 'public')));

function getLocalIPs() {
  const nets = networkInterfaces();
  const results = new Set();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('100.')) {
        results.add(net.address);
      }
    }
  }
  return Array.from(results);
}

async function authenticateWsUpgrade(request) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token');
  const user = await verifyWsToken(token);
  return user;
}

server.on('upgrade', async (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  const user = await authenticateWsUpgrade(request);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  if (pathname === '/ws' || pathname === '/api/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.user = user;
      wss.emit('connection', ws, request);
    });
  } else if (pathname.startsWith('/api/workspaces/') && pathname.endsWith('/cdp/vnc')) {
    vncWss.handleUpgrade(request, socket, head, (ws) => {
      vncWss.emit('connection', ws, request);
    });
  } else if (pathname.startsWith('/api/workspaces/') && pathname.endsWith('/terminal')) {
    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      terminalWss.emit('connection', ws, request);
    });
  } else if (pathname === '/api/cli-ws') {
    cliWss.handleUpgrade(request, socket, head, (ws) => {
      cliWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', async (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ event: 'hello', payload: { ts: new Date().toISOString() } }));
  try {
    const workspaces = await Workspace.find().sort({ createdAt: -1 });
    ws.send(JSON.stringify({ event: 'workspace:list', payload: workspaces }));
  } catch { }
});

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

setBroadcast(broadcast);

await connectDB();

setupAuthRoutes(app);

app.use('/api/workspaces', requireAuth);
app.use('/api/settings', requireAuth);
app.use('/api/oauth', requireAuth);
app.use('/api/system', requireAuth);

setupWorkspaceRoutes(app, broadcast);
setupOAuthRoutes(app, broadcast);
setupGitRoutes(app);
setupSettingsRoutes(app);
startConversationMonitor(broadcast);
startHealthChecker(broadcast);
setupPushRoutes(app);
tryInitFromDb();

app.get('/health', (req, res) => {
  res.json({ ok: true, version: '2.0.0' });
});

app.get('{*path}', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(join(__dirname, '..', 'web', 'dist', 'index.html'));
});

server.listen(PORT, HOST, () => {
  const ips = getLocalIPs();
  console.log('');
  console.log('='.repeat(50));
  console.log(' AG Connect v2.0.0 — Multi-Workspace');
  console.log('='.repeat(50));
  console.log(' Endpoints:');
  if (ips.length > 0) {
    ips.forEach(ip => console.log(`   http://${ip}:${PORT}`));
  } else {
    console.log('   http://localhost:' + PORT);
  }
  console.log('-'.repeat(50));
  console.log(' API:');
  console.log('   GET    /api/auth/status');
  console.log('   POST   /api/auth/setup');
  console.log('   POST   /api/auth/login');
  console.log('   GET    /api/workspaces');
  console.log('   POST   /api/workspaces');
  console.log('   WS     /ws?token=JWT');
  console.log('='.repeat(50));
  console.log('');
});

export { app, server, wss };
