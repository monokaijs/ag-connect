import { Workspace } from './models/workspace.mjs';
import {
  gpiBootstrap,
  gpiGetTrajectory,
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

    try {
      const ws = await Workspace.findById(this.wsId).catch(() => null);
      if (ws) this.workspace = ws;

      const cascadeId = this.workspace.gpi?.activeCascadeId;
      if (!cascadeId) {
        this.polling = false;
        this.schedulePoll();
        return;
      }

      const result = await gpiGetTrajectory(this.workspace, cascadeId);
      if (!result.ok) {
        if (!this.bootstrapped) {
          await this.bootstrap();
        }
        this.polling = false;
        this.schedulePoll();
        return;
      }

      const data = trajectoryToConversation(result.data);
      const wasBusy = this.isBusy;
      this.isBusy = data.isBusy;

      if (wasBusy && !data.isBusy) {
        const wsName = this.workspace.name || 'Workspace';
        sendPushNotification(
          `${wsName} — Task Complete`,
          data.statusText || 'The agent has finished processing your message.'
        );
      }

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
    } catch { }

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
