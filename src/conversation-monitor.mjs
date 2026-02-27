import { Workspace } from './models/workspace.mjs';
import { findTargetOnPort } from './workspace-cdp.mjs';
import { WebSocket } from 'ws';

const CONVERSATION_EXPR = `(() => {
  const content = document.querySelector('.relative.flex.flex-col.gap-y-3.px-4');
  if (!content) return null;
  const allItems = [];
  const groups = Array.from(content.children);
  for (const g of groups) {
    const kids = Array.from(g.children);
    for (const kid of kids) {
      const cls = typeof kid.className === 'string' ? kid.className : '';
      const hasLexical = !!kid.querySelector('[data-lexical-editor]');
      if (hasLexical) continue;
      const hasAgentContainer = kid.querySelector('.space-y-2') || kid.querySelector('.leading-relaxed');
      const isStatus = cls.includes('whitespace-nowrap') || cls.includes('transition-opacity');
      if (!hasAgentContainer && !isStatus) {
        const clone = kid.cloneNode(true);
        clone.querySelectorAll('.whitespace-nowrap, .transition-opacity, [class*="opacity"]').forEach(el => el.remove());
        let text = (clone.textContent || '').trim();
        ['Pending messages', 'Sending', 'Queued'].forEach(l => { text = text.replace(l, '').trim(); });
        if (text) { allItems.push({ type: 'user', text: text.substring(0, 2000) }); continue; }
      }
      const container = cls.includes('space-y-2') ? kid : kid.querySelector('.space-y-2');
      if (!container) continue;
      const steps = Array.from(container.children);
      for (const step of steps) {
        const sCls = typeof step.className === 'string' ? step.className : '';
        if (sCls.includes('my-2')) {
          const btn = step.querySelector('button');
          const btnText = btn ? (btn.textContent || '').trim() : '';
          const isThinking = btn && (btnText.includes('Thought') || btnText.includes('Thinking'));
          if (isThinking) {
            const sib = btn.nextElementSibling;
            let thinkContent = '';
            let thinkHtml = '';
            const container = btn.closest('.isolate') || step;
            const hiddenDiv = container.querySelector('[class*="overflow-hidden"]') || btn.nextElementSibling;
            if (hiddenDiv) {
              const md = hiddenDiv.querySelector('[class*="leading-relaxed"]') || hiddenDiv.querySelector('div > div > div') || hiddenDiv;
              const clone = md.cloneNode(true);
              clone.querySelectorAll('style, svg, button').forEach(s => s.remove());
              thinkContent = (clone.textContent || '').trim().substring(0, 5000);
              thinkHtml = clone.innerHTML || '';
            }
            allItems.push({ type: 'thinking', text: btnText.substring(0, 200) || 'Thinking...', content: thinkContent, html: thinkHtml });
            const allMds = step.querySelectorAll('.leading-relaxed');
            for (const md of allMds) {
              if (sib && sib.contains(md)) continue;
              const clone = md.cloneNode(true);
              clone.querySelectorAll('style').forEach(s => s.remove());
              const text = clone.textContent.substring(0, 3000);
              const html = md.innerHTML;
              if (text.trim()) allItems.push({ type: 'markdown', text, html });
            }
            continue;
          }
          const md = step.querySelector('.leading-relaxed');
          if (md) {
            const clone = md.cloneNode(true);
            clone.querySelectorAll('style').forEach(s => s.remove());
            allItems.push({ type: 'markdown', text: clone.textContent.substring(0, 3000), html: md.innerHTML });
          }
          continue;
        }
        const cmdLabel = step.querySelector('.opacity-60');
        const cmdText = cmdLabel ? (cmdLabel.textContent || '').trim() : '';
        if (cmdLabel && (cmdText.includes('Ran') || cmdText.includes('Running') || cmdText.includes('Canceled'))) {
          const pre = step.querySelector('pre') || step.querySelector('code');
          allItems.push({ type: 'command', label: cmdText, code: pre ? pre.textContent.substring(0, 2000) : '' });
          continue;
        }
        const clone = step.cloneNode(true);
        clone.querySelectorAll('style, svg').forEach(s => s.remove());
        const spans = Array.from(step.querySelectorAll('span'));
        const parts = spans.map(s => (s.textContent || '').trim()).filter(Boolean);
        const text = parts.length > 1 ? parts.join(' ') : (clone.textContent || '').trim();
        if (text) allItems.push({ type: 'tool', text: text.substring(0, 500) });
      }
    }
  }
  const statusEl = document.querySelector('.whitespace-nowrap.transition-opacity');
  const statusText = statusEl ? (statusEl.textContent || '').trim() : '';
  const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
  const isBusy = cancel && cancel.offsetParent !== null;
  
  const btns = Array.from(document.querySelectorAll('button'));
  const acceptBtn = btns.find(b => b.textContent && b.textContent.includes('Accept all') && b.offsetParent !== null);
  const rejectBtn = btns.find(b => b.textContent && b.textContent.includes('Reject all') && b.offsetParent !== null);

  const deduped = allItems.filter((item, i) => {
    if (i === 0) return true;
    const prev = allItems[i - 1];
    return !(item.type === 'user' && prev.type === 'user' && item.text === prev.text);
  });

  return { 
    turnCount: deduped.length, 
    items: deduped, 
    statusText, 
    isBusy,
    hasAcceptAll: !!acceptBtn,
    hasRejectAll: !!rejectBtn
  };
})()`;

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
    this.ws = null;
    this.contexts = new Set();
    this.activeContextId = null;
    this.pollInterval = null;
    this.msgId = 1;
    this.callbacks = new Map();
    this.running = true;

    this.init();
  }

  async init() {
    try {
      const target = await findTargetOnPort(this.workspace.ports.debug, 'workbench');
      if (!target || !this.running) return;

      this.ws = new WebSocket(target.wsUrl);

      this.ws.on('open', () => {
        this.sendCdp('Runtime.enable', {});
      });

      this.ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data.method === 'Runtime.executionContextCreated') {
            this.contexts.add(data.params.context.id);
            if (!this.pollInterval) {
              this.pollInterval = setInterval(() => this.poll(), 100);
            }
          } else if (data.method === 'Runtime.executionContextDestroyed') {
            this.contexts.delete(data.params.executionContextId);
            if (this.activeContextId === data.params.executionContextId) this.activeContextId = null;
          } else if (data.method === 'Runtime.executionContextsCleared') {
            this.contexts.clear();
            this.activeContextId = null;
          } else if (data.id && this.callbacks.has(data.id)) {
            const { resolve, reject } = this.callbacks.get(data.id);
            this.callbacks.delete(data.id);
            if (data.error) reject(new Error(data.error.message));
            else resolve(data.result);
          }
        } catch { }
      });

      this.ws.on('close', () => this.cleanup());
      this.ws.on('error', () => this.cleanup());

    } catch (err) {
      console.error('Monitor init error:', err);
    }
  }

  sendCdp(method, params, timeoutMs = 2000) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('WS not ready'));
    const id = this.msgId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.callbacks.delete(id);
        reject(new Error('timeout'));
      }, timeoutMs);

      this.callbacks.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async poll() {
    if (this.contexts.size === 0) return;

    const ctxList = Array.from(this.contexts);
    if (this.activeContextId && ctxList.includes(this.activeContextId)) {
      ctxList.splice(ctxList.indexOf(this.activeContextId), 1);
      ctxList.unshift(this.activeContextId);
    }

    let data = null;
    let successContextId = null;

    for (const ctxId of ctxList) {
      try {
        const result = await this.sendCdp('Runtime.evaluate', {
          expression: CONVERSATION_EXPR,
          returnByValue: true,
          awaitPromise: true,
          contextId: ctxId,
        });
        const v = result?.result?.value;
        if (v && v.turnCount !== undefined) {
          data = v;
          successContextId = ctxId;
          break;
        }
      } catch { }
    }

    if (!data) return;
    this.activeContextId = successContextId;

    const key = JSON.stringify({ items: data.items, a: data.hasAcceptAll, r: data.hasRejectAll, b: data.isBusy, t: data.statusText });
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
  }

  cleanup() {
    this.running = false;
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.ws && this.ws.readyState === 1) this.ws.close();
    activeMonitors.delete(this.wsId);
  }
}

function startConversationMonitor(broadcast) {
  // Check the DB every 2s for new active workspaces
  setInterval(async () => {
    try {
      const workspaces = await Workspace.find({ status: 'running' });
      const runningIds = new Set(workspaces.map(w => w._id.toString()));

      // Clean up stopped workspaces
      for (const [id, monitor] of activeMonitors) {
        if (!runningIds.has(id)) {
          monitor.cleanup();
        }
      }

      // Start new monitors
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
