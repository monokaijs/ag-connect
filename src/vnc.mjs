import { WebSocketServer } from 'ws';
import { Workspace } from './models/workspace.mjs';
import { findTargetOnPort } from './workspace-cdp.mjs';

const QUALITY_PRESETS = {
  '480p': { maxWidth: 854, maxHeight: 480, quality: 40 },
  '720p': { maxWidth: 1280, maxHeight: 720, quality: 55 },
  '1080p': { maxWidth: 1920, maxHeight: 1080, quality: 70 },
};

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

    const { WebSocket } = await import('ws');
    const cdpWs = new WebSocket(target.wsUrl);

    let msgId = 1;
    const callbacks = new Map();
    let currentQuality = '720p';

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

    const startScreencast = async (preset) => {
      const p = QUALITY_PRESETS[preset] || QUALITY_PRESETS['720p'];
      currentQuality = preset;
      try {
        await sendCdp('Page.stopScreencast', {});
      } catch { }
      await sendCdp('Page.startScreencast', {
        format: 'jpeg',
        quality: p.quality,
        maxWidth: p.maxWidth,
        maxHeight: p.maxHeight,
        everyNthFrame: 1,
      });
    };

    cdpWs.on('open', async () => {
      await sendCdp('Page.enable', {});
      await startScreencast(currentQuality);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'quality', quality: currentQuality }));
      }
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
          const params = data.params;
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'frame', data: params.data, metadata: params.metadata, sessionId: params.sessionId }));
          }
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
        } else if (msg.type === 'quality') {
          const preset = msg.quality;
          if (QUALITY_PRESETS[preset]) {
            await startScreencast(preset);
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'quality', quality: preset }));
            }
          }
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
