'use strict';

const { spawn } = require('child_process');
const net = require('net');
const http = require('http');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function waitForCdp(port, timeoutSecs) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      const req = http.get('http://127.0.0.1:' + port + '/json/version', (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(true);
          } else if (++attempts < timeoutSecs) {
            setTimeout(check, 1000);
          } else {
            resolve(false);
          }
        });
      });
      req.on('error', () => {
        if (++attempts < timeoutSecs) {
          setTimeout(check, 1000);
        } else {
          resolve(false);
        }
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (++attempts < timeoutSecs) {
          setTimeout(check, 1000);
        } else {
          resolve(false);
        }
      });
    };
    check();
  });
}

class IdeManager {
  constructor(folder) {
    this.folder = folder;
    this.process = null;
    this.cdpPort = 0;
  }

  async start() {
    const port = await findFreePort();
    this.cdpPort = port;

    console.log('Spawning Antigravity IDE (CDP port ' + port + ')...');

    this.process = spawn('antigravity', [
      '--remote-debugging-port=' + port,
      '--folder', this.folder,
    ], {
      cwd: this.folder,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        DISPLAY: process.env.DISPLAY || ':0',
      }),
      detached: false,
    });

    this.process.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) console.log('[ide] ' + line);
    });

    this.process.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) console.log('[ide] ' + line);
    });

    this.process.on('exit', (code, signal) => {
      console.log('[ide] Process exited: code=' + code + ' signal=' + signal);
      this.process = null;
    });

    this.process.on('error', (err) => {
      console.error('[ide] Process error:', err.message);
      this.process = null;
    });

    // Wait for CDP to become available
    console.log('Waiting for IDE to be ready...');
    const ready = await waitForCdp(port, 120);
    if (!ready) {
      throw new Error('Antigravity IDE did not start within 120 seconds. Is "antigravity" installed?');
    }

    return port;
  }

  async stop() {
    if (!this.process) return;

    try {
      this.process.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 2000));
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }
    } catch (e) {
      // already dead
    }
    this.process = null;
  }
}

module.exports = { IdeManager };
