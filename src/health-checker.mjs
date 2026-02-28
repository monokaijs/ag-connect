import Dockerode from 'dockerode';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { Workspace } from './models/workspace.mjs';
import { isCliProcessAlive } from './cli-manager.mjs';

const socketPaths = [
  process.env.DOCKER_SOCKET,
  '/var/run/docker.sock',
  `${homedir()}/.colima/default/docker.sock`,
].filter(Boolean);

const socketPath = socketPaths.find(p => existsSync(p)) || '/var/run/docker.sock';
const docker = new Dockerode({ socketPath });

async function checkContainerHealth(broadcast) {
  try {
    const workspaces = await Workspace.find({
      status: { $in: ['running', 'initializing'] },
    });

    for (const workspace of workspaces) {
      try {
        if (workspace.type === 'cli') {
          // CLI workspace: check if the process is alive
          if (workspace.status === 'running' && !isCliProcessAlive(workspace)) {
            console.log(`[health] CLI process for "${workspace.name}" is no longer alive, marking as stopped`);
            workspace.status = 'stopped';
            workspace.stage = '';
            workspace.cliPid = 0;
            await workspace.save();
            broadcast({
              event: 'workspace:status',
              payload: {
                id: workspace._id.toString(),
                status: 'stopped',
                stage: '',
                message: 'Process exited',
              },
            });
          }
        } else {
          // Docker workspace: check container state
          if (!workspace.containerId) continue;
          const container = docker.getContainer(workspace.containerId);
          const info = await container.inspect();
          if (!info.State.Running && workspace.status === 'running') {
            console.log(`[health] Container ${workspace.containerId.slice(0, 12)} for "${workspace.name}" is ${info.State.Status}, marking as stopped`);
            workspace.status = 'stopped';
            workspace.stage = '';
            await workspace.save();
            broadcast({
              event: 'workspace:status',
              payload: {
                id: workspace._id.toString(),
                status: 'stopped',
                stage: '',
                message: `Container ${info.State.Status}`,
              },
            });
          }
        }
      } catch (err) {
        if (err.statusCode === 404 && workspace.type !== 'cli') {
          console.log(`[health] Container ${workspace.containerId.slice(0, 12)} for "${workspace.name}" no longer exists, marking as stopped`);
          workspace.status = 'stopped';
          workspace.stage = '';
          workspace.containerId = '';
          await workspace.save();
          broadcast({
            event: 'workspace:status',
            payload: {
              id: workspace._id.toString(),
              status: 'stopped',
              stage: '',
              message: 'Container removed',
            },
          });
        }
      }
    }
  } catch { }
}

function startHealthChecker(broadcast) {
  checkContainerHealth(broadcast);
  setInterval(() => checkContainerHealth(broadcast), 10000);
}

export { startHealthChecker };

