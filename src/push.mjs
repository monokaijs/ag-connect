import { PushSettings } from './models/push-settings.mjs';
import admin from 'firebase-admin';

let firebaseApp = null;

async function getSettings() {
  let settings = await PushSettings.findOne();
  if (!settings) {
    settings = new PushSettings();
    await settings.save();
  }
  return settings;
}

function initFirebase(serviceAccountJson) {
  try {
    if (firebaseApp) {
      admin.app().delete().catch(() => { });
      firebaseApp = null;
    }

    const serviceAccount = JSON.parse(serviceAccountJson);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return true;
  } catch (err) {
    console.error('[FCM] Firebase init error:', err.message);
    firebaseApp = null;
    return false;
  }
}

async function tryInitFromDb() {
  try {
    const settings = await getSettings();
    if (settings.firebaseServiceAccount) {
      initFirebase(settings.firebaseServiceAccount);
    }
  } catch { }
}

async function sendPushNotification(title, body) {
  if (!firebaseApp) {
    console.log('[FCM] Skipped: firebaseApp not initialized');
    return;
  }

  try {
    const settings = await getSettings();
    const tokens = settings.pushTokens || [];
    if (tokens.length === 0) {
      console.log('[FCM] Skipped: no tokens registered');
      return;
    }

    console.log(`[FCM] Sending to ${tokens.length} device(s): ${title}`);
    const messaging = admin.messaging();
    const message = {
      notification: { title, body },
      tokens,
    };

    const result = await messaging.sendEachForMulticast(message);
    console.log(`[FCM] Sent: ${result.successCount} ok, ${result.failureCount} failed`);

    if (result.failureCount > 0) {
      const failedTokens = [];
      result.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const code = resp.error?.code;
          if (code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered') {
            failedTokens.push(tokens[idx]);
          }
        }
      });

      if (failedTokens.length > 0) {
        settings.pushTokens = settings.pushTokens.filter(t => !failedTokens.includes(t));
        await settings.save();
      }
    }
  } catch (err) {
    console.error('[FCM] Send error:', err.message);
  }
}

function setupPushRoutes(app) {
  app.post('/api/settings/push-token', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Token required' });

      const settings = await getSettings();
      if (!settings.pushTokens.includes(token)) {
        settings.pushTokens.push(token);
        await settings.save();
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/settings/push-token', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Token required' });

      const settings = await getSettings();
      settings.pushTokens = settings.pushTokens.filter(t => t !== token);
      await settings.save();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/settings/firebase', async (req, res) => {
    try {
      const settings = await getSettings();
      res.json({
        configured: !!settings.firebaseServiceAccount,
        tokenCount: settings.pushTokens.length,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings/firebase', async (req, res) => {
    try {
      const { serviceAccount } = req.body;
      if (!serviceAccount) return res.status(400).json({ error: 'Service account JSON required' });

      try {
        JSON.parse(serviceAccount);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const ok = initFirebase(serviceAccount);
      if (!ok) return res.status(400).json({ error: 'Failed to initialize Firebase with provided credentials' });

      const settings = await getSettings();
      settings.firebaseServiceAccount = serviceAccount;
      await settings.save();

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/settings/firebase', async (req, res) => {
    try {
      if (firebaseApp) {
        admin.app().delete().catch(() => { });
        firebaseApp = null;
      }

      const settings = await getSettings();
      settings.firebaseServiceAccount = '';
      await settings.save();

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings/push-test', async (req, res) => {
    try {
      const settings = await getSettings();
      const tokens = settings.pushTokens || [];
      const info = {
        firebaseInitialized: !!firebaseApp,
        tokenCount: tokens.length,
        tokens: tokens.map(t => t.slice(0, 20) + '...'),
      };

      if (!firebaseApp) {
        return res.json({ ...info, error: 'Firebase not initialized' });
      }
      if (tokens.length === 0) {
        return res.json({ ...info, error: 'No tokens registered' });
      }

      const messaging = admin.messaging();
      const result = await messaging.sendEachForMulticast({
        notification: {
          title: 'AG Connect Test',
          body: 'Push notification is working!',
        },
        tokens,
      });

      res.json({
        ...info,
        sent: true,
        successCount: result.successCount,
        failureCount: result.failureCount,
        errors: result.responses
          .filter(r => !r.success)
          .map(r => r.error?.message || 'unknown'),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

export { setupPushRoutes, sendPushNotification, tryInitFromDb };
