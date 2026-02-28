'use strict';

const WebSocket = require('ws');
const { IdeManager } = require('./ide-manager');
const { CdpProxy } = require('./cdp-proxy');

class AgConnectClient {
  constructor({ serverUrl, token, folder, name, workspaceId, idePath }) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.token = token;
    this.folder = folder;
    this.name = name;
    this.ws = null;
    this.workspaceId = workspaceId || null;
    this.ide = new IdeManager(folder, idePath);
    this.cdpProxy = null;
    this.reconnectTimer = null;
    this.running = true;
  }

  async connect() {
    if (this.workspaceId) {
      console.log('Connecting to existing workspace: ' + this.workspaceId);
    } else {
      console.log('Registering workspace on server...');
      const workspace = await this._registerWorkspace();
      this.workspaceId = workspace._id;
      console.log('Workspace registered: ' + this.workspaceId);
    }

    // 2. Start Antigravity IDE locally
    console.log('Starting Antigravity IDE...');
    const cdpPort = await this.ide.start();
    console.log('IDE running on CDP port ' + cdpPort);

    // 3. Set up CDP proxy
    this.cdpProxy = new CdpProxy(cdpPort);

    // 4. Connect WebSocket to server
    await this._connectWs();

    // 5. Notify server that we're ready
    await this._notifyReady(cdpPort);

    console.log('');
    console.log('✓ Connected and ready!');
    console.log('  Open ' + this.serverUrl + ' to manage this workspace.');
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  }

  async _registerWorkspace() {
    const res = await fetch(this.serverUrl + '/api/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.token,
      },
      body: JSON.stringify({
        name: this.name,
        type: 'cli',
        mountedPath: this.folder,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error('Failed to register workspace: ' + res.status + ' ' + body);
    }

    return res.json();
  }

  _connectWs() {
    return new Promise((resolve, reject) => {
      const wsProtocol = this.serverUrl.startsWith('https') ? 'wss' : 'ws';
      const wsBase = this.serverUrl.replace(/^https?/, wsProtocol);
      const wsUrl = wsBase + '/api/cli-ws?token=' + encodeURIComponent(this.token) + '&workspaceId=' + this.workspaceId;

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('WebSocket connected to server');
        resolve();
      });

      this.ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          await this._handleServerMessage(msg);
        } catch (err) {
          console.error('Message handling error:', err.message);
        }
      });

      this.ws.on('close', () => {
        console.log('WebSocket disconnected');
        if (this.running) {
          this._scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        if (this.ws.readyState === WebSocket.CONNECTING) {
          reject(err);
        }
      });
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log('Reconnecting in 3s...');
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this._connectWs();
        await this._notifyReady(this.ide.cdpPort);
        console.log('Reconnected!');
      } catch (e) {
        this._scheduleReconnect();
      }
    }, 3000);
  }

  async _notifyReady(cdpPort) {
    this._send({
      event: 'cli:ready',
      payload: {
        workspaceId: this.workspaceId,
        cdpPort: cdpPort,
        folder: this.folder,
      },
    });

    // Also update workspace on server via REST
    await fetch(this.serverUrl + '/api/workspaces/' + this.workspaceId, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.token,
      },
      body: JSON.stringify({
        cdpPort: cdpPort,
        cliPort: cdpPort,
      }),
    }).catch(function () { });
  }

  async _handleServerMessage(msg) {
    switch (msg.event) {
      case 'cdp:eval': {
        var payload = msg.payload;
        try {
          var result = await this.cdpProxy.evaluate(payload.expression, payload.options);
          this._send({
            event: 'cdp:eval:result',
            payload: { requestId: payload.requestId, result: result },
          });
        } catch (err) {
          this._send({
            event: 'cdp:eval:result',
            payload: { requestId: payload.requestId, error: err.message },
          });
        }
        break;
      }

      case 'cdp:targets': {
        try {
          var targets = await this.cdpProxy.getTargets();
          this._send({
            event: 'cdp:targets:result',
            payload: { requestId: msg.payload.requestId, targets: targets },
          });
        } catch (err) {
          this._send({
            event: 'cdp:targets:result',
            payload: { requestId: msg.payload.requestId, error: err.message },
          });
        }
        break;
      }

      case 'cdp:screenshot': {
        try {
          var data = await this.cdpProxy.screenshot();
          this._send({
            event: 'cdp:screenshot:result',
            payload: { requestId: msg.payload.requestId, data: data },
          });
        } catch (err) {
          this._send({
            event: 'cdp:screenshot:result',
            payload: { requestId: msg.payload.requestId, error: err.message },
          });
        }
        break;
      }

      case 'cdp:vnc:start': {
        try {
          await this.cdpProxy.startScreencast(msg.payload.targetId, msg.payload.qualityPreset, (data, metadata, sessionId) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({
                event: 'cdp:vnc:frame',
                payload: { data: data, metadata: metadata, sessionId: sessionId },
              }));
            }
          });
        } catch (err) { }
        break;
      }

      case 'cdp:vnc:stop': {
        await this.cdpProxy.stopScreencast();
        break;
      }

      case 'cdp:vnc:input': {
        await this.cdpProxy.applyInput(msg.payload.inputType, msg.payload.params);
        break;
      }

      case 'workspace:stop': {
        console.log('Server requested stop');
        await this.ide.stop();
        this._send({
          event: 'cli:stopped',
          payload: { workspaceId: this.workspaceId },
        });
        break;
      }

      case 'workspace:restart': {
        console.log('Server requested restart');
        await this.ide.stop();
        var port = await this.ide.start();
        this.cdpProxy = new CdpProxy(port);
        await this._notifyReady(port);
        break;
      }

      case 'ping': {
        this._send({ event: 'pong' });
        break;
      }

      case 'cli:exec': {
        var execPayload = msg.payload;
        try {
          var { execSync } = require('child_process');
          var output = execSync(execPayload.command, {
            encoding: 'utf8',
            timeout: execPayload.timeout || 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          this._send({
            event: 'cli:exec:result',
            payload: { requestId: execPayload.requestId, output: output },
          });
        } catch (err) {
          this._send({
            event: 'cli:exec:result',
            payload: { requestId: execPayload.requestId, output: err.stdout || '', error: err.message },
          });
        }
        break;
      }
    }
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  async disconnect() {
    this.running = false;
    clearTimeout(this.reconnectTimer);

    if (this.workspaceId) {
      await fetch(this.serverUrl + '/api/workspaces/' + this.workspaceId + '/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.token,
        },
      }).catch(function () { });
    }

    await this.ide.stop();

    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = { AgConnectClient };
