import crypto from 'crypto';
import { Workspace } from './models/workspace.mjs';
import { injectTokensIntoContainer } from './token-injector.mjs';
import { restartIDEInContainer, waitForContainerReady } from './docker-manager.mjs';

const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

function setupOAuthRoutes(app, broadcast) {
  app.get('/api/oauth/google/callback', (req, res) => {
    const params = new URLSearchParams(req.query);
    res.redirect(`/?${params.toString()}`);
  });

  app.post('/api/oauth/exchange', async (req, res) => {
    const { code, workspaceId, redirectUri } = req.body;
    if (!code || !workspaceId || !redirectUri) {
      return res.status(400).json({ error: 'code, workspaceId, redirectUri required' });
    }

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
        console.error('[oauth] Token exchange failed:', errText);
        return res.status(400).json({ error: 'token_exchange_failed' });
      }

      const tokens = await tokenRes.json();

      const userRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userRes.ok) {
        return res.status(400).json({ error: 'userinfo_failed' });
      }

      const userInfo = await userRes.json();
      const expiryTimestamp = Math.floor(Date.now() / 1000) + 3600;

      const workspace = await Workspace.findById(workspaceId);
      if (!workspace) {
        return res.status(404).json({ error: 'workspace_not_found' });
      }

      workspace.auth = {
        email: userInfo.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        expiryTimestamp,
        avatar: userInfo.picture || '',
        name: userInfo.name || userInfo.email,
      };
      await workspace.save();

      res.json({ ok: true, email: userInfo.email, avatar: userInfo.picture || '', name: userInfo.name || '' });

      broadcast({ event: 'workspace:status', payload: { id: workspaceId, status: 'initializing', stage: 'Injecting credentials', message: 'Injecting tokens...' } });
      await injectTokensIntoContainer(workspace.containerId, tokens.access_token, tokens.refresh_token || '', expiryTimestamp);

      broadcast({ event: 'workspace:status', payload: { id: workspaceId, status: 'initializing', stage: 'Restarting IDE', message: 'Restarting IDE...' } });
      await restartIDEInContainer(workspace.containerId);

      await new Promise(r => setTimeout(r, 5000));
      await waitForContainerReady(workspace.cdpHost || 'localhost', workspace.cdpPort || workspace.ports.debug, 60);

      workspace.status = 'running';
      workspace.stage = '';
      await workspace.save();

      broadcast({ event: 'workspace:auth', payload: { id: workspaceId, email: userInfo.email, avatar: userInfo.picture || '', name: userInfo.name || '' } });
      broadcast({ event: 'workspace:status', payload: { id: workspaceId, status: 'running', stage: '', message: 'Ready' } });
    } catch (err) {
      console.error('[oauth] Exchange error:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

export { setupOAuthRoutes, GOOGLE_CLIENT_ID };
