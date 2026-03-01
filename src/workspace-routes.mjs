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
import {
  createCliWorkspace,
  stopCliWorkspace,
  removeCliWorkspace,
  startCliWorkspace,
} from './cli-manager.mjs';
import { cdpEvalOnPort, findTargetOnPort, getTargetsOnPort } from './workspace-cdp.mjs';
import { cliCdpEval, cliGetTargets, cliCdpScreenshot, cliExec } from './cli-ws.mjs';

import { fetchWorkspaceQuota } from './quota.mjs';
import { SshKey } from './models/ssh-key.mjs';
import { getSettings } from './models/settings.mjs';
import {
  gpiBootstrap,
  gpiSendMessage,
  gpiGetTrajectory,
  gpiGetAllTrajectories,
  gpiStartCascade,
  gpiCancelInvocation,
  trajectoryToConversation,
} from './gpi.mjs';
import { MODELS, getCachedQuota, setCachedQuota, getAllCachedQuotas } from './config.mjs';

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
  // CLI workspaces: proxy through the CLI client WebSocket
  if (workspace.type === 'cli') {
    const result = await cliCdpEval(workspace._id.toString(), expression, opts);
    return result;
  }
  // Docker workspaces: connect directly to CDP port
  const port = workspace.cdpPort || workspace.ports?.debug;
  if (!port) throw new Error('No debug port');
  return cdpEvalOnPort(port, expression, { ...opts, host: workspace.cdpHost });
}

function setupWorkspaceRoutes(app, broadcast) {
  app.get('/api/system/ls', async (req, res) => {
    try {
      const settings = await getSettings();
      const isDocker = !!(HOST_BASE && HOST_MOUNT);
      const globalMount = isDocker ? (settings.hostMountPath || '') : '';
      const defaultPath = globalMount || (HOST_BASE ? HOST_BASE : os.homedir());
      let hostPath = req.query.path || defaultPath;
      if (hostPath.startsWith('~')) {
        hostPath = path.join(defaultPath, hostPath.slice(1));
      }

      if (globalMount && !hostPath.startsWith(globalMount)) {
        hostPath = globalMount;
      }

      const localPath = toLocalPath(hostPath);
      const stat = await fs.stat(localPath);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Not a directory' });
      }

      const entries = await fs.readdir(localPath, { withFileTypes: true });
      const folders = [];

      const canGoUp = path.dirname(hostPath) !== hostPath && (!globalMount || path.dirname(hostPath).startsWith(globalMount));
      if (canGoUp) {
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

      res.json({ path: hostPath, folders, hostMountPath: globalMount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/ls', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace) return res.status(404).json({ error: 'Not found' });

      if (workspace.type === 'cli') {
        const targetPath = req.query.path || '';
        const b64 = targetPath ? Buffer.from(targetPath).toString('base64') : '';
        const pathExpr = b64 ? `Buffer.from('${b64}','base64').toString()` : `require('os').homedir()`;
        const script = `node -e "var p=require('path'),fs=require('fs'),t=${pathExpr};if(!fs.statSync(t).isDirectory()){process.exit(1)}var e=fs.readdirSync(t,{withFileTypes:true});var d=p.dirname(t);var r={path:t,folders:[]};if(d!==t)r.folders.push({name:'..',path:d});e.forEach(function(x){if(x.isDirectory()&&!x.name.startsWith('.'))r.folders.push({name:x.name,path:p.join(t,x.name)})});r.folders.sort(function(a,b){return a.name==='..'?-1:b.name==='..'?1:a.name.localeCompare(b.name)});console.log(JSON.stringify(r))"`;
        const output = await cliExec(workspace._id.toString(), script, 10000);
        const data = JSON.parse(output.trim());
        return res.json(data);
      }

      const settings = await getSettings();
      const globalMount = settings.hostMountPath || '';
      const defaultPath = globalMount || (HOST_BASE ? HOST_BASE : os.homedir());
      let hostPath = req.query.path || defaultPath;
      if (hostPath.startsWith('~')) {
        hostPath = path.join(defaultPath, hostPath.slice(1));
      }
      if (globalMount && !hostPath.startsWith(globalMount)) {
        hostPath = globalMount;
      }
      const localPath = toLocalPath(hostPath);
      const stat = await fs.stat(localPath);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Not a directory' });
      }
      const entries = await fs.readdir(localPath, { withFileTypes: true });
      const folders = [];
      const canGoUp = path.dirname(hostPath) !== hostPath && (!globalMount || path.dirname(hostPath).startsWith(globalMount));
      if (canGoUp) {
        folders.push({ name: '..', path: path.dirname(hostPath) });
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          folders.push({ name: entry.name, path: path.join(hostPath, entry.name) });
        }
      }
      folders.sort((a, b) => {
        if (a.name === '..') return -1;
        if (b.name === '..') return 1;
        return a.name.localeCompare(b.name);
      });
      res.json({ path: hostPath, folders, hostMountPath: globalMount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces', async (req, res) => {
    const workspaces = await Workspace.find().sort({ createdAt: -1 });
    res.json(workspaces);
  });

  app.post('/api/workspaces', async (req, res) => {
    const { name, mountedPath, icon, color, type } = req.body || {};
    const wsType = type === 'cli' ? 'cli' : 'docker';
    const workspace = new Workspace({
      name: name || `Workspace ${Date.now().toString(36)}`,
      type: wsType,
      mountedPath: mountedPath || '',
      icon: icon ?? -1,
      color: color ?? 0,
      status: 'creating',
    });
    await workspace.save();
    broadcast({ event: 'workspace:created', payload: workspace.toJSON() });
    res.json(workspace);
    if (wsType === 'cli') {
      createCliWorkspace(workspace, broadcast);
    } else {
      createWorkspaceContainer(workspace, broadcast);
    }
  });

  app.get('/api/workspaces/:id', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    res.json(workspace);
  });

  app.delete('/api/workspaces/:id', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    if (workspace.type === 'cli') {
      await removeCliWorkspace(workspace);
    } else {
      await removeWorkspaceContainer(workspace);
    }
    await Workspace.findByIdAndDelete(req.params.id);
    broadcast({ event: 'workspace:deleted', payload: { id: req.params.id } });
    res.json({ ok: true });
  });

  app.put('/api/workspaces/:id', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });

    if (req.body.name !== undefined) workspace.name = req.body.name;
    if (req.body.icon !== undefined) workspace.icon = req.body.icon;
    if (req.body.color !== undefined) workspace.color = req.body.color;
    if (req.body.mountedPath !== undefined) workspace.mountedPath = req.body.mountedPath;

    await workspace.save();
    broadcast({ event: 'workspace:updated', payload: workspace.toJSON() });
    res.json(workspace);
  });

  app.get('/api/workspaces/:id/fs/list', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace) return res.json([]);
      const sub = req.query.path || '';

      const mountPath = workspace.mountedPath || (await getSettings()).hostMountPath || '';
      if (mountPath) {
        const base = toLocalPath(mountPath);
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
        return res.json(items.sort((a, b) => (b.type === 'directory') - (a.type === 'directory') || a.name.localeCompare(b.name)));
      }

      if (!workspace.containerId) return res.json([]);
      const wsDir = '/workspace';
      const target = sub ? `${wsDir}/${sub}` : wsDir;
      const raw = await execInContainer(workspace.containerId, `ls -1paL ${JSON.stringify(target)} 2>/dev/null || true`);
      const items = raw.split('\n').filter(l => l && l !== './' && l !== '../').map(l => {
        const isDir = l.endsWith('/');
        const name = isDir ? l.slice(0, -1) : l;
        return { name, type: isDir ? 'directory' : 'file', path: sub ? `${sub}/${name}` : name };
      }).filter(i => i.name && !i.name.startsWith('.config'));
      res.json(items.sort((a, b) => (b.type === 'directory') - (a.type === 'directory') || a.name.localeCompare(b.name)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/fs/read', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace) return res.status(404).json({ error: 'Not found' });
      const mountPath = workspace.mountedPath || (await getSettings()).hostMountPath || '';
      if (!mountPath) return res.status(404).json({ error: 'No mount' });
      const base = toLocalPath(mountPath);
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
      if (!workspace) return res.status(404).json({ error: 'Not found' });
      const mountPath = workspace.mountedPath || (await getSettings()).hostMountPath || '';
      if (!mountPath) return res.status(404).json({ error: 'No mount' });
      const base = toLocalPath(mountPath);
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
      if (!workspace) return res.status(404).json({ error: 'Not found' });
      const mountPath = workspace.mountedPath || (await getSettings()).hostMountPath || '';
      if (!mountPath) return res.status(404).json({ error: 'No mount' });
      const base = toLocalPath(mountPath);
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
    if (workspace.type === 'cli') {
      await stopCliWorkspace(workspace);
    } else {
      await stopWorkspaceContainer(workspace);
    }
    broadcast({ event: 'workspace:status', payload: { id: req.params.id, status: 'stopped', stage: '', message: 'Stopped' } });
    res.json({ ok: true });
  });

  app.post('/api/workspaces/:id/start', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
    if (workspace.type === 'cli') {
      startCliWorkspace(workspace, broadcast);
    } else {
      startWorkspaceContainer(workspace, broadcast);
    }
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
      const { id } = req.params;
      const workspace = await Workspace.findById(id);
      if (!workspace) return res.json([]);

      if (workspace.type === 'cli') {
        const targets = await cliGetTargets(id);
        return res.json(targets.filter(t => t.type === 'page' || t.type === 'app'));
      }

      const port = workspace.cdpPort || workspace.ports?.debug;
      if (!port) return res.json([]);
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
    broadcast({ event: 'workspace:status', payload: { id: req.params.id, status: 'initializing', stage: 'Restarting', message: 'Restarting...' } });
    if (workspace.type === 'cli') {
      await stopCliWorkspace(workspace);
      startCliWorkspace(workspace, broadcast);
    } else {
      await stopWorkspaceContainer(workspace);
      startWorkspaceContainer(workspace, broadcast);
    }
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
    const targetId = req.body.targetId;
    const modelUid = req.body.modelUid;
    if (!text) return res.status(400).json({ ok: false, error: 'missing text' });
    console.log(`[Send] Message for ${req.params.id} target=${targetId || 'global'}: "${text.substring(0, 80)}"`);

    try {
      let cascadeId = targetId
        ? workspace.targetCascades?.get(targetId)
        : workspace.gpi?.activeCascadeId;

      if (!cascadeId) {
        console.log(`[Send] No active cascade, starting new one...`);
        const newChat = await gpiStartCascade(workspace, modelUid || workspace.gpi?.selectedModelUid, targetId);
        console.log('[Send] StartCascade result:', JSON.stringify(newChat).substring(0, 300));
        if (newChat.ok && newChat.data?.cascadeId) {
          cascadeId = newChat.data.cascadeId;
          const update = { 'gpi.activeCascadeId': cascadeId };
          if (targetId) update[`targetCascades.${targetId}`] = cascadeId;
          await Workspace.findByIdAndUpdate(workspace._id, update);
        } else {
          return res.json({ ok: false, error: 'failed_to_create_cascade', details: newChat });
        }
      }
      console.log(`[Send] Using cascade ${cascadeId?.substring(0, 12)}`);

      const result = await gpiSendMessage(workspace, cascadeId, text, modelUid || workspace.gpi?.selectedModelUid, targetId);
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
    const current = workspace.gpi?.selectedModel || MODELS[0].label;
    const models = MODELS.map(m => ({
      ...m,
      selected: m.label === current,
    }));
    res.json({ ok: true, results: [{ value: { ok: true, current, models } }] });
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
    const { targetId, modelUid } = req.body;
    try {
      const result = await gpiStartCascade(workspace, modelUid || workspace.gpi?.selectedModelUid, targetId);
      if (result.ok && result.data?.cascadeId) {
        const update = {
          'gpi.activeCascadeId': result.data.cascadeId,
          conversation: { items: [], turnCount: 0, statusText: '' },
        };
        if (targetId) {
          update[`targetCascades.${targetId}`] = result.data.cascadeId;
          update[`targetConversations.${targetId}`] = { items: [], turnCount: 0, statusText: '' };
        }
        await Workspace.findByIdAndUpdate(workspace._id, update);
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
      let folderFilter = req.query.folder || '';

      if (!folderFilter) {
        try {
          const expr = '(function(){try{return vscode.process.env.PWD||""}catch(e){return ""}})()';
          let evalResult;
          if (workspace.type === 'cli') {
            evalResult = await cliCdpEval(workspace._id.toString(), expr, { target: 'workbench', timeout: 5000 });
          } else {
            const port = workspace.cdpPort || workspace.ports?.debug;
            if (port) {
              evalResult = await cdpEvalOnPort(port, expr, { target: 'workbench', timeout: 5000, host: workspace.cdpHost });
            }
          }
          const val = evalResult?.results?.[0]?.value;
          if (val) folderFilter = val;
        } catch { }
      }

      const result = await gpiGetAllTrajectories(workspace);
      if (!result.ok) return res.json({ ok: false, error: 'failed', details: result });

      const summaries = result.data?.trajectorySummaries || {};
      const byFolder = {};

      for (const [cascadeId, traj] of Object.entries(summaries)) {
        const title = traj.summary || cascadeId;
        const active = cascadeId === workspace.gpi?.activeCascadeId;
        const time = traj.lastModifiedTime || traj.createdTime || '';
        const ws = traj.workspaces?.[0];
        const folderUri = ws?.workspaceFolderAbsoluteUri || '';
        const repoName = ws?.repository?.computedName || '';
        const folderName = repoName || folderUri.split('/').filter(Boolean).pop() || 'Unknown';

        if (folderFilter && folderUri && !folderUri.includes(folderFilter)) continue;

        if (!byFolder[folderName]) byFolder[folderName] = [];
        byFolder[folderName].push({ title, time, active, cascadeId, folder: folderUri });
      }

      const groups = Object.entries(byFolder)
        .map(([label, items]) => ({
          label,
          items: items.sort((a, b) => (b.time || '').localeCompare(a.time || '')),
        }))
        .sort((a, b) => {
          const aTime = a.items[0]?.time || '';
          const bTime = b.items[0]?.time || '';
          return bTime.localeCompare(aTime);
        });

      res.json({ ok: true, results: [{ value: { ok: true, groups } }] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/conversations/select', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    const { title, cascadeId, targetId } = req.body;
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

      const update = { 'gpi.activeCascadeId': targetCascadeId };
      if (targetId) update[`targetCascades.${targetId}`] = targetCascadeId;
      await Workspace.findByIdAndUpdate(workspace._id, update);

      try {
        const trajResult = await gpiGetTrajectory(workspace, targetCascadeId);
        if (trajResult.ok) {
          const data = trajectoryToConversation(trajResult.data);
          const payload = {
            items: data.items,
            statusText: data.statusText,
            isBusy: data.isBusy,
            turnCount: data.turnCount,
            hasAcceptAll: data.hasAcceptAll,
            hasRejectAll: data.hasRejectAll,
            updatedAt: new Date(),
          };
          const convUpdate = { conversation: payload };
          if (targetId) convUpdate[`targetConversations.${targetId}`] = payload;
          await Workspace.findByIdAndUpdate(workspace._id, convUpdate);
        }
      } catch { }

      res.json({ ok: true, results: [{ value: { ok: true, selected: title || targetCascadeId } }] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/cdp/conversation', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id).lean();
      if (!workspace) return res.status(404).json({ error: 'Not found' });
      const targetId = req.query.targetId;
      if (targetId) {
        const tc = workspace.targetConversations?.[targetId];
        return res.json(tc || { items: [], turnCount: 0, statusText: '' });
      }
      res.json(workspace.conversation || { items: [], turnCount: 0, statusText: '' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/cdp/screenshot', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });

    try {
      if (workspace.type === 'cli') {
        const screenshot = await cliCdpScreenshot(workspace._id.toString());
        return res.json({ ok: true, data: `data:image/png;base64,${screenshot}` });
      }

      if (!workspace.ports?.debug) return res.status(400).json({ error: 'No debug port' });

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

  async function getQuotaCached(workspace) {
    const key = workspace.accountId?.toString() || workspace._id.toString();
    const cached = getCachedQuota(key);
    if (cached) return cached;
    const quota = await fetchWorkspaceQuota(workspace);
    if (quota) {
      setCachedQuota(key, quota);
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
      broadcast({
        event: 'quota:all',
        payload: getAllCachedQuotas(),
      });
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
      if (workspace.type === 'cli') {
        // CLI workspace: read file directly from local filesystem
        const fullPath = workspace.mountedPath
          ? path.resolve(workspace.mountedPath, filePath.replace(/^\/workspace\//, ''))
          : filePath;
        const content = await fs.readFile(fullPath, 'utf8');
        res.json({ ok: true, content, path: filePath });
      } else {
        const result = await execInContainer(workspace.containerId, `cat ${JSON.stringify(filePath)}`);
        res.json({ ok: true, content: result, path: filePath });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post('/api/workspaces/:id/git/clone', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace || !workspace.containerId) return res.status(404).json({ error: 'Workspace not found or not running' });

    // Git clone is not supported for CLI workspaces — use the local terminal instead
    if (workspace.type === 'cli') {
      return res.status(400).json({ error: 'Git clone is not available for CLI workspaces. Use your local terminal instead.' });
    }

    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    try {

      // Docker workspace: original Docker exec-based clone
      const sshKeys = await SshKey.find();
      if (sshKeys.length > 0) {
        const httpsMatch = url.match(/^https?:\/\/(github\.com|gitlab\.com)\/(.+?)(?:\.git)?$/);
        if (httpsMatch) {
          url = `git@${httpsMatch[1]}:${httpsMatch[2]}.git`;
        }
        await execInContainer(workspace.containerId, 'mkdir -p /home/aguser/.ssh && chmod 700 /home/aguser/.ssh');
        for (const key of sshKeys) {
          const safeName = key.name.replace(/[^a-zA-Z0-9_-]/g, '_');
          const escaped = key.privateKey.replace(/'/g, "'\\\''");
          await execInContainer(workspace.containerId, `printf '%s\\n' '${escaped}' > /home/aguser/.ssh/${safeName} && chmod 600 /home/aguser/.ssh/${safeName}`);
          if (key.publicKey) {
            const escapedPub = key.publicKey.replace(/'/g, "'\\\''");
            await execInContainer(workspace.containerId, `printf '%s\\n' '${escapedPub}' > /home/aguser/.ssh/${safeName}.pub && chmod 644 /home/aguser/.ssh/${safeName}.pub`);
          }
        }
        await execInContainer(workspace.containerId, 'ssh-keyscan -H github.com gitlab.com >> /home/aguser/.ssh/known_hosts 2>/dev/null; chmod 644 /home/aguser/.ssh/known_hosts');
        if (sshKeys.length === 1) {
          const safeName = sshKeys[0].name.replace(/[^a-zA-Z0-9_-]/g, '_');
          await execInContainer(workspace.containerId, `cp /home/aguser/.ssh/${safeName} /home/aguser/.ssh/id_rsa && chmod 600 /home/aguser/.ssh/id_rsa`);
        }
      }

      const wsDir = '/workspace';
      const cmd = [
        `rm -rf /tmp/_clone_tmp`,
        `&& GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no' git clone --progress ${JSON.stringify(url)} /tmp/_clone_tmp 2>&1`,
        `&& find ${wsDir} -mindepth 1 -maxdepth 1 ! -name '.config' -exec rm -rf {} +`,
        `&& shopt -s dotglob`,
        `&& mv /tmp/_clone_tmp/* ${wsDir}/`,
        `&& rm -rf /tmp/_clone_tmp`,
      ].join(' ');
      const result = await execInContainer(workspace.containerId, cmd);
      const hasError = result.includes('fatal:') || result.includes('error:') || result.includes('Permission denied');
      if (hasError) {
        await execInContainer(workspace.containerId, 'rm -rf /tmp/_clone_tmp').catch(() => { });
        res.json({ ok: false, error: result.trim() });
      } else {
        const repoName = url.replace(/\.git$/, '').split('/').pop();
        res.json({ ok: true, output: result.trim(), repoName });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/open-folder', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'folderPath required' });
    try {
      const targetPath = workspace.type === 'cli' ? folderPath : `/host${folderPath}`;
      const cmd = JSON.stringify({ command: 'openFolder', path: targetPath });
      if (workspace.type === 'cli') {
        const b64 = Buffer.from(cmd).toString('base64');
        await cliExec(workspace._id.toString(), `node -e "require('fs').writeFileSync(require('path').join(require('os').tmpdir(),'ag-connect-cmd.json'),Buffer.from('${b64}','base64').toString())"`, 5000);
      } else {
        await execInContainer(workspace.containerId, `echo '${cmd.replace(/'/g, "'\\''")}' > /tmp/ag-connect-cmd.json`);
      }
      if (workspace.mountedPath !== folderPath) {
        workspace.mountedPath = folderPath;
        await workspace.save();
        broadcast({ event: 'workspace:updated', payload: workspace.toJSON() });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/open-folder-new-window', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'folderPath required' });
    try {
      const targetPath = workspace.type === 'cli' ? folderPath : `/host${folderPath}`;
      const cmd = JSON.stringify({ command: 'openFolderNewWindow', path: targetPath });
      if (workspace.type === 'cli') {
        const b64 = Buffer.from(cmd).toString('base64');
        await cliExec(workspace._id.toString(), `node -e "require('fs').writeFileSync(require('path').join(require('os').tmpdir(),'ag-connect-cmd.json'),Buffer.from('${b64}','base64').toString())"`, 5000);
      } else {
        await execInContainer(workspace.containerId, `echo '${cmd.replace(/'/g, "'\\''")}' > /tmp/ag-connect-cmd.json`);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/new-window', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    if (workspace.type === 'cli') return res.status(400).json({ error: 'Docker only' });
    try {
      const cmd = JSON.stringify({ command: 'openFolderNewWindow', path: '/host' });
      await execInContainer(workspace.containerId, `echo '${cmd.replace(/'/g, "'\\''")}' > /tmp/ag-connect-cmd.json`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

export { setupWorkspaceRoutes };
