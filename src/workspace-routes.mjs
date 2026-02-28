import { Workspace } from './models/workspace.mjs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  createWorkspaceContainer,
  stopWorkspaceContainer,
  removeWorkspaceContainer,
  startWorkspaceContainer,
  execInContainer,
} from './docker-manager.mjs';
import { cdpEvalOnPort, findTargetOnPort, getTargetsOnPort } from './workspace-cdp.mjs';
import { getChatState } from './conversation-monitor.mjs';
import { fetchWorkspaceQuota } from './quota.mjs';
import {
  gpiBootstrap,
  gpiSendMessage,
  gpiGetTrajectory,
  gpiGetAllTrajectories,
  gpiStartCascade,
  gpiCancelInvocation,
  gpiGetModels,
  trajectoryToConversation,
} from './gpi.mjs';

const HOST_BASE = process.env.HOST_BASE_PATH || '';
const HOST_MOUNT = process.env.HOST_MOUNT_POINT || '';

function toLocalPath(hostPath) {
  if (!HOST_BASE || !HOST_MOUNT || !hostPath) return hostPath;
  if (hostPath.startsWith(HOST_BASE)) {
    return HOST_MOUNT + hostPath.slice(HOST_BASE.length);
  }
  return hostPath;
}

async function wsEval(workspace, expression, opts = {}) {
  const port = workspace.cdpPort || workspace.ports?.debug;
  if (!port) throw new Error('No debug port');
  return cdpEvalOnPort(port, expression, { ...opts, host: workspace.cdpHost });
}

function setupWorkspaceRoutes(app, broadcast) {
  app.get('/api/system/ls', async (req, res) => {
    try {
      const defaultPath = HOST_BASE ? HOST_BASE : os.homedir();
      let hostPath = req.query.path || defaultPath;
      if (hostPath.startsWith('~')) {
        hostPath = path.join(defaultPath, hostPath.slice(1));
      }

      const localPath = toLocalPath(hostPath);
      const stat = await fs.stat(localPath);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Not a directory' });
      }

      const entries = await fs.readdir(localPath, { withFileTypes: true });
      const folders = [];

      if (path.dirname(hostPath) !== hostPath) {
        folders.push({
          name: '..',
          path: path.dirname(hostPath),
        });
      }

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          folders.push({
            name: entry.name,
            path: path.join(hostPath, entry.name),
          });
        }
      }

      folders.sort((a, b) => {
        if (a.name === '..') return -1;
        if (b.name === '..') return 1;
        return a.name.localeCompare(b.name);
      });

      res.json({ path: hostPath, folders });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces', async (req, res) => {
    const workspaces = await Workspace.find().sort({ createdAt: -1 });
    res.json(workspaces);
  });

  app.post('/api/workspaces', async (req, res) => {
    const { name, mountedPath, icon, color } = req.body || {};
    const workspace = new Workspace({
      name: name || `Workspace ${Date.now().toString(36)}`,
      mountedPath: mountedPath || '',
      icon: icon ?? -1,
      color: color ?? 0,
      status: 'creating',
    });
    await workspace.save();
    broadcast({ event: 'workspace:created', payload: workspace.toJSON() });
    res.json(workspace);
    createWorkspaceContainer(workspace, broadcast);
  });

  app.get('/api/workspaces/:id', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    res.json(workspace);
  });

  app.delete('/api/workspaces/:id', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    await removeWorkspaceContainer(workspace);
    await Workspace.findByIdAndDelete(req.params.id);
    broadcast({ event: 'workspace:deleted', payload: { id: req.params.id } });
    res.json({ ok: true });
  });

  app.put('/api/workspaces/:id', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });

    let requireRestart = false;
    if (req.body.name !== undefined) workspace.name = req.body.name;
    if (req.body.icon !== undefined) workspace.icon = req.body.icon;
    if (req.body.color !== undefined) workspace.color = req.body.color;
    if (req.body.mountedPath !== undefined) {
      if (workspace.mountedPath !== req.body.mountedPath) {
        requireRestart = true;
      }
      workspace.mountedPath = req.body.mountedPath;
    }

    await workspace.save();
    broadcast({ event: 'workspace:updated', payload: workspace.toJSON() });
    res.json(workspace);

    if (requireRestart && workspace.status === 'running') {
      broadcast({ event: 'workspace:status', payload: { id: workspace._id, status: 'initializing', stage: 'Re-mounting', message: 'Applying new mount path...' } });
      setTimeout(async () => {
        try {
          await startWorkspaceContainer(workspace, broadcast);
        } catch (e) { console.error(e); }
      }, 0);
    }
  });

  app.get('/api/workspaces/:id/fs/list', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace || !workspace.mountedPath) return res.json([]);
      const base = toLocalPath(workspace.mountedPath);
      const sub = req.query.path || '';
      const target = path.join(base, sub);
      if (!target.startsWith(base)) return res.status(403).json({ error: 'Out of bounds' });

      const stats = await fs.stat(target).catch(() => null);
      if (!stats || !stats.isDirectory()) return res.json([]);

      const dirents = await fs.readdir(target, { withFileTypes: true });
      const items = dirents.map(d => ({
        name: d.name,
        type: d.isDirectory() ? 'directory' : 'file',
        path: path.join(sub, d.name),
      }));
      res.json(items.sort((a, b) => (b.type === 'directory') - (a.type === 'directory') || a.name.localeCompare(b.name)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/fs/read', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace || !workspace.mountedPath) return res.status(404).json({ error: 'No mount' });
      const base = toLocalPath(workspace.mountedPath);
      const sub = req.query.path;
      if (!sub) return res.status(400).json({ error: 'Path required' });
      const target = path.join(base, sub);
      if (!target.startsWith(base)) return res.status(403).json({ error: 'Out of bounds' });

      const content = await fs.readFile(target, 'utf8');
      res.json({ content });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/fs/write', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace || !workspace.mountedPath) return res.status(404).json({ error: 'No mount' });
      const base = toLocalPath(workspace.mountedPath);
      const sub = req.body.path;
      const content = req.body.content;
      if (!sub || content === undefined) return res.status(400).json({ error: 'Path and content required' });
      const target = path.join(base, sub);
      if (!target.startsWith(base)) return res.status(403).json({ error: 'Out of bounds' });

      await fs.writeFile(target, content, 'utf8');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/fs/delete', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace || !workspace.mountedPath) return res.status(404).json({ error: 'No mount' });
      const base = toLocalPath(workspace.mountedPath);
      const sub = req.body.path;
      if (!sub) return res.status(400).json({ error: 'Path required' });
      const target = path.join(base, sub);
      if (!target.startsWith(base) || target === base) return res.status(403).json({ error: 'Out of bounds' });
      await fs.rm(target, { recursive: true, force: true });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/stop', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    await stopWorkspaceContainer(workspace);
    broadcast({ event: 'workspace:status', payload: { id: req.params.id, status: 'stopped', stage: '', message: 'Stopped' } });
    res.json({ ok: true });
  });

  app.post('/api/workspaces/:id/start', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
    startWorkspaceContainer(workspace, broadcast);
  });

  app.get('/api/workspaces/:id/cdp/chat', async (req, res) => {
    try {
      res.json(getChatState(req.params.id));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/cdp/targets', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      const port = workspace?.cdpPort || workspace?.ports?.debug;
      if (!workspace || !port) return res.json([]);
      const targets = await getTargetsOnPort(port, workspace.cdpHost);
      res.json(targets.filter(t => t.type === 'page' || t.type === 'app'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/targets/close', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      const port = workspace?.cdpPort || workspace?.ports?.debug;
      const host = workspace?.cdpHost || '127.0.0.1';
      if (!workspace || !port) return res.json({ ok: false });

      const { targetId } = req.body;
      if (!targetId) return res.status(400).json({ error: 'targetId required' });

      const httpMod = await import('http');
      await new Promise((resolve, reject) => {
        const r = httpMod.get(`http://${host}:${port}/json/close/${targetId}`, (response) => {
          response.on('data', () => { });
          response.on('end', resolve);
        });
        r.on('error', reject);
      });

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/restart', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
    broadcast({ event: 'workspace:status', payload: { id: req.params.id, status: 'initializing', stage: 'Restarting', message: 'Restarting container...' } });
    await stopWorkspaceContainer(workspace);
    startWorkspaceContainer(workspace, broadcast);
  });

  app.post('/api/workspaces/:id/clear-auth', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    workspace.auth = {};
    workspace.status = 'needsLogin';
    await workspace.save();
    broadcast({ event: 'workspace:status', payload: { id: req.params.id, status: 'needsLogin', stage: '', message: '' } });
    broadcast({ event: 'workspace:auth', payload: { id: req.params.id, email: null } });
    res.json({ ok: true });
  });

  app.get('/api/workspaces/:id/logs', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    res.json({ logs: workspace.initLogs });
  });

  app.post('/api/workspaces/:id/gpi/bootstrap', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace) return res.status(404).json({ error: 'Not found' });
      const result = await gpiBootstrap(workspace);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/send', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    const text = req.body.text;
    if (!text) return res.status(400).json({ ok: false, error: 'missing text' });

    try {
      let cascadeId = workspace.gpi?.activeCascadeId;
      if (!cascadeId) {
        const newChat = await gpiStartCascade(workspace);
        if (newChat.ok && newChat.data?.cascadeId) {
          cascadeId = newChat.data.cascadeId;
          await Workspace.findByIdAndUpdate(workspace._id, {
            'gpi.activeCascadeId': cascadeId,
          });
        } else {
          return res.json({ ok: false, error: 'failed_to_create_cascade', details: newChat });
        }
      }

      const result = await gpiSendMessage(workspace, cascadeId, text);
      res.json({ ok: result.ok, results: [{ value: { ok: result.ok, method: 'gpi' } }] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/stop', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    try {
      const cascadeId = workspace.gpi?.activeCascadeId;
      if (!cascadeId) return res.json({ ok: false, error: 'no_cascade' });
      const result = await gpiCancelInvocation(workspace, cascadeId);
      res.json({ ok: result.ok, results: [{ value: { ok: result.ok } }] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/cdp/models', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    try {
      const result = await gpiGetModels(workspace);
      if (result.ok) {
        const current = workspace.gpi?.selectedModel || '';
        res.json({ ok: true, results: [{ value: { ok: true, current, models: result.models } }] });
      } else {
        res.json(result);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/models/select', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    const { model } = req.body;
    if (!model) return res.status(400).json({ ok: false, error: 'missing model' });
    try {
      const models = await gpiGetModels(workspace);
      const found = models.models?.find(m => m.label === model);
      if (!found) return res.json({ ok: false, error: 'model_not_found', available: models.models?.map(m => m.label) });
      await Workspace.findByIdAndUpdate(workspace._id, {
        'gpi.selectedModel': model,
        'gpi.selectedModelAlias': found.modelOrAlias,
      });
      res.json({ ok: true, results: [{ value: { ok: true, selected: model } }] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/accept-all', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    try {
      const result = await wsEval(workspace, `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent && b.textContent.includes('Accept all') && b.offsetParent !== null);
        if (!btn) return { ok: false, error: 'not_found' };
        btn.click();
        return { ok: true };
      })()`, { target: 'workbench' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/reject-all', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    try {
      const result = await wsEval(workspace, `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent && b.textContent.includes('Reject all') && b.offsetParent !== null);
        if (!btn) return { ok: false, error: 'not_found' };
        btn.click();
        return { ok: true };
      })()`, { target: 'workbench' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/new-chat', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    try {
      const result = await gpiStartCascade(workspace);
      if (result.ok && result.data?.cascadeId) {
        await Workspace.findByIdAndUpdate(workspace._id, {
          'gpi.activeCascadeId': result.data.cascadeId,
        });
      }
      res.json({ ok: result.ok, results: [{ value: { ok: result.ok, cascadeId: result.data?.cascadeId } }] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/cdp/conversations', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    try {
      const result = await gpiGetAllTrajectories(workspace);
      if (!result.ok) return res.json({ ok: false, error: 'failed', details: result });

      const summaries = result.data?.trajectorySummaries || {};
      const groups = [{ label: 'All Conversations', items: [] }];

      for (const [cascadeId, traj] of Object.entries(summaries)) {
        const title = traj.summary || cascadeId;
        const active = cascadeId === workspace.gpi?.activeCascadeId;
        const time = traj.lastModifiedTime || traj.createdTime || '';
        groups[0].items.push({ title, time, active, cascadeId });
      }

      groups[0].items.sort((a, b) => (b.time || '').localeCompare(a.time || ''));

      res.json({ ok: true, results: [{ value: { ok: true, groups } }] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/conversations/select', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    const { title, cascadeId } = req.body;
    try {
      let targetCascadeId = cascadeId;

      if (!targetCascadeId && title) {
        const result = await gpiGetAllTrajectories(workspace);
        if (result.ok) {
          const summaries = result.data?.trajectorySummaries || {};
          for (const [cid, traj] of Object.entries(summaries)) {
            if ((traj.summary || '') === title) {
              targetCascadeId = cid;
              break;
            }
          }
        }
      }

      if (!targetCascadeId) return res.json({ ok: false, error: 'conversation_not_found' });

      await Workspace.findByIdAndUpdate(workspace._id, {
        'gpi.activeCascadeId': targetCascadeId,
      });

      res.json({ ok: true, results: [{ value: { ok: true, selected: title || targetCascadeId } }] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/cdp/conversation', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    try {
      const cascadeId = workspace.gpi?.activeCascadeId;
      if (!cascadeId) return res.json({ turnCount: 0, items: [], statusText: '' });

      const result = await gpiGetTrajectory(workspace, cascadeId);
      if (!result.ok) return res.json({ turnCount: 0, items: [], statusText: '' });

      const data = trajectoryToConversation(result.data);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/cdp/screenshot', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    if (!workspace.ports?.debug) return res.status(400).json({ error: 'No debug port' });

    try {
      const target = await findTargetOnPort(workspace.ports.debug, 'workbench');
      if (!target) return res.status(404).json({ error: 'cdp_not_found' });

      const { WebSocket } = await import('ws');
      const ws = new WebSocket(target.wsUrl);

      const screenshot = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          ws.close();
          reject(new Error('screenshot_timeout'));
        }, 10000);

        ws.on('open', () => {
          ws.send(JSON.stringify({
            id: 1,
            method: 'Page.captureScreenshot',
            params: { format: 'png', quality: 80 },
          }));
        });

        ws.on('message', (raw) => {
          try {
            const data = JSON.parse(raw.toString());
            if (data.id === 1) {
              clearTimeout(timeoutId);
              ws.close();
              if (data.error) reject(new Error(data.error.message));
              else resolve(data.result.data);
            }
          } catch { }
        });

        ws.on('error', (err) => {
          clearTimeout(timeoutId);
          reject(err);
        });
      });

      res.json({ ok: true, data: `data:image/png;base64,${screenshot}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/cdp/status', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    if (!workspace.ports?.debug) return res.json({ connected: false });
    try {
      const target = await findTargetOnPort(workspace.ports.debug);
      res.json({ connected: !!target, target: target?.target?.title || null });
    } catch {
      res.json({ connected: false });
    }
  });

  const quotaCache = new Map();
  const QUOTA_CACHE_TTL = 10000;

  async function getQuotaCached(workspace) {
    const id = workspace._id.toString();
    const cached = quotaCache.get(id);
    if (cached && Date.now() - cached.ts < QUOTA_CACHE_TTL) {
      return cached.data;
    }
    const quota = await fetchWorkspaceQuota(workspace);
    if (quota) {
      quotaCache.set(id, { data: quota, ts: Date.now() });
      if (workspace.auth) {
        await Workspace.findByIdAndUpdate(workspace._id, {
          'auth.accessToken': workspace.auth.accessToken,
          'auth.expiryTimestamp': workspace.auth.expiryTimestamp,
        });
      }
    }
    return quota;
  }

  app.get('/api/workspaces/:id/quota', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace) return res.status(404).json({ error: 'Not found' });
      const quota = await getQuotaCached(workspace);
      if (!quota) return res.json({ ok: false, error: 'no_auth' });
      res.json({ ok: true, ...quota });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  async function pollQuotas() {
    try {
      const workspaces = await Workspace.find({ status: 'running' });
      for (const workspace of workspaces) {
        if (!workspace.auth?.accessToken) continue;
        try {
          const quota = await getQuotaCached(workspace);
          if (quota) {
            broadcast({
              event: 'workspace:quota',
              payload: { id: workspace._id.toString(), ...quota },
            });
          }
        } catch { }
      }
    } catch { }
  }

  setInterval(pollQuotas, 30000);
  setTimeout(pollQuotas, 5000);

  app.get('/api/workspaces/:id/file', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    try {
      const result = await execInContainer(workspace.containerId, `cat ${JSON.stringify(filePath)}`);
      res.json({ ok: true, content: result, path: filePath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

export { setupWorkspaceRoutes };
