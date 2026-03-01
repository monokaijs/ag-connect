import { Workspace } from './models/workspace.mjs';
import {
  gpiBootstrap,
  gpiGetTrajectory,
  gpiGetAllTrajectories,
  gpiReadCachedTrajectory,
  trajectoryToConversation,
} from './gpi.mjs';
import { getTargetsOnPort, getTargetWorkspaceFolders, connectAndEval, FOLDER_EXPR } from './workspace-cdp.mjs';
import { cliGetTargets, cliCdpEval } from './cli-ws.mjs';
import { sendPushNotification } from './push.mjs';

const activeMonitors = new Map();
const lastHash = new Map();

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

    try {
      const ws = await Workspace.findById(this.wsId).catch(() => null);
      if (ws) this.workspace = ws;

      await this.pollTargets();

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
      let entries = Object.entries(summaries);

      if (entries.length === 0) {
        const knownCascades = new Set();
        const activeCid = this.workspace.gpi?.activeCascadeId;
        if (activeCid) knownCascades.add(activeCid);
        const tc = this.workspace.targetCascades;
        if (tc) {
          for (const [, cid] of tc) {
            if (cid) knownCascades.add(cid);
          }
        }
        if (knownCascades.size === 0) {
          this.polling = false;
          this.schedulePoll();
          return;
        }
        for (const cid of knownCascades) {
          entries.push([cid, { status: 'unknown' }]);
        }
      }

      entries.sort((a, b) => {
        const ta = new Date(a[1].lastModifiedTime || 0).getTime();
        const tb = new Date(b[1].lastModifiedTime || 0).getTime();
        return tb - ta;
      });

      const [cascadeId, summary] = entries[0];

      if (cascadeId !== this._lastCascadeId) {
        console.log(`[Monitor] Tracking cascade ${cascadeId.slice(0, 8)}... status=${summary.status || 'unknown'}`);
        this._lastCascadeId = cascadeId;
      }

      let cachedTargetId = null;
      const tc = this.workspace.targetCascades;
      if (tc) {
        for (const [tid, tcid] of tc) {
          if (tcid === cascadeId) { cachedTargetId = tid; break; }
        }
      }

      let trajData = null;
      if (cachedTargetId) {
        const cached = await gpiReadCachedTrajectory(this.workspace, cachedTargetId);
        if (cached && cached.cascadeId === cascadeId && cached.data && (Date.now() - cached.ts) < 30000) {
          trajData = cached.data;
        }
      }

      if (!trajData) {
        const result = await gpiGetTrajectory(this.workspace, cascadeId);
        if (!result.ok) {
          this.polling = false;
          this.schedulePoll();
          return;
        }
        trajData = result.data;
      }

      const data = trajectoryToConversation(trajData);

      const wasBusy = this.isBusy;
      this.isBusy = data.isBusy;

      if (wasBusy !== data.isBusy) {
        console.log(`[Monitor] ${this.wsId} busy: ${wasBusy} → ${data.isBusy}`);
      }

      if (wasBusy && !data.isBusy) {
        const wsName = this.workspace.name || 'Workspace';
        console.log(`[Monitor] Triggering push for ${wsName}`);
        sendPushNotification(
          `${wsName} — Task Complete`,
          'The agent has finished processing your message.'
        );
      }

      const hash = data.hash;
      const prev = lastHash.get(this.wsId);

      if (!prev || prev !== hash) {
        lastHash.set(this.wsId, hash);

        const payload = {
          items: data.items,
          statusText: data.statusText,
          isBusy: data.isBusy,
          turnCount: data.turnCount,
          hasAcceptAll: data.hasAcceptAll,
          hasRejectAll: data.hasRejectAll,
          updatedAt: new Date(),
        };

        const dbUpdate = {
          conversation: payload,
          'gpi.activeCascadeId': cascadeId,
        };

        const targetCascades = this.workspace.targetCascades;
        if (targetCascades) {
          for (const [tid, tcid] of targetCascades) {
            if (tcid === cascadeId) {
              dbUpdate[`targetConversations.${tid}`] = payload;
              this.broadcast({
                event: 'conversation:update',
                payload: { id: this.wsId, targetId: tid, ...payload },
              });
            }
          }
        }

        await Workspace.findByIdAndUpdate(this.wsId, dbUpdate);

        this.broadcast({
          event: 'conversation:update',
          payload: { id: this.wsId, ...payload },
        });
      }

      const targetCascades = this.workspace.targetCascades;
      if (targetCascades && targetCascades.size > 0) {
        for (const [tid, tcid] of targetCascades) {
          if (tcid === cascadeId) continue;
          try {
            const tResult = await gpiGetTrajectory(this.workspace, tcid);
            if (!tResult.ok) continue;
            const tData = trajectoryToConversation(tResult.data);
            const tHash = `${tData.turnCount}:${tData.isBusy}:${tData.items.length}`;
            const prevTHash = lastHash.get(`${this.wsId}:${tid}`);
            if (prevTHash !== tHash) {
              lastHash.set(`${this.wsId}:${tid}`, tHash);
              const tPayload = {
                items: tData.items,
                statusText: tData.statusText,
                isBusy: tData.isBusy,
                turnCount: tData.turnCount,
                hasAcceptAll: tData.hasAcceptAll,
                hasRejectAll: tData.hasRejectAll,
                updatedAt: new Date(),
              };
              await Workspace.findByIdAndUpdate(this.wsId, {
                [`targetConversations.${tid}`]: tPayload,
              });
              this.broadcast({
                event: 'conversation:update',
                payload: { id: this.wsId, targetId: tid, ...tPayload },
              });
            }
          } catch { }
        }
      }


    } catch (err) {
      console.error(`[Monitor] Poll error [${this.wsId}]:`, err.message);
    }

    this.polling = false;
    this.schedulePoll();
  }

  async pollTargets() {
    try {
      let targets = [];
      const port = this.workspace.cdpPort || this.workspace.ports?.debug;
      if (this.workspace.type === 'cli') {
        targets = await cliGetTargets(this.wsId);
      } else {
        if (!port) return;
        targets = await getTargetsOnPort(port, this.workspace.cdpHost);
      }

      const filtered = targets
        .filter(t => t.type === 'page' || t.type === 'app')
        .filter(t => {
          const title = (t.title || '').toLowerCase();
          const url = (t.url || '').toLowerCase();
          if (title.includes('launchpad') || url.includes('launchpad')) return false;
          if (url.includes('jetski-agent') || url.includes('workbench-jetski')) return false;
          return true;
        })
        .map(t => ({ id: t.id, title: t.title, url: t.url, type: t.type, wsUrl: t.wsUrl }));

      const idHash = filtered.map(t => t.id).sort().join(',');
      const idsChanged = idHash !== this._lastTargetIdHash;
      this._lastTargetIdHash = idHash;

      if (idsChanged) {
        const stripped = filtered.map(({ wsUrl, ...rest }) => rest);
        this.broadcast({
          event: 'targets:update',
          payload: { id: this.wsId, targets: stripped },
        });
        console.log(`[Monitor] targets:update (ids changed) for ${this.wsId} - ${filtered.length} targets`);
      }

      try {
        if (this.workspace.type === 'cli') {
          const result = await cliCdpEval(this.wsId, FOLDER_EXPR, { timeout: 5000 });
          const val = result?.results?.[0]?.value || result?.value;
          if (val && filtered.length > 0) {
            filtered[0].folder = val;
          }
        } else {
          const workbenchTargets = filtered.filter(t =>
            t.url?.includes('workbench') && t.wsUrl
          );
          await Promise.all(workbenchTargets.map(async (t) => {
            try {
              const r = await connectAndEval(t.wsUrl, FOLDER_EXPR, 3000);
              if (r.length > 0 && r[0].value) {
                t.folder = r[0].value;
              }
            } catch { }
          }));
        }
      } catch { }

      const fullHash = filtered.map(t => `${t.id}:${t.title}:${t.folder || ''}`).sort().join(',');
      if (fullHash !== this._lastTargetHash) {
        this._lastTargetHash = fullHash;
        const stripped = filtered.map(({ wsUrl, ...rest }) => rest);
        this.broadcast({
          event: 'targets:update',
          payload: { id: this.wsId, targets: stripped },
        });
        console.log(`[Monitor] targets:update (full) for ${this.wsId} - ${filtered.length} targets`);
      }
    } catch { }
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
      console.log(`Monitor loop: found ${workspaces.length} running workspaces`);
      const runningIds = new Set(workspaces.map(w => w._id.toString()));

      for (const [id, monitor] of activeMonitors) {
        if (!runningIds.has(id)) {
          monitor.cleanup();
        }
      }

      for (const ws of workspaces) {
        const id = ws._id.toString();
        if (!activeMonitors.has(id) && (ws.ports?.debug || ws.type === 'cli')) {
          activeMonitors.set(id, new WorkspaceMonitor(ws, broadcast));
        }
      }
    } catch (err) {
      console.log("Monitor loop error:", err);
    }
  }, 2000);
}

export { startConversationMonitor };
