import http from 'http';
import { WebSocket } from 'ws';

const CDP_HOST = process.env.HOST_MOUNT_POINT ? 'host.docker.internal' : '127.0.0.1';

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function getTargetsOnPort(port, host) {
  const h = host || CDP_HOST;
  try {
    const list = await getJson(`http://${h}:${port}/json/list`);
    return list.map(t => ({
      ...t,
      wsUrl: t.webSocketDebuggerUrl ? t.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `${h}:${port}`) : null
    }));
  } catch {
    return [];
  }
}

async function findTargetOnPort(port, filter = 'launchpad', host) {
  const list = await getTargetsOnPort(port, host);
  let found;
  if (filter && typeof filter === 'object' && filter.id) {
    found = list.find(t => t.id === filter.id);
  } else if (filter === 'launchpad' || filter === 'agent') {
    found = list.find(t => t.url?.includes('workbench-jetski-agent.html'));
  }
  if (!found) {
    found = list.find(t => t.url?.includes('workbench.html'));
  }
  if (!found) {
    found = list.find(t => t.url?.includes('workbench'));
  }
  if (!found) found = list[0];
  if (!found?.wsUrl) return null;
  return { target: found, wsUrl: found.wsUrl, port };
}

async function connectAndEval(wsUrl, expression, timeout = 10000) {
  const ws = new WebSocket(wsUrl);
  try {
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('ws_connect_timeout')), 5000);
    });

    let idCounter = 1;
    const contexts = [];

    const call = (method, params) => new Promise((resolve, reject) => {
      const id = idCounter++;
      const handler = (raw) => {
        const data = JSON.parse(raw.toString());
        if (data.id === id) { ws.off('message', handler); if (data.error) reject(data.error); else resolve(data.result); }
      };
      ws.on('message', handler);
      setTimeout(() => { ws.off('message', handler); reject(new Error('RPC Timeout')); }, timeout);
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.method === 'Runtime.executionContextCreated') contexts.push(data.params.context);
      } catch { }
    });

    await call('Runtime.enable', {});
    await new Promise(r => setTimeout(r, 800));

    const results = [];
    for (const ctx of contexts) {
      try {
        const evalResult = await call('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
          contextId: ctx.id,
        });
        const val = evalResult.result?.value;
        if (val !== undefined && val !== null) {
          results.push({ contextId: ctx.id, value: val });

          // Stop evaluating in other contexts if this one found the target DOM elements
          // or successfully performed the action (preventing multiple clicks in shared DOM)
          if (val.ok === true || val.turnCount !== undefined || val.models !== undefined || val.conversations !== undefined) {
            break;
          }
        }
      } catch { }
    }
    return results;
  } finally {
    ws.close();
  }
}

async function cdpEvalOnPort(port, expression, opts = {}) {
  const target = await findTargetOnPort(port, opts.target || 'launchpad', opts.host);
  if (!target) return { ok: false, error: 'cdp_not_found' };
  const results = await connectAndEval(target.wsUrl, expression, opts.timeout || 10000);
  return { ok: true, results };
}

export { cdpEvalOnPort, findTargetOnPort, getTargetsOnPort };
