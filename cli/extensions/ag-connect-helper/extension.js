const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CMD_FILE = path.join(os.tmpdir(), 'ag-connect-cmd.json');

function activate(context) {
  const processCommand = () => {
    try {
      if (!fs.existsSync(CMD_FILE)) return;
      const raw = fs.readFileSync(CMD_FILE, 'utf8');
      fs.unlinkSync(CMD_FILE);
      const cmd = JSON.parse(raw);
      if (cmd.command === 'openFolder' && cmd.path) {
        const uri = vscode.Uri.file(cmd.path);
        vscode.commands.executeCommand('vscode.openFolder', uri, false);
      } else if (cmd.command === 'openFolderNewWindow' && cmd.path) {
        const uri = vscode.Uri.file(cmd.path);
        vscode.commands.executeCommand('vscode.openFolder', uri, true);
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
    const interval = setInterval(processCommand, 500);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
  }
}

function deactivate() { }

module.exports = { activate, deactivate };
