import { state, tokens, log, saveState, generatePairingCode, generateToken, generateMessageId } from './state.mjs';
import { poke } from './cdp.mjs';
import { cdpEval, fetchDom, fetchConversation, fetchConversationProbe, sendMessageToIDE, stopAgent, getModelInfo, getAvailableModels, selectModel, clickAcceptAll, clickRejectAll, clickNewChat, fetchConversationList, selectConversation } from './cdp-dom.mjs';

let pokeInFlight = false;
let lastPokeAt = 0;
let retryTimer = null;
let retryAttempts = 0;

function stopRetry() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
  retryAttempts = 0;
}

async function tryPoke(broadcast, isRetry = false) {
  if (pokeInFlight) return;
  if (Date.now() - lastPokeAt < 2000) return;

  pokeInFlight = true;
  lastPokeAt = Date.now();

  const pendingMsgs = state.messages
    .filter(m => m.to === 'agent' && m.status === 'new')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  let msgText = 'check inbox';
  if (pendingMsgs.length > 0) {
    msgText = pendingMsgs.map(m => m.text).join('\n\n');
    await log('POKE', `Injecting ${pendingMsgs.length} messages. Total length: ${msgText.length}`);
  }

  if (!isRetry) await log('POKE', 'Attempting to wake agent...');
  const res = await poke(msgText);
  pokeInFlight = false;

  if (res.ok) {
    await log('POKE', 'Success', { method: res.method });
    if (pendingMsgs.length > 0) {
      pendingMsgs.forEach(m => {
        m.status = 'poked';
        broadcast('message_ack', { id: m.id, status: 'poked' });
      });
      await saveState();
    }
    state.agent.state = 'working';
    state.agent.lastSeen = new Date().toISOString();
    await saveState();
    broadcast('agent_status', state.agent);
    stopRetry();
  } else if (res.reason?.includes('busy')) {
    if (!isRetry) await log('POKE', 'Agent busy. Scheduling retries.');
    state.agent.state = 'busy';
    state.agent.lastSeen = new Date().toISOString();
    broadcast('agent_status', state.agent);
    startRetry(broadcast);
  } else {
    await log('POKE', 'Failed', res);
    stopRetry();
  }

  return res;
}

function startRetry(broadcast) {
  if (retryTimer) return;
  retryAttempts = 0;
  retryTimer = setInterval(async () => {
    retryAttempts++;
    if (retryAttempts > 24) {
      await log('POKE', 'Retry limit reached. Giving up.');
      stopRetry();
      return;
    }
    await tryPoke(broadcast, true);
  }, 5000);
}

function schedulePoke(broadcast) {
  if (pokeInFlight) return;
  if (retryTimer) return;
  tryPoke(broadcast, false);
}

function getPokeStatus() {
  return {
    pokeInFlight,
    retryActive: !!retryTimer,
    retryAttempts,
  };
}

export function setupRoutes(app, wss) {
  const PAIRING_CODE = generatePairingCode();

  function broadcast(event, payload) {
    const msg = JSON.stringify({
      event,
      payload,
      ts: new Date().toISOString(),
    });
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(msg);
      }
    }
  }

  const requireAuth = (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress;
    if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') {
      return next();
    }
    const token = req.headers['x-ag-token'];
    if (!token || !tokens.has(token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };

  app.get('/health', (req, res) => {
    res.json({ ok: true, name: 'ag-connect', version: '1.0.0', ts: new Date().toISOString() });
  });

  app.post('/pair/auto', (req, res) => {
    const token = generateToken();
    tokens.add(token);
    saveState();
    log('AUTH', 'Auto-paired new device');
    res.json({ token });
  });

  app.post('/pair/claim', (req, res) => {
    const { code } = req.body;
    if (!code || code !== PAIRING_CODE) {
      return res.status(403).json({ error: 'invalid_code' });
    }
    const token = generateToken();
    tokens.add(token);
    saveState();
    res.json({ token });
  });

  app.get('/status', requireAuth, (req, res) => {
    const pokeStatus = getPokeStatus();
    res.json({
      ok: true,
      version: '1.0.0',
      ts: new Date().toISOString(),
      agent: state.agent,
      cdp: {
        pokeInFlight: pokeStatus.pokeInFlight,
        retryActive: pokeStatus.retryActive,
        retryAttempts: pokeStatus.retryAttempts,
      },
      server: {
        uptime: process.uptime(),
        wsClients: wss.clients.size,
      },
    });
  });

  app.post('/messages/send', requireAuth, (req, res) => {
    let { from, to, text, channel } = req.body;
    from = from || 'user';
    if (!to || !text) return res.status(400).json({ ok: false, error: 'missing_fields' });

    const msg = {
      id: generateMessageId(),
      createdAt: new Date().toISOString(),
      from,
      to,
      channel: channel || 'general',
      text: (from === 'user' ? '[Remote] ' : '') + text,
      status: 'new',
    };

    state.messages.push(msg);
    if (state.messages.length > 500) state.messages.shift();
    saveState();
    broadcast('message_new', msg);

    if (to === 'agent') {
      schedulePoke(broadcast);
    }

    res.json({ ok: true, message: msg });
  });

  app.get('/messages/inbox', requireAuth, (req, res) => {
    const { to, status, limit } = req.query;
    let items = state.messages;
    if (to) items = items.filter(m => m.to === to);
    if (status) items = items.filter(m => m.status === status);
    items = [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (limit) items = items.slice(0, parseInt(limit));
    res.json({ ok: true, messages: items });
  });

  app.post('/messages/:id/ack', requireAuth, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const msg = state.messages.find(m => m.id === id);
    if (!msg) return res.status(404).json({ ok: false, error: 'not_found' });
    msg.status = status || 'read';
    saveState();
    broadcast('message_ack', { id, status: msg.status });
    res.json({ ok: true });
  });

  app.post('/agent/heartbeat', requireAuth, (req, res) => {
    const { state: agentState, task, note } = req.body;
    state.agent = {
      ...state.agent,
      lastSeen: new Date().toISOString(),
      state: agentState || state.agent.state,
      task: task !== undefined ? task : state.agent.task,
      note: note !== undefined ? note : state.agent.note,
    };
    saveState();
    broadcast('agent_status', state.agent);
    res.json({ ok: true, agent: state.agent });
  });

  app.get('/agent/status', requireAuth, (req, res) => {
    res.json({ ok: true, agent: state.agent });
  });

  app.post('/poke', requireAuth, async (req, res) => {
    const { message } = req.body;
    const result = await tryPoke(broadcast, false);
    res.json({ ok: true, result });
  });

  app.get('/messages/history', requireAuth, (req, res) => {
    const { limit = 50, offset = 0 } = req.query;
    const sorted = [...state.messages].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const page = sorted.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    res.json({
      ok: true,
      messages: page,
      total: state.messages.length,
    });
  });

  app.delete('/messages', requireAuth, (req, res) => {
    state.messages = [];
    saveState();
    broadcast('messages_cleared', {});
    res.json({ ok: true });
  });

  app.get('/cdp/dom', requireAuth, async (req, res) => {
    const { selector, maxLength } = req.query;
    try {
      const result = await fetchDom(selector || 'body', {
        maxLength: parseInt(maxLength || '200000'),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/cdp/conversation', requireAuth, async (req, res) => {
    try {
      const result = await fetchConversation();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/debug/conversation', async (req, res) => {
    try {
      const result = await fetchConversation();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/cdp/eval', requireAuth, async (req, res) => {
    const { expression, target } = req.body;
    if (!expression) return res.status(400).json({ ok: false, error: 'missing expression' });
    try {
      const result = await cdpEval(expression, { target: target || 'launchpad' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/cdp/send', requireAuth, async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ ok: false, error: 'missing text' });
    try {
      const result = await sendMessageToIDE(text);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/cdp/stop', requireAuth, async (req, res) => {
    try {
      const result = await stopAgent();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/cdp/models', requireAuth, async (req, res) => {
    try {
      const result = await getAvailableModels();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/cdp/models/select', requireAuth, async (req, res) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ ok: false, error: 'missing model' });
    try {
      const result = await selectModel(model);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/cdp/accept-all', requireAuth, async (req, res) => {
    try {
      const result = await clickAcceptAll();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/cdp/reject-all', requireAuth, async (req, res) => {
    try {
      const result = await clickRejectAll();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/cdp/new-chat', requireAuth, async (req, res) => {
    try {
      const result = await clickNewChat();
      state.messages = [];
      saveState();
      broadcast('messages_cleared', {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/cdp/conversations', requireAuth, async (req, res) => {
    try {
      const result = await fetchConversationList();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/cdp/conversations/select', requireAuth, async (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ ok: false, error: 'missing title' });
    try {
      const result = await selectConversation(title);
      if (result.ok || result.results?.some(r => r.value?.ok)) {
        state.messages = [];
        saveState();
        broadcast('messages_cleared', {});
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });


  let lastProbeHash = '';
  let cachedConversation = null;
  let monitorActive = false;
  let monitorInterval = null;

  async function pollConversation() {
    if (monitorActive) return;
    monitorActive = true;

    try {
      const probe = await fetchConversationProbe();
      if (!probe.ok || !probe.results?.length) {
        monitorActive = false;
        return;
      }

      const probeData = probe.results[0]?.value;
      if (!probeData) {
        monitorActive = false;
        return;
      }

      const probeHash = `${probeData.totalSteps}:${probeData.groupCount}:${probeData.lastText}:${probeData.statusText}:${probeData.isBusy}:${probeData.currentModel}`;

      if (probeHash === lastProbeHash && cachedConversation) {
        monitorActive = false;
        return;
      }

      lastProbeHash = probeHash;

      const result = await fetchConversation();
      if (!result.ok || !result.results?.length) {
        monitorActive = false;
        return;
      }

      const data = result.results[0]?.value;
      if (!data || !data.items) {
        monitorActive = false;
        return;
      }

      const prevLength = cachedConversation?.items?.length || 0;
      cachedConversation = data;

      if (prevLength === 0) {
        broadcast('conversation_full', { items: data.items, turnCount: data.turnCount, statusText: data.statusText });
      } else if (data.items.length > prevLength) {
        broadcast('conversation_append', { items: data.items.slice(prevLength), total: data.items.length, statusText: data.statusText });
      } else {
        broadcast('conversation_full', { items: data.items, turnCount: data.turnCount, statusText: data.statusText });
      }

      const statusText = probeData.statusText || '';
      const isRunning = probeData.isBusy ?? (statusText.includes('Running') || statusText.includes('Generating') || statusText.includes('Working') || statusText.includes('Loading'));
      const agentState = isRunning ? 'working' : 'idle';
      const currentModel = probeData.currentModel || '';
      const { hasAcceptAll, hasRejectAll } = probeData;

      if (state.agent.state !== agentState || state.agent.statusText !== statusText || state.agent.model !== currentModel || state.agent.hasAcceptAll !== hasAcceptAll || state.agent.hasRejectAll !== hasRejectAll) {
        state.agent.state = agentState;
        state.agent.statusText = statusText;
        state.agent.model = currentModel;
        state.agent.hasAcceptAll = hasAcceptAll;
        state.agent.hasRejectAll = hasRejectAll;
        state.agent.lastSeen = new Date().toISOString();
        broadcast('agent_status', { ...state.agent, statusText, model: currentModel, hasAcceptAll, hasRejectAll });
        saveState();
      }
    } catch { }

    monitorActive = false;
  }

  function sendCachedConversation(ws) {
    if (cachedConversation && ws.readyState === 1) {
      ws.send(JSON.stringify({
        event: 'conversation_full',
        payload: { items: cachedConversation.items, turnCount: cachedConversation.turnCount },
        ts: new Date().toISOString(),
      }));
    }
  }

  function startConversationMonitor() {
    if (monitorInterval) return;
    monitorInterval = setInterval(pollConversation, 100);
    pollConversation();
    log('MONITOR', 'Conversation monitor started (500ms interval)');
  }

  startConversationMonitor();

  return { PAIRING_CODE, sendCachedConversation };
}
