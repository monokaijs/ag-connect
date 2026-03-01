'use strict';

const { spawn, execSync } = require('child_process');
const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

function detectIdePath() {
  const platform = os.platform();
  const candidates = [];

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity',
      '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
      path.join(os.homedir(), 'Applications/Antigravity.app/Contents/Resources/app/bin/antigravity'),
    );
  } else if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(
      path.join(programFiles, 'Antigravity', 'bin', 'antigravity.cmd'),
      path.join(programFiles, 'Antigravity', 'antigravity.exe'),
      path.join(localAppData, 'Programs', 'Antigravity', 'bin', 'antigravity.cmd'),
      path.join(localAppData, 'Programs', 'Antigravity', 'antigravity.exe'),
    );
  } else {
    candidates.push(
      '/usr/bin/antigravity',
      '/usr/local/bin/antigravity',
      '/snap/bin/antigravity',
      path.join(os.homedir(), '.local/bin/antigravity'),
    );
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log('Found Antigravity at: ' + p);
      return p;
    }
  }

  try {
    const which = platform === 'win32' ? 'where antigravity' : 'which antigravity';
    const result = execSync(which, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (result) {
      console.log('Found Antigravity in PATH: ' + result.split('\n')[0]);
      return result.split('\n')[0];
    }
  } catch { }

  return null;
}

class IdeManager {
  constructor(folder, idePath) {
    this.folder = folder;
    this.idePath = idePath || null;
    this.process = null;
    this.cdpPort = 0;
  }

  async start() {
    const port = await findFreePort();
    this.cdpPort = port;

    const bin = this.idePath || detectIdePath();
    if (!bin) {
      throw new Error(
        'Antigravity IDE not found. Install it or specify the path with --ide-path.\n'
        + '  Searched: ' + os.platform() + ' default paths and PATH'
      );
    }

    this._killExisting();

    const extSrc = path.join(__dirname, '..', 'extensions', 'ag-connect-helper');
    const platform = os.platform();
    let extDir;
    if (platform === 'darwin') {
      extDir = path.join(os.homedir(), '.config', 'Antigravity', 'extensions');
    } else if (platform === 'win32') {
      extDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity', 'extensions');
    } else {
      extDir = path.join(os.homedir(), '.config', 'Antigravity', 'extensions');
    }
    const extDest = path.join(extDir, 'ag-connect-helper');
    try {
      fs.mkdirSync(extDir, { recursive: true });
      if (fs.existsSync(extSrc)) {
        fs.cpSync(extSrc, extDest, { recursive: true, force: true });
        console.log('Installed ag-connect-helper extension');
      }
    } catch (e) {
      console.log('Warning: could not install helper extension:', e.message);
    }

    const folderUri = 'file://' + path.resolve(this.folder);
    console.log('Spawning: ' + bin + ' (CDP port ' + port + ')');

    this.process = spawn(bin, [
      '--remote-debugging-port=' + port,
      '--folder-uri=' + folderUri,
      '--wait',
      '--new-window',
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

  _killExisting() {
    try {
      const platform = os.platform();
      if (platform === 'win32') {
        execSync('taskkill /F /IM Antigravity.exe 2>nul', { stdio: 'ignore' });
      } else {
        execSync("pkill -f '[Aa]ntigravity' 2>/dev/null || true", { stdio: 'ignore' });
      }
      console.log('Terminated existing Antigravity processes');
    } catch { }
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
