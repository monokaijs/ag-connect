import { spawn } from 'child_process';
import net from 'net';
import { Workspace } from './models/workspace.mjs';

/** Track running child processes by workspace ID */
const runningProcesses = new Map();

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

async function waitForCdpReady(host, port, timeoutSecs) {
  for (let i = 0; i < timeoutSecs; i++) {
    try {
      const resp = await fetch(`http://${host}:${port}/json/version`);
      if (resp.ok) return true;
    } catch { }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Create and start a CLI workspace using npx.
 * This spawns `npx antigravity` (or the appropriate AG CLI) with
 * a remote-debugging-port and workspace folder.
 */
async function createCliWorkspace(workspace, broadcast) {
  const ws = workspace;
  const emit = (status, stage, message) => {
    broadcast({ event: 'workspace:status', payload: { id: ws._id.toString(), status, stage, message } });
  };
  const log = (line) => {
    broadcast({ event: 'workspace:log', payload: { id: ws._id.toString(), line } });
    ws.initLogs.push(line);
    if (ws.initLogs.length > 200) ws.initLogs.shift();
  };

  try {
    ws.status = 'initializing';
    ws.stage = 'Allocating ports';
    await ws.save();
    emit('initializing', ws.stage, 'Allocating ports...');
    log('Allocating ports...');

    const debugPort = await findFreePort();
    ws.ports = { api: 0, debug: debugPort };
    ws.cliPort = debugPort;
    log(`Debug port allocated: ${debugPort}`);

    ws.stage = 'Starting Antigravity CLI';
    await ws.save();
    emit('initializing', ws.stage, 'Launching Antigravity via npx...');
    log('Launching Antigravity via npx...');

    const workspaceDir = ws.mountedPath || process.cwd();

    // Build the npx command arguments
    const args = [
      '-y',
      'antigravity',
      '--remote-debugging-port', String(debugPort),
    ];

    if (ws.mountedPath) {
      args.push('--folder', ws.mountedPath);
    }

    const child = spawn('npx', args, {
      cwd: workspaceDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WORKSPACE_FOLDER: workspaceDir,
      },
      detached: false,
    });

    ws.cliPid = child.pid;
    await ws.save();
    log(`Process started: PID ${child.pid}`);

    // Store the process reference
    runningProcesses.set(ws._id.toString(), child);

    // Capture stdout/stderr for logging
    child.stdout?.on('data', (data) => {
      const line = data.toString().trim();
      if (line) log(`[stdout] ${line}`);
    });

    child.stderr?.on('data', (data) => {
      const line = data.toString().trim();
      if (line) log(`[stderr] ${line}`);
    });

    child.on('exit', async (code, signal) => {
      log(`Process exited: code=${code} signal=${signal}`);
      runningProcesses.delete(ws._id.toString());
      try {
        const fresh = await Workspace.findById(ws._id);
        if (fresh && fresh.status !== 'stopped') {
          fresh.status = 'stopped';
          fresh.stage = '';
          fresh.cliPid = 0;
          await fresh.save();
          emit('stopped', '', `Process exited (code=${code})`);
        }
      } catch { }
    });

    child.on('error', async (err) => {
      log(`Process error: ${err.message}`);
      runningProcesses.delete(ws._id.toString());
      try {
        const fresh = await Workspace.findById(ws._id);
        if (fresh) {
          fresh.status = 'error';
          fresh.error = err.message;
          fresh.stage = '';
          fresh.cliPid = 0;
          await fresh.save();
          emit('error', '', err.message);
        }
      } catch { }
    });

    // Wait for IDE to be ready
    ws.stage = 'Waiting for IDE';
    await ws.save();
    emit('initializing', ws.stage, 'Waiting for Antigravity IDE to boot...');
    log('Waiting for IDE on localhost...');

    ws.cdpHost = 'localhost';
    ws.cdpPort = debugPort;
    await ws.save();

    const ready = await waitForCdpReady('localhost', debugPort, 120);
    if (!ready) {
      throw new Error('IDE failed to start within timeout');
    }
    log('Antigravity IDE is ready');

    // CLI workspaces are already authenticated locally, skip needsLogin
    ws.status = 'running';
    ws.stage = '';
    await ws.save();
    emit('running', '', 'Workspace is ready');
    log('Workspace is ready');
  } catch (err) {
    ws.status = 'error';
    ws.error = err.message;
    ws.stage = '';
    await ws.save();
    emit('error', '', err.message);
    log(`Error: ${err.message}`);
  }
}

async function stopCliWorkspace(workspace) {
  const wsId = workspace._id.toString();
  const child = runningProcesses.get(wsId);

  if (child) {
    try {
      child.kill('SIGTERM');
      // Give it a few seconds to clean up
      await new Promise(r => setTimeout(r, 2000));
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    } catch { }
    runningProcesses.delete(wsId);
  } else if (workspace.cliPid) {
    // Try to kill by PID if we don't have the process handle
    try {
      process.kill(workspace.cliPid, 'SIGTERM');
    } catch { }
  }

  workspace.status = 'stopped';
  workspace.stage = '';
  workspace.cliPid = 0;
  await workspace.save();
}

async function removeCliWorkspace(workspace) {
  await stopCliWorkspace(workspace);
}

async function startCliWorkspace(workspace, broadcast) {
  // If we have a running process, just check if it's healthy
  const wsId = workspace._id.toString();
  const existingChild = runningProcesses.get(wsId);

  if (existingChild && !existingChild.killed) {
    // Process still running, check if CDP is responsive
    workspace.status = 'initializing';
    workspace.stage = 'Checking IDE';
    await workspace.save();
    broadcast({ event: 'workspace:status', payload: { id: wsId, status: 'initializing', stage: 'Checking IDE', message: 'Reconnecting...' } });

    const port = workspace.cdpPort || workspace.cliPort || workspace.ports?.debug;
    const ready = await waitForCdpReady('localhost', port, 10);
    if (ready) {
      workspace.status = 'running';
      workspace.stage = '';
      await workspace.save();
      broadcast({ event: 'workspace:status', payload: { id: wsId, status: 'running', stage: '', message: 'Ready' } });
      return;
    }
  }

  // Otherwise, create a new process
  return createCliWorkspace(workspace, broadcast);
}

/**
 * Check if a CLI workspace process is still alive
 */
function isCliProcessAlive(workspace) {
  const wsId = workspace._id.toString();
  const child = runningProcesses.get(wsId);
  if (child && !child.killed) return true;

  // Fallback: check by PID
  if (workspace.cliPid) {
    try {
      process.kill(workspace.cliPid, 0); // signal 0 = just check
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export {
  createCliWorkspace,
  stopCliWorkspace,
  removeCliWorkspace,
  startCliWorkspace,
  isCliProcessAlive,
  runningProcesses,
};
