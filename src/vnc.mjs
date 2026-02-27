import { WebSocketServer } from 'ws';
import { Workspace } from './models/workspace.mjs';
import { findTargetOnPort } from './workspace-cdp.mjs';

export const vncWss = new WebSocketServer({ noServer: true });

vncWss.on('connection', async (ws, request) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const match = url.pathname.match(/\/api\/workspaces\/([^\/]+)\/cdp\/vnc/);
    if (!match) {
      ws.close(1008, 'Invalid URL');
      return;
    }
    const workspaceId = match[1];
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace || (!workspace.ports?.debug && !workspace.cdpPort)) {
      ws.close(1008, 'Workspace not found or not running');
      return;
    }

    const cdpPort = workspace.cdpPort || workspace.ports.debug;
    const cdpHost = workspace.cdpHost || undefined;
    const targetId = url.searchParams.get('targetId');
    const target = await findTargetOnPort(cdpPort, targetId ? { id: targetId } : 'workbench', cdpHost);
    if (!target) {
      ws.close(1008, 'CDP target not found');
      return;
    }

    // Connect to CDP WebSocket
    const { WebSocket } = await import('ws');
    const cdpWs = new WebSocket(target.wsUrl);

    let msgId = 1;
    const callbacks = new Map();

    const sendCdp = (method, params) => {
      const id = msgId++;
      return new Promise((resolve, reject) => {
        callbacks.set(id, { resolve, reject });
        if (cdpWs.readyState === 1) {
          cdpWs.send(JSON.stringify({ id, method, params }));
        } else {
          reject(new Error('CDP not ready'));
        }
      });
    };

    cdpWs.on('open', async () => {
      await sendCdp('Page.enable', {});
      await sendCdp('Page.startScreencast', { format: 'jpeg', quality: 50, everyNthFrame: 1 });
    });

    cdpWs.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.id && callbacks.has(data.id)) {
          const { resolve, reject } = callbacks.get(data.id);
          callbacks.delete(data.id);
          if (data.error) reject(new Error(data.error.message));
          else resolve(data.result);
        } else if (data.method === 'Page.screencastFrame') {
          // Send frame to frontend
          const params = data.params;
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'frame', data: params.data, metadata: params.metadata, sessionId: params.sessionId }));
          }
          // Ack frame
          sendCdp('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => { });
        }
      } catch (err) {
        console.error('CDP Parser Error:', err);
      }
    });

    cdpWs.on('close', () => {
      if (ws.readyState === 1) ws.close(1000, 'CDP closed');
    });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'mouse') {
          await sendCdp('Input.dispatchMouseEvent', msg.params);
        } else if (msg.type === 'key') {
          await sendCdp('Input.dispatchKeyEvent', msg.params);
        }
      } catch (err) {
        console.error('WS client message error:', err);
      }
    });

    ws.on('close', () => {
      if (cdpWs.readyState === 1) {
        sendCdp('Page.stopScreencast', {}).catch(() => { });
        setTimeout(() => { if (cdpWs.readyState === 1) cdpWs.close(); }, 100);
      }
    });
  } catch (err) {
    ws.close(1011, err.message);
  }
});
