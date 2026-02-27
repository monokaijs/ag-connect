import Dockerode from 'dockerode';
import { Workspace } from './models/workspace.mjs';
import { SshKey } from './models/ssh-key.mjs';
import { existsSync } from 'fs';
import { homedir } from 'os';
import net from 'net';
import { injectTokensIntoContainer } from './token-injector.mjs';

const socketPaths = [
  process.env.DOCKER_SOCKET,
  '/var/run/docker.sock',
  `${homedir()}/.colima/default/docker.sock`,
].filter(Boolean);

const socketPath = socketPaths.find(p => existsSync(p)) || '/var/run/docker.sock';
const docker = new Dockerode({ socketPath });
const AG_IMAGE = process.env.AG_DOCKER_IMAGE || 'ag-connect:latest';
const AG_NETWORK = process.env.AG_DOCKER_NETWORK || 'ag-net';
const IN_DOCKER = !!process.env.HOST_MOUNT_POINT;

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

async function createWorkspaceContainer(workspace, broadcast) {
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

    const apiPort = await findFreePort();
    const debugPort = await findFreePort();
    ws.ports = { api: apiPort, debug: debugPort };
    log(`Ports allocated: API=${apiPort}, Debug=${debugPort}`);

    ws.stage = 'Creating container';
    await ws.save();
    emit('initializing', ws.stage, 'Creating Docker container...');
    log('Creating Docker container...');

    const containerName = `ag-ws-${ws._id.toString().slice(-8)}`;
    ws.containerName = containerName;

    const volumeName = `ag-data-${ws._id.toString().slice(-8)}`;
    const binds = [`${volumeName}:/home/aguser/.config/Antigravity`];
    if (ws.mountedPath) {
      binds.push(`${ws.mountedPath}:/workspace`);
    }

    const hostConfig = {
      PortBindings: {
        '9223/tcp': [{ HostPort: String(debugPort) }],
      },
      ShmSize: 1024 * 1024 * 1024,
      Binds: binds,
    };

    if (IN_DOCKER) {
      hostConfig.NetworkMode = AG_NETWORK;
    }

    const createOpts = {
      Image: AG_IMAGE,
      name: containerName,
      ExposedPorts: { '9223/tcp': {} },
      HostConfig: hostConfig,
    };

    if (ws.mountedPath) {
      createOpts.Env = ['WORKSPACE_FOLDER=/workspace'];
    }

    const container = await docker.createContainer(createOpts);

    ws.containerId = container.id;
    await ws.save();
    log(`Container created: ${container.id.slice(0, 12)}`);

    ws.stage = 'Starting container';
    emit('initializing', ws.stage, 'Starting container...');
    log('Starting container...');
    await container.start();
    log('Container started');

    ws.stage = 'Waiting for IDE';
    await ws.save();
    emit('initializing', ws.stage, 'Waiting for Antigravity IDE to boot...');
    log('Waiting for Antigravity IDE to boot...');

    let healthHost = 'localhost';
    let healthPort = ws.ports.debug;
    if (IN_DOCKER) {
      const info = await docker.getContainer(container.id).inspect();
      const ip = info.NetworkSettings?.Networks?.[AG_NETWORK]?.IPAddress;
      if (ip) {
        healthHost = ip;
        healthPort = 9223;
      }
    }
    ws.cdpHost = healthHost;
    ws.cdpPort = healthPort;
    await ws.save();
    const ready = await waitForContainerReady(healthHost, healthPort, 120);
    if (!ready) {
      throw new Error('IDE failed to start within timeout');
    }
    log('Antigravity IDE is ready');

    ws.stage = 'Syncing SSH keys';
    await ws.save();
    emit('initializing', ws.stage, 'Syncing SSH keys...');
    try {
      const sshKeys = await SshKey.find();
      if (sshKeys.length > 0) {
        await execInContainer(container.id, 'mkdir -p /home/aguser/.ssh && chmod 700 /home/aguser/.ssh');
        for (const key of sshKeys) {
          const safeName = key.name.replace(/[^a-zA-Z0-9_-]/g, '_');
          const escaped = key.privateKey.replace(/'/g, "'\\''");
          await execInContainer(container.id, `printf '%s\\n' '${escaped}' > /home/aguser/.ssh/${safeName} && chmod 600 /home/aguser/.ssh/${safeName}`);
          if (key.publicKey) {
            const escapedPub = key.publicKey.replace(/'/g, "'\\''");
            await execInContainer(container.id, `printf '%s\\n' '${escapedPub}' > /home/aguser/.ssh/${safeName}.pub && chmod 644 /home/aguser/.ssh/${safeName}.pub`);
          }
        }
        await execInContainer(container.id, 'ssh-keyscan -H github.com gitlab.com >> /home/aguser/.ssh/known_hosts 2>/dev/null; chmod 644 /home/aguser/.ssh/known_hosts');
        if (sshKeys.length === 1) {
          const safeName = sshKeys[0].name.replace(/[^a-zA-Z0-9_-]/g, '_');
          await execInContainer(container.id, `cp /home/aguser/.ssh/${safeName} /home/aguser/.ssh/id_rsa && chmod 600 /home/aguser/.ssh/id_rsa`);
        }
        log(`Synced ${sshKeys.length} SSH key(s)`);
      }
    } catch (e) {
      log(`SSH sync warning: ${e.message}`);
    }


    ws.stage = 'Checking auth';
    await ws.save();
    emit('initializing', ws.stage, 'Checking authentication...');
    log('Checking authentication status...');

    const hasAuth = ws.auth && ws.auth.accessToken;
    if (hasAuth) {
      log('Injecting stored authentication tokens...');
      await injectTokensIntoContainer(ws.containerId, ws.auth.accessToken, ws.auth.refreshToken || '', ws.auth.expiryTimestamp || 0);

      log('Restarting IDE to apply auth...');
      await restartIDEInContainer(ws.containerId);
      await waitForContainerReady(ws.cdpHost || 'localhost', ws.cdpPort || ws.ports.debug, 90);

      ws.status = 'running';
      ws.stage = '';
      await ws.save();
      emit('running', '', 'Workspace is ready');
      log('Workspace is ready (authenticated)');
    } else {
      ws.status = 'needsLogin';
      ws.stage = '';
      await ws.save();
      emit('needsLogin', '', 'Workspace needs authentication');
      log('Workspace needs authentication');
    }
  } catch (err) {
    ws.status = 'error';
    ws.error = err.message;
    ws.stage = '';
    await ws.save();
    emit('error', '', err.message);
    log(`Error: ${err.message}`);
  }
}

async function waitForContainerReady(host, port, timeoutSecs) {
  for (let i = 0; i < timeoutSecs; i++) {
    try {
      const resp = await fetch(`http://${host}:${port}/json/version`);
      if (resp.ok) return true;
    } catch { }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function stopWorkspaceContainer(workspace) {
  if (!workspace.containerId) return;
  try {
    const container = docker.getContainer(workspace.containerId);
    await container.stop({ t: 5 });
  } catch { }
  workspace.status = 'stopped';
  workspace.stage = '';
  await workspace.save();
}

async function removeWorkspaceContainer(workspace) {
  if (!workspace.containerId) return;
  try {
    const container = docker.getContainer(workspace.containerId);
    await container.stop({ t: 3 }).catch(() => { });
    await container.remove({ force: true });
  } catch { }
}

async function startWorkspaceContainer(workspace, broadcast) {
  if (!workspace.containerId) {
    return createWorkspaceContainer(workspace, broadcast);
  }
  try {
    const container = docker.getContainer(workspace.containerId);
    let info;
    try {
      info = await container.inspect();
    } catch (err) {
      if (err.statusCode === 404) {
        // Container no longer exists gracefully fallback to create
        return createWorkspaceContainer(workspace, broadcast);
      }
      throw err;
    }

    const binds = info.HostConfig.Binds || [];
    const expectedBind = workspace.mountedPath ? `${workspace.mountedPath}:/workspace` : null;

    let mountMatches = false;
    if (!expectedBind && binds.length === 0) mountMatches = true;
    if (expectedBind && binds.includes(expectedBind)) mountMatches = true;

    const containerEnv = info.Config.Env || [];
    const hasWorkspaceOverride = !workspace.mountedPath || containerEnv.some(e => e.startsWith('WORKSPACE_FOLDER='));

    if (!mountMatches || !hasWorkspaceOverride) {
      await removeWorkspaceContainer(workspace);
      return createWorkspaceContainer(workspace, broadcast);
    }

    if (!info.State.Running) {
      await container.start();
    }
    workspace.status = 'initializing';
    workspace.stage = 'Waiting for IDE';
    await workspace.save();
    broadcast({ event: 'workspace:status', payload: { id: workspace._id.toString(), status: 'initializing', stage: 'Waiting for IDE', message: 'Restarting...' } });

    const ready = await waitForContainerReady(workspace.cdpHost || 'localhost', workspace.cdpPort || workspace.ports.debug, 90);
    if (ready) {


      const hasAuth = workspace.auth && workspace.auth.accessToken;
      if (hasAuth) {
        await injectTokensIntoContainer(workspace.containerId, workspace.auth.accessToken, workspace.auth.refreshToken || '', workspace.auth.expiryTimestamp || 0);
        await restartIDEInContainer(workspace.containerId);
        await waitForContainerReady(workspace.cdpHost || 'localhost', workspace.cdpPort || workspace.ports.debug, 90);
      }

      workspace.status = hasAuth ? 'running' : 'needsLogin';
      workspace.stage = '';
      await workspace.save();
      broadcast({ event: 'workspace:status', payload: { id: workspace._id.toString(), status: workspace.status, stage: '', message: 'Ready' } });
    } else {
      throw new Error('IDE restart timeout');
    }
  } catch (err) {
    workspace.status = 'error';
    workspace.error = err.message;
    await workspace.save();
    broadcast({ event: 'workspace:status', payload: { id: workspace._id.toString(), status: 'error', stage: '', message: err.message } });
  }
}

async function execInContainer(containerId, cmd) {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: ['bash', '-c', cmd],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  return new Promise((resolve, reject) => {
    let output = '';
    stream.on('data', (chunk) => { output += chunk.toString(); });
    stream.on('end', () => resolve(output));
    stream.on('error', reject);
  });
}

async function restartIDEInContainer(containerId) {
  const container = docker.getContainer(containerId);
  await container.restart({ t: 5 });
}

export {
  createWorkspaceContainer,
  stopWorkspaceContainer,
  removeWorkspaceContainer,
  startWorkspaceContainer,
  execInContainer,
  restartIDEInContainer,
  waitForContainerReady,
};
