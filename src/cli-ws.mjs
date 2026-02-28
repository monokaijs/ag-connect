import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { Workspace } from './models/workspace.mjs';

/**
 * Manages WebSocket connections from CLI clients.
 * Each CLI client connects to the server and proxies CDP requests
 * for its local IDE instance.
 */

/** Map<workspaceId, WebSocket> */
const cliClients = new Map();

/** Map<requestId, { resolve, reject, timer }> */
const pendingRequests = new Map();

let requestIdCounter = 0;
let _broadcast = null;

function setBroadcast(fn) {
  _broadcast = fn;
}

const cliWss = new WebSocketServer({ noServer: true });

cliWss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const workspaceId = url.searchParams.get('workspaceId');

  if (!workspaceId) {
    ws.close(1008, 'Missing workspaceId');
    return;
  }

  console.log(`[cli-ws] CLI client connected for workspace ${workspaceId}`);
  cliClients.set(workspaceId, ws);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleCliMessage(workspaceId, msg);
    } catch (err) {
      console.error('[cli-ws] Parse error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[cli-ws] CLI client disconnected for workspace ${workspaceId}`);
    if (cliClients.get(workspaceId) === ws) {
      cliClients.delete(workspaceId);
      Workspace.findById(workspaceId).then(w => {
        if (!w || w.status === 'stopped') return;
        w.status = 'stopped';
        w.stage = '';
        w.save().then(() => {
          if (_broadcast) {
            _broadcast({
              event: 'workspace:status',
              payload: { id: workspaceId, status: 'stopped', stage: '' },
            });
          }
        });
      }).catch(() => { });
    }
  });

  ws.on('error', () => {
    cliClients.delete(workspaceId);
  });
});

function handleCliMessage(workspaceId, msg) {
  switch (msg.event) {
    case 'cli:ready': {
      console.log(`[cli-ws] Workspace ${workspaceId} is ready (CDP port ${msg.payload?.cdpPort})`);
      Workspace.findById(workspaceId).then(ws => {
        if (!ws) return;
        ws.status = 'running';
        ws.stage = '';
        ws.cliPort = msg.payload?.cdpPort || 0;
        ws.save().then(() => {
          if (_broadcast) {
            _broadcast({
              event: 'workspace:status',
              payload: { id: workspaceId, status: 'running', stage: '' },
            });
          }
        });
      }).catch(err => console.error('[cli-ws] Error updating workspace:', err.message));
      break;
    }

    case 'cli:stopped': {
      console.log(`[cli-ws] Workspace ${workspaceId} stopped`);
      Workspace.findById(workspaceId).then(ws => {
        if (!ws) return;
        ws.status = 'stopped';
        ws.stage = '';
        ws.cliPort = 0;
        ws.save().then(() => {
          if (_broadcast) {
            _broadcast({
              event: 'workspace:status',
              payload: { id: workspaceId, status: 'stopped', stage: '' },
            });
          }
        });
      }).catch(err => console.error('[cli-ws] Error updating workspace:', err.message));
      break;
    }

    case 'cdp:eval:result':
    case 'cdp:targets:result':
    case 'cdp:screenshot:result':
    case 'cli:exec:result': {
      const requestId = msg.payload?.requestId;
      const pending = pendingRequests.get(requestId);
      if (pending) {
        pendingRequests.delete(requestId);
        clearTimeout(pending.timer);
        if (msg.payload.error) {
          pending.reject(new Error(msg.payload.error));
        } else {
          pending.resolve(msg.payload.result || msg.payload.targets || msg.payload.data || msg.payload.output);
        }
      }
      break;
    }

    case 'pong': {
      // heartbeat response
      break;
    }
  }
}

/**
 * Send a CDP eval request to the CLI client and wait for the result.
 */
function cliCdpEval(workspaceId, expression, options) {
  const ws = cliClients.get(workspaceId);
  if (!ws || ws.readyState !== 1) {
    return Promise.reject(new Error('CLI client not connected'));
  }

  const requestId = 'cdp-' + (++requestIdCounter);
  const timeout = (options && options.timeout) || 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('CLI CDP eval timeout'));
    }, timeout);

    pendingRequests.set(requestId, { resolve, reject, timer });

    ws.send(JSON.stringify({
      event: 'cdp:eval',
      payload: {
        requestId,
        expression,
        options,
      },
    }));
  });
}

/**
 * Get CDP targets from CLI client.
 */
function cliGetTargets(workspaceId) {
  const ws = cliClients.get(workspaceId);
  if (!ws || ws.readyState !== 1) {
    return Promise.resolve([]);
  }

  const requestId = 'targets-' + (++requestIdCounter);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve([]);
    }, 10000);

    pendingRequests.set(requestId, { resolve, reject, timer });

    ws.send(JSON.stringify({
      event: 'cdp:targets',
      payload: { requestId },
    }));
  });
}

/**
 * Send a command to the CLI client (stop, restart, etc.)
 */
function cliSendCommand(workspaceId, event, payload) {
  const ws = cliClients.get(workspaceId);
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify({ event, payload }));
  return true;
}

/**
 * Check if a CLI client is connected.
 */
function isCliConnected(workspaceId) {
  const ws = cliClients.get(workspaceId);
  return ws && ws.readyState === 1;
}

function cliExec(workspaceId, command, timeout) {
  const ws = cliClients.get(workspaceId);
  if (!ws || ws.readyState !== 1) {
    return Promise.reject(new Error('CLI client not connected'));
  }

  const requestId = 'exec-' + (++requestIdCounter);
  const t = timeout || 5000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('CLI exec timeout'));
    }, t);

    pendingRequests.set(requestId, { resolve, reject, timer });

    ws.send(JSON.stringify({
      event: 'cli:exec',
      payload: { requestId, command, timeout: t },
    }));
  });
}

export {
  cliWss,
  cliClients,
  cliCdpEval,
  cliGetTargets,
  cliSendCommand,
  isCliConnected,
  setBroadcast,
  cliExec,
};
