const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CMD_FILE = path.join(os.tmpdir(), 'ag-connect-cmd.json');
const CSRF_FILE = path.join(os.tmpdir(), 'ag-connect-csrf.json');

function discoverCsrf() {
  try {
    const ps = execSync('ps aux 2>/dev/null || tasklist 2>nul', { encoding: 'utf8', timeout: 3000 });
    const lines = ps.split('\n').filter(l => l.includes('--csrf_token'));
    const results = [];
    for (const line of lines) {
      const cm = line.match(/--csrf_token\s+([a-f0-9-]+)/);
      const pm = line.match(/--grpc_server_port\s+(\d+)/);
      const em = line.match(/--extension_server_port\s+(\d+)/);
      if (cm) {
        results.push({
          csrf: cm[1],
          grpcPort: pm ? pm[1] : null,
          extPort: em ? em[1] : null,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

function writeCsrfFile() {
  try {
    const tokens = discoverCsrf();
    fs.writeFileSync(CSRF_FILE, JSON.stringify({ tokens, ts: Date.now() }), 'utf8');
  } catch { }
}

function activate(context) {
  writeCsrfFile();
  const interval = setInterval(writeCsrfFile, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  context.subscriptions.push(
    vscode.commands.registerCommand('ag-connect.getCsrf', () => {
      const tokens = discoverCsrf();
      return { tokens };
    })
  );

  const processCommand = () => {
    try {
      if (!fs.existsSync(CMD_FILE)) return;
      const raw = fs.readFileSync(CMD_FILE, 'utf8');
      fs.unlinkSync(CMD_FILE);
      const cmd = JSON.parse(raw);
      if (cmd.command === 'openFolder' && cmd.path) {
        const uri = vscode.Uri.file(cmd.path);
        vscode.commands.executeCommand('workbench.action.files.revert').then(() => {
          vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => {
            vscode.commands.executeCommand('vscode.openFolder', uri, { forceReuseWindow: true });
          });
        });
      } else if (cmd.command === 'openFolderNewWindow' && cmd.path) {
        const uri = vscode.Uri.file(cmd.path);
        vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
      } else if (cmd.command === 'newWindow') {
        vscode.commands.executeCommand('workbench.action.newWindow');
      }
    } catch (e) { }
  };

  try {
    const watcher = fs.watch(path.dirname(CMD_FILE), (eventType, filename) => {
      if (filename === path.basename(CMD_FILE)) {
        setTimeout(processCommand, 50);
      }
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch (e) {
    const interval2 = setInterval(processCommand, 500);
    context.subscriptions.push({ dispose: () => clearInterval(interval2) });
  }
}

function deactivate() { }

module.exports = { activate, deactivate };
