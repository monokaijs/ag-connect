import { Workspace } from './models/workspace.mjs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  createWorkspaceContainer,
  stopWorkspaceContainer,
  removeWorkspaceContainer,
  startWorkspaceContainer,
} from './docker-manager.mjs';
import { cdpEvalOnPort, findTargetOnPort, getTargetsOnPort } from './workspace-cdp.mjs';
import { getChatState } from './conversation-monitor.mjs';
import { fetchWorkspaceQuota } from './quota.mjs';

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
        } catch (e) { console.error(e) }
      }, 0);
    }
  });

  app.get('/api/workspaces/:id/fs/list', async (req, res) => {
    try {
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace || !workspace.mountedPath) return res.json([]);
      const fs = await import('fs/promises');
      const path = await import('path');
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
        path: path.join(sub, d.name)
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
      const fs = await import('fs/promises');
      const path = await import('path');
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
      const fs = await import('fs/promises');
      const path = await import('path');
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
      const fs = await import('fs/promises');
      const path = await import('path');
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

      const http = await import('http');

      await new Promise((resolve, reject) => {
        const req = http.get(`http://${host}:${port}/json/close/${targetId}`, (res) => {
          res.on('data', () => { });
          res.on('end', resolve);
        });
        req.on('error', reject);
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

  app.post('/api/workspaces/:id/cdp/send', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    const text = req.body.text;
    const escaped = JSON.stringify(text);
    try {
      const result = await wsEval(workspace, `(async () => {
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) return { ok:false, reason:"busy" };
        const editor = document.querySelector('[data-lexical-editor="true"][contenteditable="true"]') || document.querySelector('div[contenteditable="true"][role="textbox"]');
        if (!editor) return { ok:false, error:"editor_not_found" };
        editor.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
        document.execCommand("insertText", false, ${escaped});
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const submit = document.querySelector('svg.lucide-arrow-right')?.closest('button') || document.querySelector('[aria-label="Send Message"]');
        if (submit && !submit.disabled) { submit.click(); return { ok:true, method:"click" }; }
        editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles:true, key:"Enter", code:"Enter", keyCode:13 }));
        return { ok:true, method:"enter" };
      })()`, { target: 'workbench' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/stop', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    try {
      const result = await wsEval(workspace, `(() => {
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) { cancel.click(); return { ok: true }; }
        return { ok: false, error: 'not_busy' };
      })()`);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/cdp/models', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    try {
      const result = await wsEval(workspace, `(() => {
        const optionSpans = Array.from(document.querySelectorAll('span, div')).filter(s => {
          if (s.children.length > 0) return false;
          const t = s.textContent.trim();
          return ['Claude', 'Gemini', 'GPT', 'Opus', 'Sonnet', 'Flash'].some(p => t.includes(p)) && t.length < 50;
        });
        const allModels = optionSpans.map(s => s.textContent.trim()).filter((m, i, arr) => arr.indexOf(m) === i);
        const currentEl = document.querySelector('span.min-w-0.select-none.overflow-hidden.text-ellipsis.whitespace-nowrap.text-xs.opacity-70');
        const current = currentEl ? currentEl.textContent.trim() : (allModels.length > 0 ? allModels[0] : '');
        return { ok: true, current, models: allModels.map(m => ({ label: m, selected: m === current })) };
      })()`, { target: 'workbench' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/models/select', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    const escaped = JSON.stringify(req.body.model);
    try {
      const result = await wsEval(workspace, `(() => {
        // Find existing current model label
        const currentEl = document.querySelector('span.min-w-0.select-none.overflow-hidden.text-ellipsis.whitespace-nowrap.text-xs.opacity-70');
        const btn = currentEl ? currentEl.closest('button, div[class*="cursor-"]') : null;
        if (btn) btn.click();
        
        return new Promise(resolve => {
            setTimeout(() => {
                const optionSpans = Array.from(document.querySelectorAll('span, div')).filter(s => {
                   if (s.children.length > 0) return false;
                   const t = s.textContent.trim();
                   return ['Claude', 'Gemini', 'GPT', 'Opus', 'Sonnet', 'Flash'].some(p => t.includes(p)) && t.length < 50;
                });
                const target = optionSpans.find(s => s.textContent.trim().includes(${escaped}));
                if (target) {
                    target.click();
                    resolve({ ok: true });
                } else {
                    resolve({ ok: false, error: 'model_not_found' });
                }
            }, 100);
        });
      })()`, { target: 'workbench' });
      res.json(result);
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
      const result = await wsEval(workspace, `(() => {
        const btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]') || document.querySelector('[aria-label*="New Chat"]') || document.querySelector('.new-chat-button') || Array.from(document.querySelectorAll('a, button')).find(b => b.textContent && b.textContent.includes('New Chat'));
        if (!btn) return { ok: false, error: 'not_found' };
        btn.click();
        return { ok: true };
      })()`, { target: 'workbench' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/cdp/conversations', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    try {
      const result = await wsEval(workspace, `(async () => {
    let input = document.querySelector('input[placeholder="Select a conversation"]');
    if (!input) {
      const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
      if (!btn) return { ok: false, error: 'no_history_btn' };
      btn.click();
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 100));
        input = document.querySelector('input[placeholder="Select a conversation"]');
        if (input) break;
      }
      if (!input) return { ok: false, error: 'dialog_timeout' };
    }

    const root = input.closest('div[tabindex]');
    if (!root) return { ok: false, error: 'no_root' };

    const allDivs = root.querySelectorAll('div');
    for (const el of allDivs) {
      const t = (el.textContent || '').trim();
      if (t.startsWith('Show ') && t.includes('more')) el.click();
    }
    await new Promise(r => setTimeout(r, 500));

    const groups = [];
    let currentGroup = null;
    const seenTitles = new Set();

    const walk = (el) => {
      for (const child of el.children) {
        const cls = child.className || '';
        const text = (child.textContent || '').trim();

        if (cls.includes('text-xs') && cls.includes('pt-4') && cls.includes('opacity-50') && text.length < 80) {
          currentGroup = { label: text, items: [] };
          groups.push(currentGroup);
          continue;
        }

        if (cls.includes('cursor-pointer') && cls.includes('justify-between') && cls.includes('rounded-md')) {
          const titleSpan = child.querySelector('.text-sm span');
          const title = titleSpan ? titleSpan.textContent.trim() : '';
          if (!title) continue;
          const timeEl = child.querySelector('.ml-4');
          const time = timeEl ? timeEl.textContent.trim() : '';
          const active = cls.includes('focusBackground');
          if (!currentGroup) {
            currentGroup = { label: '', items: [] };
            groups.push(currentGroup);
          }
          if (!seenTitles.has(title)) {
            seenTitles.add(title);
            currentGroup.items.push({ title, time, active });
          }
          continue;
        }

        if (child.children.length > 0) walk(child);
      }
    };

    walk(root);

    const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
    if (btn) btn.click();

    return { ok: true, groups: groups.filter(g => g.items.length > 0) };
  })()`, { target: 'workbench' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/cdp/conversations/select', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    const escaped = JSON.stringify(req.body.title);
    try {
      const result = await wsEval(workspace, `(async () => {
    let input = document.querySelector('input[placeholder="Select a conversation"]');
    if (!input) {
      const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
      if (!btn) return { ok: false, error: 'no_history_btn' };
      btn.click();
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 100));
        input = document.querySelector('input[placeholder="Select a conversation"]');
        if (input) break;
      }
      if (!input) return { ok: false, error: 'dialog_timeout' };
    }

    const root = input.closest('div[tabindex]');
    if (!root) return { ok: false, error: 'no_root' };

    const allDivs = root.querySelectorAll('div');
    for (const el of allDivs) {
      const t = (el.textContent || '').trim();
      if (t.startsWith('Show ') && t.includes('more')) el.click();
    }
    await new Promise(r => setTimeout(r, 500));

    const items = root.querySelectorAll('[class*="cursor-pointer"][class*="justify-between"][class*="rounded-md"]');
    for (const item of items) {
      const titleSpan = item.querySelector('.text-sm span');
      const itemTitle = titleSpan ? titleSpan.textContent.trim() : '';
      if (itemTitle === ${escaped}) {
        item.click();
        return { ok: true, selected: itemTitle };
      }
    }

    const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
    if (btn) btn.click();
    return { ok: false, error: 'conversation_not_found' };
  })()`, { target: 'workbench' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/cdp/conversation', async (req, res) => {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Not found' });
    try {
      const result = await wsEval(workspace, `(() => {
        const content = document.querySelector('.relative.flex.flex-col.gap-y-3.px-4');
        if (!content) return null;
        const allItems = [];
        const groups = Array.from(content.children);
        for (const g of groups) {
          const kids = Array.from(g.children);
          for (const kid of kids) {
            const cls = typeof kid.className === 'string' ? kid.className : '';
            const hasLexical = !!kid.querySelector('[data-lexical-editor]');
            if (hasLexical) continue;
            const hasAgentContainer = kid.querySelector('.space-y-2') || kid.querySelector('.leading-relaxed');
            const isStatus = cls.includes('whitespace-nowrap') || cls.includes('transition-opacity');
            if (!hasAgentContainer && !isStatus && kid.offsetHeight > 10) {
              const clone = kid.cloneNode(true);
              clone.querySelectorAll('.whitespace-nowrap, .transition-opacity, [class*="opacity"]').forEach(el => el.remove());
              let text = (clone.textContent || '').trim();
              ['Pending messages', 'Sending', 'Queued'].forEach(l => { text = text.replace(l, '').trim(); });
              if (text) { allItems.push({ type: 'user', text: text.substring(0, 2000) }); continue; }
            }
            const container = cls.includes('space-y-2') ? kid : kid.querySelector('.space-y-2');
            if (!container) continue;
            const steps = Array.from(container.children);
            for (const step of steps) {
              const sCls = typeof step.className === 'string' ? step.className : '';
              if (sCls.includes('my-2')) {
                const btn = step.querySelector('button');
                const btnText = btn ? (btn.textContent || '').trim() : '';
                const isThinking = btn && (btnText.includes('Thought') || btnText.includes('Thinking'));
                if (isThinking) {
                  allItems.push({ type: 'thinking', text: btnText.substring(0, 200) || 'Thinking...' });
                  const allMds = step.querySelectorAll('.leading-relaxed');
                  const sib = btn.nextElementSibling;
                  for (const md of allMds) {
                    if (sib && sib.contains(md)) continue;
                    const clone = md.cloneNode(true);
                    clone.querySelectorAll('style').forEach(s => s.remove());
                    const text = clone.textContent.substring(0, 3000);
                    const html = md.innerHTML;
                    if (text.trim()) allItems.push({ type: 'markdown', text, html });
                  }
                  continue;
                }
                const md = step.querySelector('.leading-relaxed');
                if (md) {
                  const clone = md.cloneNode(true);
                  clone.querySelectorAll('style').forEach(s => s.remove());
                  allItems.push({ type: 'markdown', text: clone.textContent.substring(0, 3000), html: md.innerHTML });
                }
                continue;
              }
              const cmdLabel = step.querySelector('.opacity-60');
              const cmdText = cmdLabel ? (cmdLabel.textContent || '').trim() : '';
              if (cmdLabel && (cmdText.includes('Ran') || cmdText.includes('Running') || cmdText.includes('Canceled'))) {
                const pre = step.querySelector('pre') || step.querySelector('code');
                allItems.push({ type: 'command', label: cmdText, code: pre ? pre.textContent.substring(0, 2000) : '' });
                continue;
              }
              const text = (step.textContent || '').trim();
              if (text) allItems.push({ type: 'tool', text: text.substring(0, 500) });
            }
          }
        }
        const statusEl = document.querySelector('.whitespace-nowrap.transition-opacity');
        const statusText = statusEl ? (statusEl.textContent || '').trim() : '';
        return { turnCount: allItems.length, items: allItems, statusText };
      })()`, { target: 'workbench' });
      const data = result?.results?.[0]?.value || null;
      res.json(data || { turnCount: 0, items: [], statusText: '' });
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

      // We need to implement a specialized connect operation for taking a screenshot
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
            params: { format: 'png', quality: 80 }
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
}

export { setupWorkspaceRoutes };
