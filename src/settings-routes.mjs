import { SshKey } from './models/ssh-key.mjs';
import { getSettings } from './models/settings.mjs';
import { Account } from './models/account.mjs';
import { Workspace } from './models/workspace.mjs';
import { injectTokensIntoContainer } from './token-injector.mjs';
import { restartIDEInContainer, waitForContainerReady } from './docker-manager.mjs';
import { getValidAccessToken, fetchWorkspaceQuota } from './quota.mjs';
import { getCachedQuota, setCachedQuota } from './config.mjs';

const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

function setupSettingsRoutes(app, broadcast) {
  app.get('/api/accounts', async (req, res) => {
    try {
      const accounts = await Account.find().sort({ createdAt: -1 });
      res.json(accounts.map(a => ({
        _id: a._id,
        email: a.email,
        name: a.name,
        avatar: a.avatar,
        createdAt: a.createdAt,
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/accounts', async (req, res) => {
    const { code, redirectUri } = req.body;
    if (!code || !redirectUri) return res.status(400).json({ error: 'code and redirectUri required' });

    try {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        return res.status(400).json({ error: 'token_exchange_failed', details: errText });
      }

      const tokens = await tokenRes.json();
      const userRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!userRes.ok) return res.status(400).json({ error: 'userinfo_failed' });
      const userInfo = await userRes.json();

      let account = await Account.findOne({ email: userInfo.email });
      if (account) {
        account.accessToken = tokens.access_token;
        if (tokens.refresh_token) account.refreshToken = tokens.refresh_token;
        account.expiryTimestamp = Math.floor(Date.now() / 1000) + 3600;
        account.name = userInfo.name || userInfo.email;
        account.avatar = userInfo.picture || '';
        await account.save();
      } else {
        account = await Account.create({
          email: userInfo.email,
          name: userInfo.name || userInfo.email,
          avatar: userInfo.picture || '',
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || '',
          expiryTimestamp: Math.floor(Date.now() / 1000) + 3600,
        });
      }

      res.json({ ok: true, account: { _id: account._id, email: account.email, name: account.name, avatar: account.avatar } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/accounts/:id', async (req, res) => {
    try {
      await Account.findByIdAndDelete(req.params.id);
      await Workspace.updateMany({ accountId: req.params.id }, { accountId: null, 'auth.email': '', 'auth.accessToken': '', 'auth.refreshToken': '' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/accounts/:id/quota', async (req, res) => {
    try {
      const account = await Account.findById(req.params.id);
      if (!account) return res.status(404).json({ error: 'Not found' });
      const key = account._id.toString();
      let quota = getCachedQuota(key);
      if (!quota) {
        const fakeWorkspace = { auth: { accessToken: account.accessToken, refreshToken: account.refreshToken, expiryTimestamp: account.expiryTimestamp }, accountId: account._id };
        quota = await fetchWorkspaceQuota(fakeWorkspace);
        if (quota) setCachedQuota(key, quota);
      }
      if (!quota) return res.json({ ok: false });
      res.json({ ok: true, ...quota });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspaces/:id/set-account', async (req, res) => {
    const { accountId } = req.body;
    try {
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace) return res.status(404).json({ error: 'Not found' });
      const account = await Account.findById(accountId);
      if (!account) return res.status(404).json({ error: 'Account not found' });

      workspace.accountId = account._id;
      workspace.auth = {
        email: account.email,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        expiryTimestamp: account.expiryTimestamp,
        avatar: account.avatar,
        name: account.name,
      };
      await workspace.save();

      if (workspace.type !== 'cli' && workspace.containerId) {
        broadcast({ event: 'workspace:status', payload: { id: workspace._id.toString(), status: 'initializing', stage: 'Injecting credentials' } });
        await injectTokensIntoContainer(workspace.containerId, account.accessToken, account.refreshToken, account.expiryTimestamp);
        broadcast({ event: 'workspace:status', payload: { id: workspace._id.toString(), status: 'initializing', stage: 'Restarting IDE' } });
        await restartIDEInContainer(workspace.containerId);
        await new Promise(r => setTimeout(r, 5000));
        await waitForContainerReady(workspace.cdpHost || 'localhost', workspace.cdpPort || workspace.ports?.debug, 60);
        workspace.status = 'running';
        workspace.stage = '';
        await workspace.save();
        broadcast({ event: 'workspace:status', payload: { id: workspace._id.toString(), status: 'running', stage: '' } });
      } else {
        workspace.status = 'running';
        workspace.stage = '';
        await workspace.save();
        broadcast({ event: 'workspace:status', payload: { id: workspace._id.toString(), status: 'running', stage: '' } });
      }

      broadcast({ event: 'workspace:auth', payload: { id: workspace._id.toString(), email: account.email, avatar: account.avatar, name: account.name } });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/settings/host-path', async (req, res) => {
    try {
      const settings = await getSettings();
      res.json({ hostMountPath: settings.hostMountPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/settings/host-path', async (req, res) => {
    try {
      const { hostMountPath } = req.body;
      const settings = await getSettings();
      settings.hostMountPath = hostMountPath || '';
      await settings.save();
      res.json({ ok: true, hostMountPath: settings.hostMountPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/settings/ssh-keys', async (req, res) => {
    try {
      const keys = await SshKey.find().sort({ createdAt: -1 });
      res.json(keys.map(k => ({
        _id: k._id,
        name: k.name,
        publicKey: k.publicKey,
        hasPrivateKey: !!k.privateKey,
        createdAt: k.createdAt,
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings/ssh-keys', async (req, res) => {
    try {
      const { name, privateKey, publicKey } = req.body;
      if (!name || !privateKey) return res.status(400).json({ error: 'Name and private key required' });
      const key = new SshKey({ name, privateKey, publicKey: publicKey || '' });
      await key.save();
      res.json({ _id: key._id, name: key.name, publicKey: key.publicKey, createdAt: key.createdAt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/settings/ssh-keys/:id', async (req, res) => {
    try {
      await SshKey.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings/ssh-keys/generate', async (req, res) => {
    const { name, algorithm } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const algo = ['ed25519', 'rsa', 'ecdsa'].includes(algorithm) ? algorithm : 'ed25519';
    const bits = algo === 'rsa' ? ['-b', '4096'] : [];
    try {
      const { execSync } = await import('child_process');
      const { mkdtempSync, readFileSync, rmSync } = await import('fs');
      const { join } = await import('path');
      const tmpDir = mkdtempSync('/tmp/sshgen-');
      const keyPath = join(tmpDir, 'key');
      execSync(`ssh-keygen -t ${algo} ${bits.join(' ')} -f ${keyPath} -N "" -C "${name}"`, { stdio: 'pipe' });
      const privateKey = readFileSync(keyPath, 'utf-8');
      const publicKey = readFileSync(`${keyPath}.pub`, 'utf-8');
      rmSync(tmpDir, { recursive: true });
      const key = new SshKey({ name, privateKey, publicKey });
      await key.save();
      res.json({ _id: key._id, name: key.name, publicKey: key.publicKey, createdAt: key.createdAt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/settings/password', async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    try {
      const { User } = await import('./models/user.mjs');
      const user = await User.findById(req.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!user.verifyPassword(currentPassword)) return res.status(401).json({ error: 'Current password is incorrect' });
      user.passwordHash = User.hashPassword(newPassword);
      await user.save();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

export { setupSettingsRoutes };
