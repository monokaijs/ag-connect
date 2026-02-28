import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import Dockerode from 'dockerode';
import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { Workspace } from './models/workspace.mjs';

const socketPaths = [
  process.env.DOCKER_SOCKET,
  '/var/run/docker.sock',
  `${homedir()}/.colima/default/docker.sock`,
].filter(Boolean);

const socketPath = socketPaths.find(p => existsSync(p)) || '/var/run/docker.sock';
const docker = new Dockerode({ socketPath });

const terminalWss = new WebSocketServer({ noServer: true });

terminalWss.on('connection', async (ws, req) => {
  const match = req.url.match(/\/api\/workspaces\/([^/]+)\/terminal/);
  if (!match) {
    ws.close(1008, 'Invalid path');
    return;
  }

  const workspaceId = match[1];
  let workspace;
  try {
    workspace = await Workspace.findById(workspaceId);
  } catch {
    ws.send('\r\n\x1b[31mWorkspace not found.\x1b[0m\r\n');
    ws.close(1008, 'Workspace not found');
    return;
  }

  if (workspace?.type === 'cli') {
    // CLI workspace: spawn a local shell
    handleCliTerminal(ws, workspace);
  } else {
    // Docker workspace: exec into container
    handleDockerTerminal(ws, workspace);
  }
});

function handleCliTerminal(ws, workspace) {
  const workDir = workspace.mountedPath || process.cwd();
  const shell = platform() === 'darwin' ? '/bin/zsh' : '/bin/bash';

  console.log(`[terminal] CLI terminal for workspace="${workspace._id}" dir="${workDir}"`);

  let ptyProcess;
  try {
    ptyProcess = spawn(shell, ['-l'], {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
      },
    });
  } catch (err) {
    ws.send(`\r\n\x1b[31mFailed to start local shell: ${err.message}\x1b[0m\r\n`);
    ws.close(1011, err.message);
    return;
  }

  ptyProcess.stdout?.on('data', (chunk) => {
    if (ws.readyState === 1) {
      ws.send(chunk);
    }
  });

  ptyProcess.stderr?.on('data', (chunk) => {
    if (ws.readyState === 1) {
      ws.send(chunk);
    }
  });

  ptyProcess.on('exit', (code) => {
    if (ws.readyState === 1) {
      ws.send(`\r\n\x1b[33mShell exited with code ${code}\x1b[0m\r\n`);
      ws.close(1000, 'Process exited');
    }
  });

  ptyProcess.on('error', (err) => {
    if (ws.readyState === 1) {
      ws.send(`\r\n\x1b[31mShell error: ${err.message}\x1b[0m\r\n`);
      ws.close(1011, err.message);
    }
  });

  ws.on('message', (data) => {
    try {
      const msg = data.toString();
      if (msg.startsWith('\x01')) {
        // Control message (resize) — not applicable for non-PTY spawn,
        // but we handle it gracefully
        return;
      }
      if (ptyProcess.stdin?.writable) {
        ptyProcess.stdin.write(data);
      }
    } catch { }
  });

  ws.on('close', () => {
    if (ptyProcess && !ptyProcess.killed) {
      try { ptyProcess.kill(); } catch { }
    }
  });
}

function handleDockerTerminal(ws, workspace) {
  if (!workspace?.containerId) {
    ws.send('\r\n\x1b[31mNo container associated with this workspace.\x1b[0m\r\n');
    ws.close(1008, 'No container');
    return;
  }

  console.log(`[terminal] Docker terminal for workspace=${workspace._id} container=${workspace.containerId.slice(0, 12)} status=${workspace.status}`);

  let execStream = null;
  let exec = null;

  (async () => {
    try {
      const container = docker.getContainer(workspace.containerId);
      let info;
      try {
        info = await container.inspect();
      } catch (inspectErr) {
        console.log(`[terminal] Container inspect failed:`, inspectErr.message);
        ws.send(`\r\n\x1b[31mContainer not found: ${inspectErr.message}\x1b[0m\r\n`);
        ws.close(1008, 'Container not found');
        return;
      }

      console.log(`[terminal] Container state: Running=${info.State.Running} Status=${info.State.Status}`);

      if (!info.State.Running) {
        ws.send(`\r\n\x1b[33mContainer is ${info.State.Status}. Starting it...\x1b[0m\r\n`);
        try {
          await container.start();
          await new Promise(r => setTimeout(r, 1000));
          ws.send('\r\n\x1b[32mContainer started.\x1b[0m\r\n');
        } catch (startErr) {
          ws.send(`\r\n\x1b[31mFailed to start container: ${startErr.message}\x1b[0m\r\n`);
          ws.close(1008, 'Cannot start container');
          return;
        }
      }

      const workDir = '/workspace';
      exec = await container.exec({
        Cmd: ['/bin/bash'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Env: ['TERM=xterm-256color', 'LANG=en_US.UTF-8'],
        WorkingDir: workDir,
      });

      execStream = await exec.start({
        hijack: true,
        stdin: true,
        Tty: true,
      });

      execStream.on('data', (chunk) => {
        if (ws.readyState === 1) {
          ws.send(chunk);
        }
      });

      execStream.on('end', () => {
        if (ws.readyState === 1) {
          ws.close(1000, 'Process exited');
        }
      });

      ws.on('message', (data) => {
        try {
          const msg = data.toString();
          if (msg.startsWith('\x01')) {
            const parsed = JSON.parse(msg.slice(1));
            if (parsed.type === 'resize' && exec) {
              exec.resize({ h: parsed.rows, w: parsed.cols }).catch(() => { });
            }
            return;
          }
          if (execStream?.writable) {
            execStream.write(data);
          }
        } catch { }
      });

      ws.on('close', () => {
        if (execStream) {
          try { execStream.destroy(); } catch { }
        }
      });
    } catch (err) {
      console.error(`[terminal] Error:`, err.message);
      if (ws.readyState === 1) {
        ws.send(`\r\n\x1b[31mFailed to start terminal: ${err.message}\x1b[0m\r\n`);
        ws.close(1011, err.message);
      }
    }
  })();
}

export { terminalWss };

