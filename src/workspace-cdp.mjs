import WebSocket from 'ws';

async function getTargetsOnPort(port, host) {
  const h = host || '127.0.0.1';
  try {
    const res = await fetch(`http://${h}:${port}/json/list`);
    const list = await res.json();
    return list.map(t => ({
      ...t,
      wsUrl: t.webSocketDebuggerUrl
        ? t.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `${h}:${port}`)
        : null,
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

async function connectAndEval(wsUrl, expression, timeout = 10000, evaluateAll = false) {
  const ws = new WebSocket(wsUrl);
  const results = [];

  try {
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('ws_connect_timeout')), 5000);
    });

    let idCounter = 1;
    const call = (method, params) => new Promise((res, rej) => {
      const id = idCounter++;
      const handler = (raw) => {
        const data = JSON.parse(raw.toString());
        if (data.id === id) {
          ws.removeListener('message', handler);
          if (data.error) rej(data.error);
          else res(data.result);
        }
      };
      ws.on('message', handler);
      setTimeout(() => { ws.removeListener('message', handler); rej(new Error('rpc_timeout')); }, timeout);
      ws.send(JSON.stringify({ id, method, params }));
    });

    const contexts = [];
    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.method === 'Runtime.executionContextCreated') {
          contexts.push(data.params.context);
        }
      } catch { }
    });

    await call('Runtime.enable', {});
    await new Promise(r => setTimeout(r, 500));

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
          if (!evaluateAll) {
            if (val.ok === true || val.turnCount !== undefined || val.models !== undefined) {
              break;
            }
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
  const results = await connectAndEval(target.wsUrl, expression, opts.timeout || 10000, opts.evaluateAll || false);
  return { ok: true, results };
}

async function cdpEvalOnAllTargets(port, expression, opts = {}) {
  const allTargets = await getTargetsOnPort(port, opts.host);
  const workbenchTargets = allTargets.filter(t =>
    (t.type === 'page' || t.type === 'app') &&
    t.url?.includes('workbench') &&
    !t.title?.toLowerCase().includes('launchpad') &&
    t.wsUrl
  );
  const promises = workbenchTargets.map(t =>
    connectAndEval(t.wsUrl, expression, opts.timeout || 10000, true).catch(() => [])
  );
  const settled = await Promise.all(promises);
  const allResults = settled.flat();
  return { ok: true, results: allResults };
}

const FOLDER_EXPR = [
  '(function(){',
  'if(window.__workspaceFolder)return window.__workspaceFolder;',
  'try{var p=typeof vscode!=="undefined"&&vscode.process&&vscode.process.env&&vscode.process.env.PWD;',
  'if(p){window.__workspaceFolder=p;return p;}}catch(e){}',
  'try{var u=new URL(window.location.href);var f=u.searchParams.get("folder");',
  'if(f){window.__workspaceFolder=f;return f;}}catch(e){}',
  'try{var lbls=Array.from(document.querySelectorAll("[aria-label]")).map(x=>x.getAttribute("aria-label")).filter(x=>x&&x.startsWith("/host/"));',
  'if(lbls.length){var path=lbls[0];var folder=path.substring(0,path.lastIndexOf("/"));',
  'window.__workspaceFolder=folder;return folder;}}catch(e){}',
  'return "";',
  '})()'
].join('');

async function getTargetWorkspaceFolders(port, host) {
  const allTargets = await getTargetsOnPort(port, host);
  const workbenchTargets = allTargets.filter(t =>
    (t.type === 'page' || t.type === 'app') &&
    t.url?.includes('workbench') &&
    !t.title?.toLowerCase().includes('launchpad') &&
    t.wsUrl
  );

  const results = {};
  for (const t of workbenchTargets) {
    try {
      const r = await connectAndEval(t.wsUrl, FOLDER_EXPR, 5000);
      if (r.length > 0 && r[0].value) {
        results[t.id] = r[0].value;
      }
    } catch { }
  }
  return results;
}

export { cdpEvalOnPort, cdpEvalOnAllTargets, findTargetOnPort, getTargetsOnPort, getTargetWorkspaceFolders, connectAndEval, FOLDER_EXPR };
