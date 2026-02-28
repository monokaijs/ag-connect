import { Workspace } from './models/workspace.mjs';
import {
  gpiBootstrap,
  gpiGetTrajectory,
  gpiGetAllTrajectories,
  trajectoryToConversation,
} from './gpi.mjs';
import { sendPushNotification } from './push.mjs';

const activeMonitors = new Map();
const lastState = new Map();
const lastData = new Map();

export function getChatState(wsId) {
  return lastData.get(wsId) || { items: [] };
}

class WorkspaceMonitor {
  constructor(workspace, broadcast) {
    this.workspace = workspace;
    this.wsId = workspace._id.toString();
    this.broadcast = broadcast;
    this.running = true;
    this.bootstrapped = false;
    this.isBusy = false;
    this.polling = false;

    this.init();
  }

  async init() {
    try {
      await this.bootstrap();
      if (!this.running) return;
      this.schedulePoll();
    } catch (err) {
      console.error(`Monitor init error [${this.wsId}]:`, err.message);
    }
  }

  schedulePoll() {
    if (!this.running) return;
    const delay = this.isBusy ? 50 : 1000;
    setTimeout(() => this.poll(), delay);
  }

  async bootstrap() {
    try {
      const result = await gpiBootstrap(this.workspace);
      if (result?.csrf || result?.installed) {
        this.bootstrapped = true;
        console.log(`[GPI] Bootstrap for ${this.wsId}: csrf=${!!result.csrf}`);
        if (result.modelUid) {
          const { Workspace } = await import('./models/workspace.mjs');
          await Workspace.findByIdAndUpdate(this.wsId, { 'gpi.selectedModelUid': result.modelUid });
          console.log(`[GPI] Captured modelUid for ${this.wsId}: ${result.modelUid.substring(0, 20)}`);
        }
      }
    } catch (err) {
      console.error(`[GPI] Bootstrap failed for ${this.wsId}:`, err.message);
    }
  }

  async poll() {
    if (!this.running) return;
    if (this.polling) {
      this.schedulePoll();
      return;
    }
    this.polling = true;
    if (!this._pollCount) this._pollCount = 0;
    this._pollCount++;
    if (this._pollCount % 10 === 1) {
      console.log(`[Monitor] Poll #${this._pollCount} for ${this.wsId}, isBusy=${this.isBusy}`);
    }
    if (this._pollCount === 1) {
      console.log(`[Monitor] DEBUG: First poll, will dump raw data`);
    }

    try {
      const ws = await Workspace.findById(this.wsId).catch(() => null);
      if (ws) this.workspace = ws;

      const allResult = await gpiGetAllTrajectories(this.workspace);
      if (!allResult.ok || !allResult.data) {
        if (!this._loggedFail) {
          console.log(`[Monitor] Trajectories fail for ${this.wsId}`);
          this._loggedFail = true;
        }
        if (!this.bootstrapped) {
          await this.bootstrap();
        }
        this.polling = false;
        this.schedulePoll();
        return;
      }
      this._loggedFail = false;

      const summaries = allResult.data?.trajectorySummaries || {};
      const entries = Object.entries(summaries);
      if (entries.length === 0) {
        this.polling = false;
        this.schedulePoll();
        return;
      }

      entries.sort((a, b) => {
        const ta = new Date(a[1].lastModifiedTime || 0).getTime();
        const tb = new Date(b[1].lastModifiedTime || 0).getTime();
        return tb - ta;
      });

      const [cascadeId, summary] = entries[0];
      const runStatus = summary.status;
      const isBusyNow = runStatus === 'CASCADE_RUN_STATUS_RUNNING';

      if (cascadeId !== this._lastCascadeId) {
        console.log(`[Monitor] Tracking cascade ${cascadeId.slice(0, 8)}... status=${runStatus}`);
        this._lastCascadeId = cascadeId;
      }

      const wasBusy = this.isBusy;
      this.isBusy = isBusyNow;

      if (wasBusy !== isBusyNow) {
        console.log(`[Monitor] ${this.wsId} busy: ${wasBusy} → ${isBusyNow} (${runStatus})`);
      }

      if (wasBusy && !isBusyNow) {
        const wsName = this.workspace.name || 'Workspace';
        console.log(`[Monitor] Triggering push for ${wsName}`);
        sendPushNotification(
          `${wsName} — Task Complete`,
          'The agent has finished processing your message.'
        );
      }

      const result = await gpiGetTrajectory(this.workspace, cascadeId);
      if (!result.ok) {
        this.polling = false;
        this.schedulePoll();
        return;
      }

      const data = trajectoryToConversation(result.data);

      const key = JSON.stringify({
        items: data.items,
        a: data.hasAcceptAll,
        r: data.hasRejectAll,
        b: data.isBusy,
        t: data.statusText,
      });
      const prev = lastState.get(this.wsId);

      if (!prev || prev !== key) {
        lastState.set(this.wsId, key);
        const payload = {
          id: this.wsId,
          items: data.items,
          statusText: data.statusText,
          isBusy: data.isBusy,
          turnCount: data.turnCount,
          hasAcceptAll: data.hasAcceptAll,
          hasRejectAll: data.hasRejectAll,
        };
        lastData.set(this.wsId, payload);
        this.broadcast({ event: 'conversation:update', payload });
      }
    } catch (err) {
      console.error(`[Monitor] Poll error [${this.wsId}]:`, err.message);
    }

    this.polling = false;
    this.schedulePoll();
  }

  cleanup() {
    this.running = false;
    activeMonitors.delete(this.wsId);
  }
}

function startConversationMonitor(broadcast) {
  setInterval(async () => {
    try {
      const workspaces = await Workspace.find({ status: 'running' });
      const runningIds = new Set(workspaces.map(w => w._id.toString()));

      for (const [id, monitor] of activeMonitors) {
        if (!runningIds.has(id)) {
          monitor.cleanup();
        }
      }

      for (const ws of workspaces) {
        const id = ws._id.toString();
        if (!activeMonitors.has(id) && ws.ports?.debug) {
          activeMonitors.set(id, new WorkspaceMonitor(ws, broadcast));
        }
      }
    } catch { }
  }, 2000);
}

export { startConversationMonitor };
