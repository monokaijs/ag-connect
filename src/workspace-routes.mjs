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

import { fetchWorkspaceQuota } from './quota.mjs';
import { SshKey } from './models/ssh-key.mjs';
import {
  gpiBootstrap,
  gpiSendMessage,
  gpiGetTrajectory,
  gpiGetAllTrajectories,
  gpiStartCascade,
  gpiCancelInvocation,
  gpiGetModels,
  gpiDiscoverModelUid,
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
      const workspace = await Workspace.findById(req.params.id).lean();
      if (!workspace) return res.status(404).json({ error: 'Not found' });
      res.json(workspace.conversation || { items: [], turnCount: 0, statusText: '' });
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
    console.log(`[Send] Message for ${req.params.id}: "${text.substring(0, 80)}"`);

    try {
      let cascadeId = workspace.gpi?.activeCascadeId;
      if (!cascadeId) {
        console.log('[Send] No active cascade, starting new one...');
        const newChat = await gpiStartCascade(workspace);
        console.log('[Send] StartCascade result:', JSON.stringify(newChat).substring(0, 300));
        if (newChat.ok && newChat.data?.cascadeId) {
          cascadeId = newChat.data.cascadeId;
          await Workspace.findByIdAndUpdate(workspace._id, {
            'gpi.activeCascadeId': cascadeId,
          });
        } else {
          return res.json({ ok: false, error: 'failed_to_create_cascade', details: newChat });
        }
      }
      console.log(`[Send] Using cascade ${cascadeId?.substring(0, 12)}`);

      let modelUid = workspace.gpi?.selectedModelUid || undefined;

      if (!modelUid) {
        try {
          const traj = await gpiGetTrajectory(workspace, cascadeId);
          if (traj.ok && traj.data) {
            const full = JSON.stringify(traj.data);
            const match = full.match(/"planModel":"([^"]+)"/);
            if (match) {
              modelUid = match[1];
              await Workspace.findByIdAndUpdate(workspace._id, {
                'gpi.selectedModelUid': modelUid,
              });
              console.log(`[Send] Model from trajectory: ${modelUid}`);
            }
          }
        } catch { }
      }

      const result = await gpiSendMessage(workspace, cascadeId, text, modelUid);
      console.log(`[Send] Result:`, JSON.stringify(result).substring(0, 500));
      const error = result?.data?.message || result?.error || undefined;
      res.json({ ok: result.ok, error, results: [{ value: { ok: result.ok, method: 'gpi' } }] });
    } catch (err) {
      console.error(`[Send] Error:`, err.message);
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
      const gpiResult = await gpiGetModels(workspace);
      let current = workspace.gpi?.selectedModel || '';

      if (gpiResult.ok && gpiResult.models?.length) {
        if (!current) {
          const first = gpiResult.models[0];
          current = first.label;
          const update = { 'gpi.selectedModel': current };
          if (first.modelUid) update['gpi.selectedModelUid'] = first.modelUid;
          await Workspace.findByIdAndUpdate(workspace._id, update);
        }
        const models = gpiResult.models.map(m => ({
          label: m.label,
          modelUid: m.modelUid || '',
          selected: m.label === current,
          isPremium: m.isPremium,
          isBeta: m.isBeta,
          isNew: m.isNew,
          supportsImages: m.supportsImages,
        }));
        return res.json({ ok: true, results: [{ value: { ok: true, current, models } }] });
      }

      const result = await wsEval(workspace, `(() => {
        const btn = document.querySelector('span.min-w-0.select-none.overflow-hidden.text-ellipsis.whitespace-nowrap.text-xs.opacity-70');
        const container = btn ? btn.closest('button, div[class*="cursor-"]') : null;
        if (container) container.click();
        return new Promise(resolve => {
          setTimeout(() => {
            const optionSpans = Array.from(document.querySelectorAll('span, div')).filter(s => {
              if (s.children.length > 0) return false;
              const t = s.textContent.trim();
              return ['Claude', 'Gemini', 'GPT', 'Opus', 'Sonnet', 'Flash', 'Haiku', 'o1', 'o3', 'o4'].some(p => t.includes(p)) && t.length < 50;
            });
            const allModels = optionSpans.map(s => s.textContent.trim()).filter((m, i, arr) => arr.indexOf(m) === i);
            if (container) document.body.click();
            resolve({ models: allModels });
          }, 300);
        });
      })()`, { target: 'workbench' });
      const scraped = result?.results?.[0]?.value || result;
      const allScraped = scraped?.models || [];
      if (!current && allScraped.length) {
        current = allScraped[0];
        await Workspace.findByIdAndUpdate(workspace._id, { 'gpi.selectedModel': current });
      }
      const models = allScraped.map(m => ({
        label: m,
        modelUid: '',
        selected: m === current,
      }));
      res.json({ ok: true, results: [{ value: { ok: true, current, models } }] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/models/select', async (req, res) => {
    const { model, modelUid } = req.body;
    if (!model) return res.status(400).json({ ok: false, error: 'missing model' });
    try {
      const update = { 'gpi.selectedModel': model };
      if (modelUid) update['gpi.selectedModelUid'] = modelUid;
      await Workspace.findByIdAndUpdate(req.params.id, update);
      res.json({ ok: true, results: [{ value: { ok: true, selected: model, modelUid: modelUid || '' } }] });
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
    try {
      const workspace = await Workspace.findById(req.params.id).lean();
      if (!workspace) return res.status(404).json({ error: 'Not found' });
      res.json(workspace.conversation || { items: [], turnCount: 0, statusText: '' });
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
  app.post('/api/workspaces/:id/git/clone', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace || !workspace.containerId) return res.status(404).json({ error: 'Workspace not found or not running' });

    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    const httpsMatch = url.match(/^https?:\/\/(github\.com|gitlab\.com)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
      url = `git@${httpsMatch[1]}:${httpsMatch[2]}.git`;
    }

    try {
      const sshKeys = await SshKey.find();
      if (sshKeys.length > 0) {
        await execInContainer(workspace.containerId, 'mkdir -p /home/aguser/.ssh && chmod 700 /home/aguser/.ssh');
        for (const key of sshKeys) {
          const safeName = key.name.replace(/[^a-zA-Z0-9_-]/g, '_');
          const escaped = key.privateKey.replace(/'/g, "'\\''");
          await execInContainer(workspace.containerId, `printf '%s\\n' '${escaped}' > /home/aguser/.ssh/${safeName} && chmod 600 /home/aguser/.ssh/${safeName}`);
          if (key.publicKey) {
            const escapedPub = key.publicKey.replace(/'/g, "'\\''");
            await execInContainer(workspace.containerId, `printf '%s\\n' '${escapedPub}' > /home/aguser/.ssh/${safeName}.pub && chmod 644 /home/aguser/.ssh/${safeName}.pub`);
          }
        }
        await execInContainer(workspace.containerId, 'ssh-keyscan -H github.com gitlab.com >> /home/aguser/.ssh/known_hosts 2>/dev/null; chmod 644 /home/aguser/.ssh/known_hosts');
        if (sshKeys.length === 1) {
          const safeName = sshKeys[0].name.replace(/[^a-zA-Z0-9_-]/g, '_');
          await execInContainer(workspace.containerId, `cp /home/aguser/.ssh/${safeName} /home/aguser/.ssh/id_rsa && chmod 600 /home/aguser/.ssh/id_rsa`);
        }
      }

      const cloneDir = workspace.mountedPath ? '/workspace' : '/home/aguser';
      const result = await execInContainer(workspace.containerId, `cd ${cloneDir} && GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no' git clone ${JSON.stringify(url)} 2>&1`);
      res.json({ ok: true, output: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

export { setupWorkspaceRoutes };
