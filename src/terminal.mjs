import { WebSocketServer } from 'ws';
import Dockerode from 'dockerode';
import { existsSync } from 'fs';
import { homedir } from 'os';
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

  if (!workspace?.containerId) {
    ws.send('\r\n\x1b[31mNo container associated with this workspace.\x1b[0m\r\n');
    ws.close(1008, 'No container');
    return;
  }

  console.log(`[terminal] Connecting to workspace=${workspaceId} container=${workspace.containerId.slice(0, 12)} status=${workspace.status}`);

  let execStream = null;
  let exec = null;

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
});

export { terminalWss };
