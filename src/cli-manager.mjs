import { Workspace } from './models/workspace.mjs';
import { isCliConnected, cliSendCommand } from './cli-ws.mjs';

/**
 * CLI workspaces are managed by the remote CLI client (npx ag-connect).
 * The server doesn't spawn any processes — it just tracks the workspace
 * record and communicates via WebSocket.
 *
 * createCliWorkspace:  Called when the CLI client registers a workspace via REST.
 * stopCliWorkspace:    Sends stop command to the CLI client.
 * startCliWorkspace:   Not applicable — the CLI client manages its own IDE.
 * removeCliWorkspace:  Sends stop and cleans up.
 */

async function createCliWorkspace(workspace, broadcast) {
  // The CLI client creates the workspace via REST and then connects via WS.
  // We just set the workspace to 'initializing' and wait for the CLI client
  // to report ready via the WebSocket.
  workspace.status = 'initializing';
  workspace.stage = 'Waiting for CLI client';
  await workspace.save();

  broadcast({
    event: 'workspace:status',
    payload: {
      id: workspace._id.toString(),
      status: 'initializing',
      stage: 'Waiting for CLI client',
      message: 'Waiting for the CLI tool to connect...',
    },
  });
}

async function stopCliWorkspace(workspace) {
  const wsId = workspace._id.toString();

  // Tell the CLI client to stop
  cliSendCommand(wsId, 'workspace:stop', { workspaceId: wsId });

  workspace.status = 'stopped';
  workspace.stage = '';
  workspace.cliPid = 0;
  await workspace.save();
}

async function removeCliWorkspace(workspace) {
  await stopCliWorkspace(workspace);
}

async function startCliWorkspace(workspace, broadcast) {
  // Can't start remotely — the user must run `npx ag-connect` again
  workspace.status = 'initializing';
  workspace.stage = 'Waiting for CLI client';
  await workspace.save();

  broadcast({
    event: 'workspace:status',
    payload: {
      id: workspace._id.toString(),
      status: 'initializing',
      stage: 'Waiting for CLI client',
      message: 'Run `npx ag-connect` to reconnect this workspace.',
    },
  });
}

function isCliProcessAlive(workspace) {
  return isCliConnected(workspace._id.toString());
}

export {
  createCliWorkspace,
  stopCliWorkspace,
  removeCliWorkspace,
  startCliWorkspace,
  isCliProcessAlive,
};
