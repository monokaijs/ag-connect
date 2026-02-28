'use strict';

const http = require('http');
const WebSocket = require('ws');

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

class CdpProxy {
  constructor(port) {
    this.port = port;
    this.host = '127.0.0.1';
  }

  async getTargets() {
    try {
      var list = await getJson('http://' + this.host + ':' + this.port + '/json/list');
      return list.map(function (t) {
        return Object.assign({}, t, {
          wsUrl: t.webSocketDebuggerUrl
            ? t.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, '127.0.0.1:' + this.port)
            : null,
        });
      }.bind(this));
    } catch (e) {
      return [];
    }
  }

  async screenshot() {
    var targets = await this.getTargets();
    var found = targets.find(function (t) { return t.url && t.url.includes('workbench'); });
    if (!found) found = targets[0];
    if (!found || !found.wsUrl) {
      throw new Error('No CDP target found');
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(found.wsUrl);
      const timer = setTimeout(() => { ws.close(); reject(new Error('screenshot_timeout')); }, 10000);

      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      ws.on('open', () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Page.captureScreenshot',
          params: { format: 'png', quality: 80 },
        }));
      });
      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data.id === 1) {
            clearTimeout(timer);
            ws.close();
            if (data.error) reject(new Error(data.error.message));
            else resolve(data.result.data);
          }
        } catch (e) { }
      });
    });
  }

  async evaluate(expression, options) {
    options = options || {};
    var targets = await this.getTargets();
    var filter = options.target || 'launchpad';

    // Find the right target
    var found = null;
    if (filter === 'launchpad' || filter === 'agent') {
      found = targets.find(function (t) { return t.url && t.url.includes('workbench-jetski-agent.html'); });
    }
    if (!found) found = targets.find(function (t) { return t.url && t.url.includes('workbench.html'); });
    if (!found) found = targets.find(function (t) { return t.url && t.url.includes('workbench'); });
    if (!found) found = targets[0];
    if (!found || !found.wsUrl) {
      throw new Error('No CDP target found');
    }

    // Connect and eval
    return this._connectAndEval(found.wsUrl, expression, options.timeout || 10000);
  }

  _connectAndEval(wsUrl, expression, timeout) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let idCounter = 1;
      const contexts = [];
      let settled = false;

      const done = (err, val) => {
        if (settled) return;
        settled = true;
        ws.close();
        if (err) reject(err);
        else resolve(val);
      };

      const timer = setTimeout(() => done(new Error('CDP eval timeout')), timeout + 5000);

      ws.on('error', (err) => done(err));
      ws.on('open', () => {
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
          setTimeout(() => { ws.removeListener('message', handler); rej(new Error('RPC timeout')); }, timeout);
          ws.send(JSON.stringify({ id: id, method: method, params: params }));
        });

        ws.on('message', (raw) => {
          try {
            const data = JSON.parse(raw.toString());
            if (data.method === 'Runtime.executionContextCreated') {
              contexts.push(data.params.context);
            }
          } catch (e) { }
        });

        call('Runtime.enable', {}).then(() => {
          return new Promise((r) => setTimeout(r, 800));
        }).then(async () => {
          const results = [];
          for (const ctx of contexts) {
            try {
              const evalResult = await call('Runtime.evaluate', {
                expression: expression,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id,
              });
              const val = evalResult.result && evalResult.result.value;
              if (val !== undefined && val !== null) {
                results.push({ contextId: ctx.id, value: val });
                if (val.ok === true || val.turnCount !== undefined || val.models !== undefined) {
                  break;
                }
              }
            } catch (e) { }
          }
          clearTimeout(timer);
          done(null, { ok: true, results: results });
        }).catch((err) => {
          clearTimeout(timer);
          done(err);
        });
      });
    });
  }

  async startScreencast(targetId, qualityPreset, onFrame) {
    if (this._screencastWs) await this.stopScreencast();

    var targets = await this.getTargets();
    var found = targetId ? targets.find(function (t) { return t.id === targetId; }) : null;
    if (!found) found = targets.find(function (t) { return t.url && t.url.includes('workbench'); });
    if (!found) found = targets[0];
    if (!found || !found.wsUrl) throw new Error('No CDP target found');

    this._screencastWs = new WebSocket(found.wsUrl);
    this._screencastMsgId = 1;
    this._screencastCallbacks = new Map();

    const sendCdp = (method, params) => {
      const id = this._screencastMsgId++;
      return new Promise((resolve, reject) => {
        this._screencastCallbacks.set(id, { resolve, reject });
        if (this._screencastWs.readyState === WebSocket.OPEN) {
          this._screencastWs.send(JSON.stringify({ id: id, method: method, params: params }));
        } else {
          reject(new Error('CDP not ready'));
        }
      });
    };
    this._screencastSend = sendCdp;

    this._screencastWs.on('open', async () => {
      await sendCdp('Page.enable', {});
      await sendCdp('Page.startScreencast', Object.assign({
        format: 'jpeg',
        everyNthFrame: 1,
      }, qualityPreset));
    });

    this._screencastWs.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.id && this._screencastCallbacks.has(data.id)) {
          const cb = this._screencastCallbacks.get(data.id);
          this._screencastCallbacks.delete(data.id);
          if (data.error) cb.reject(new Error(data.error.message));
          else cb.resolve(data.result);
        } else if (data.method === 'Page.screencastFrame') {
          const params = data.params;
          if (onFrame) onFrame(params.data, params.metadata, params.sessionId);
          sendCdp('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(function () { });
        }
      } catch (err) { }
    });
  }

  async stopScreencast() {
    if (this._screencastSend) {
      try { await this._screencastSend('Page.stopScreencast', {}); } catch (e) { }
    }
    if (this._screencastWs) {
      this._screencastWs.close();
      this._screencastWs = null;
    }
    this._screencastSend = null;
  }

  async applyInput(type, params) {
    if (this._screencastSend) {
      if (type === 'mouse') await this._screencastSend('Input.dispatchMouseEvent', params);
      else if (type === 'key') await this._screencastSend('Input.dispatchKeyEvent', params);
    }
  }
}

module.exports = { CdpProxy };
