import { execInContainer } from './docker-manager.mjs';
import { Workspace } from './models/workspace.mjs';

function cleanDockerOutput(raw) {
  if (!raw) return '';
  return raw.replace(/[\x00-\x08]/g, '').trim();
}

async function gitExec(containerId, cmd) {
  const result = await execInContainer(containerId, `cd /workspace && ${cmd}`);
  return cleanDockerOutput(result);
}

function setupGitRoutes(app) {
  app.get('/api/workspaces/:id/git/status', async (req, res) => {
    try {
      const ws = await Workspace.findById(req.params.id);
      if (!ws?.containerId) return res.status(400).json({ error: 'No container' });

      const [statusRaw, branchRaw] = await Promise.all([
        gitExec(ws.containerId, 'git status --porcelain 2>/dev/null || echo ""'),
        gitExec(ws.containerId, 'git branch --show-current 2>/dev/null || echo ""'),
      ]);

      const lines = (statusRaw || '').trim().split('\n').filter(Boolean);
      const staged = [];
      const unstaged = [];

      for (const line of lines) {
        const x = line[0];
        const y = line[1];
        const file = line.slice(3);
        if (x !== ' ' && x !== '?') staged.push({ status: x, file });
        if (y !== ' ' || x === '?') unstaged.push({ status: y === '?' ? '?' : y, file });
      }

      res.json({
        branch: (branchRaw || '').trim(),
        staged,
        unstaged,
        raw: (statusRaw || '').trim(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/git/stage', async (req, res) => {
    try {
      const ws = await Workspace.findById(req.params.id);
      if (!ws?.containerId) return res.status(400).json({ error: 'No container' });
      const { files } = req.body;
      const target = files?.length ? files.map(f => `"${f}"`).join(' ') : '.';
      await gitExec(ws.containerId, `git add ${target}`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/git/unstage', async (req, res) => {
    try {
      const ws = await Workspace.findById(req.params.id);
      if (!ws?.containerId) return res.status(400).json({ error: 'No container' });
      const { files } = req.body;
      const target = files?.length ? files.map(f => `"${f}"`).join(' ') : '.';
      await gitExec(ws.containerId, `git reset HEAD ${target}`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/git/commit', async (req, res) => {
    try {
      const ws = await Workspace.findById(req.params.id);
      if (!ws?.containerId) return res.status(400).json({ error: 'No container' });
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
      const result = await gitExec(ws.containerId, `git commit -m "${message.replace(/"/g, '\\"')}"`);
      res.json({ ok: true, output: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/git/push', async (req, res) => {
    try {
      const ws = await Workspace.findById(req.params.id);
      if (!ws?.containerId) return res.status(400).json({ error: 'No container' });
      const result = await gitExec(ws.containerId, 'git push 2>&1');
      res.json({ ok: true, output: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/git/pull', async (req, res) => {
    try {
      const ws = await Workspace.findById(req.params.id);
      if (!ws?.containerId) return res.status(400).json({ error: 'No container' });
      const result = await gitExec(ws.containerId, 'git pull 2>&1');
      res.json({ ok: true, output: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/git/sync', async (req, res) => {
    try {
      const ws = await Workspace.findById(req.params.id);
      if (!ws?.containerId) return res.status(400).json({ error: 'No container' });
      const pullResult = await gitExec(ws.containerId, 'git pull 2>&1');
      const pushResult = await gitExec(ws.containerId, 'git push 2>&1');
      res.json({ ok: true, output: `Pull:\n${pullResult}\n\nPush:\n${pushResult}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/git/log', async (req, res) => {
    try {
      const ws = await Workspace.findById(req.params.id);
      if (!ws?.containerId) return res.status(400).json({ error: 'No container' });
      const count = req.query.count || 50;
      const raw = await gitExec(ws.containerId, `git log --oneline --format="%H|%h|%s|%an|%ar" -n ${count} 2>/dev/null || echo ""`);
      const commits = (raw || '').trim().split('\n').filter(Boolean).map(line => {
        const [hash, short, message, author, time] = line.split('|');
        return { hash, short, message, author, time };
      });
      res.json({ commits });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspaces/:id/git/diff', async (req, res) => {
    try {
      const ws = await Workspace.findById(req.params.id);
      if (!ws?.containerId) return res.status(400).json({ error: 'No container' });
      const staged = req.query.staged === 'true';
      const raw = await gitExec(ws.containerId, `git diff ${staged ? '--cached' : ''} 2>/dev/null || echo ""`);
      res.json({ diff: raw });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

export { setupGitRoutes };
