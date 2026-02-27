import http from 'http';
import { WebSocket } from 'ws';

const CDP_PORTS = [9333, 9000, 9001, 9002, 9003, 9222, 9229, 9333];

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

let cachedPort = null;

async function findTarget(filter = 'launchpad') {
  const portsToTry = cachedPort ? [cachedPort, ...CDP_PORTS.filter(p => p !== cachedPort)] : CDP_PORTS;
  for (const port of portsToTry) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      let found;
      if (filter === 'launchpad' || filter === 'agent') {
        found = list.find(t => t.url?.includes('workbench-jetski-agent.html'));
      } else if (filter === 'all') {
        const matching = list.filter(t => t.webSocketDebuggerUrl).map(t => ({ target: t, wsUrl: t.webSocketDebuggerUrl, port }));
        if (matching.length) {
          cachedPort = port;
          return matching;
        }
        continue;
      } else {
        found = list.find(t => t.url?.includes('workbench.html') && !t.url?.includes('jetski'));
        if (!found) found = list.find(t => t.url?.includes('workbench'));
      }
      if (found?.webSocketDebuggerUrl) {
        cachedPort = port;
        return [{ target: found, wsUrl: found.webSocketDebuggerUrl, port }];
      }
    } catch { }
  }
  return [];
}

async function connectAndEval(wsUrl, targetInfo, expression, timeout) {
  const ws = new WebSocket(wsUrl);

  try {
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('ws_connect_timeout')), 5000);
    });

    let idCounter = 1;
    const contexts = [];

    const call = (method, params) => new Promise((resolve, reject) => {
      const id = idCounter++;
      const handler = (raw) => {
        const data = JSON.parse(raw.toString());
        if (data.id === id) {
          ws.off('message', handler);
          if (data.error) reject(data.error);
          else resolve(data.result);
        }
      };
      ws.on('message', handler);
      setTimeout(() => { ws.off('message', handler); reject(new Error('RPC Timeout')); }, timeout);
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.method === 'Runtime.executionContextCreated') {
          contexts.push(data.params.context);
        }
      } catch { }
    });

    await call('Runtime.enable', {});
    await new Promise(r => setTimeout(r, 1000));

    const results = [];
    for (const ctx of contexts) {
      try {
        const evalResult = await call('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
          contextId: ctx.id,
        });
        if (evalResult.result?.value !== undefined && evalResult.result?.value !== null) {
          results.push({
            contextId: ctx.id,
            contextName: ctx.name || '',
            targetTitle: targetInfo.title || '',
            value: evalResult.result.value,
          });
        }
      } catch { }
    }

    return results;
  } finally {
    ws.close();
  }
}

async function cdpEval(expression, { timeout = 10000, target = 'launchpad' } = {}) {
  const targets = await findTarget(target);
  if (targets.length === 0) return { ok: false, error: 'cdp_not_found' };

  const allResults = [];
  for (const cdp of targets) {
    const results = await connectAndEval(cdp.wsUrl, cdp.target, expression, timeout);
    allResults.push(...results);
  }

  return { ok: true, results: allResults };
}

async function fetchDom(selector, options = {}) {
  const { maxLength = 500000, target = 'launchpad' } = options;

  const expr = `(() => {
    const sel = ${JSON.stringify(selector || 'body')};
    const el = sel === 'body' ? document.body : document.querySelector(sel);
    if (!el) return null;
    const html = el.outerHTML;
    return {
      tag: el.tagName,
      id: el.id,
      className: (el.className || '').substring(0, 300),
      htmlLength: html.length,
      html: html.substring(0, ${maxLength}),
      truncated: html.length > ${maxLength},
    };
  })()`;

  return cdpEval(expr, { target });
}

async function fetchConversation() {
  const expr = `(() => {
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

        if (!hasAgentContainer && !isStatus && kid.offsetHeight > 10) {
          const clone = kid.cloneNode(true);
          clone.querySelectorAll('.whitespace-nowrap, .transition-opacity, [class*="opacity"]').forEach(el => el.remove());
          const statusLabels = ['Pending messages', 'Sending', 'Queued'];
          let text = (clone.textContent || '').trim();
          for (const label of statusLabels) {
            text = text.replace(label, '').trim();
          }
          if (text) {
            allItems.push({ type: 'user', text: text.substring(0, 2000) });
            continue;
          }
        }

        const container = cls.includes('space-y-2') ? kid : kid.querySelector('.space-y-2');
        if (!container) continue;

        const steps = Array.from(container.children);
        for (const step of steps) {
          const sCls = typeof step.className === 'string' ? step.className : '';
          const isTextBlock = sCls.includes('my-2');

          if (isTextBlock) {
            const btn = step.querySelector('button');
            const btnText = btn ? (btn.textContent || '').trim() : '';
            const isThinking = btn && (btnText.includes('Thought') || btnText.includes('Thinking'));

            if (isThinking) {
              let thinkContent = '';
              const sib = btn.nextElementSibling;
              if (sib) {
                const innerMd = sib.querySelector('.leading-relaxed');
                if (innerMd) {
                  const clone = innerMd.cloneNode(true);
                  clone.querySelectorAll('style').forEach(s => s.remove());
                  thinkContent = clone.textContent.substring(0, 3000);
                }
              }
              allItems.push({ type: 'thinking', text: btnText.substring(0, 200) || 'Thinking...', content: thinkContent });

              const allMds = step.querySelectorAll('.leading-relaxed');
              for (const md of allMds) {
                if (sib && sib.contains(md)) continue;
                const clone = md.cloneNode(true);
                clone.querySelectorAll('style').forEach(s => s.remove());
                const html = clone.innerHTML.substring(0, 10000);
                const text = clone.textContent.substring(0, 3000);
                if (text.trim()) allItems.push({ type: 'markdown', html, text });
              }
              continue;
            }

            const md = step.querySelector('.leading-relaxed');
            if (md) {
              const clone = md.cloneNode(true);
              clone.querySelectorAll('style').forEach(s => s.remove());
              allItems.push({ type: 'markdown', html: clone.innerHTML.substring(0, 10000), text: clone.textContent.substring(0, 3000) });
            }
            continue;
          }

          const cmdLabel = step.querySelector('.opacity-60');
          const cmdText = cmdLabel ? (cmdLabel.textContent || '').trim() : '';
          if (cmdLabel && (cmdText.includes('Ran') || cmdText.includes('Running') || cmdText.includes('Canceled'))) {
            const pre = step.querySelector('pre');
            const code = step.querySelector('code');
            allItems.push({ type: 'command', label: cmdText, code: (pre || code) ? (pre || code).textContent.substring(0, 2000) : '' });
            continue;
          }

          const fileInfo = step.querySelector('.flex.min-w-0.flex-1.items-center');
          if (fileInfo) {
            const textParts = (step.textContent || '').trim();
            const match = textParts.match(/(Created|Edited|Deleted|Analyzed|Searched)([\\w.-]+)(\\+\\d+-\\d+)?/);
            allItems.push({ type: 'file_action', text: textParts.substring(0, 300), action: match ? match[1] : '', file: match ? match[2] : '', diff: match ? match[3] || '' : '' });
            continue;
          }

          const text = (step.textContent || '').trim();
          if (text) {
            const isError = text.toLowerCase().includes('error');
            allItems.push({ type: isError ? 'error' : 'tool', text: text.substring(0, 500) });
          }
        }
      }
    }

    const statusEl = document.querySelector('.whitespace-nowrap.transition-opacity');
    const statusText = statusEl ? (statusEl.textContent || '').trim() : '';

    return { turnCount: allItems.length, items: allItems, statusText };
  })()`;

  return cdpEval(expr, { target: 'workbench' });
}

async function fetchConversationProbe() {
  const expr = `(() => {
    const scroll = document.querySelector('.relative.flex.flex-col.gap-y-3.px-4');
    if (!scroll) return null;

    let totalSteps = 0;
    let lastText = '';
    const groups = Array.from(scroll.children);

    for (const g of groups) {
      const kids = Array.from(g.children);
      for (const kid of kids) {
        const cls = typeof kid.className === 'string' ? kid.className : '';
        const hasLexical = !!kid.querySelector('[data-lexical-editor]');
        if (hasLexical) continue;

        const hasAgentContent = kid.querySelector('.space-y-2') || kid.querySelector('.leading-relaxed');
        if (!hasAgentContent && kid.offsetHeight > 10 && kid.offsetHeight < 300) {
          totalSteps++;
          continue;
        }

        const container = cls.includes('space-y-2') ? kid : kid.querySelector('.space-y-2');
        if (!container) continue;
        totalSteps += container.children.length;
      }
    }

    const lastGroup = groups[groups.length - 1];
    if (lastGroup) {
      const lastKid = lastGroup.lastElementChild;
      if (lastKid) {
        const container = lastKid.querySelector('.space-y-2') || lastKid;
        const lastStep = container.lastElementChild;
        if (lastStep) {
          lastText = (lastStep.textContent || '').substring(0, 100);
        }
      }
    }

    const statusEl = document.querySelector('.whitespace-nowrap.transition-opacity');
    const statusText = statusEl ? (statusEl.textContent || '').trim() : '';

    const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
    const isBusy = !!(cancel && cancel.offsetParent !== null);

    const modelEl = document.querySelector('.cursor-pointer .select-none.overflow-hidden.text-ellipsis');
    const currentModel = modelEl ? modelEl.textContent.trim() : '';

    const actionBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && (b.textContent.includes('Accept all') || b.textContent.includes('Reject all')));
    const hasAcceptAll = actionBtns.some(b => b.textContent.includes('Accept all') && b.offsetParent !== null);
    const hasRejectAll = actionBtns.some(b => b.textContent.includes('Reject all') && b.offsetParent !== null);

    return { totalSteps, lastText, statusText, groupCount: groups.length, isBusy, currentModel, hasAcceptAll, hasRejectAll };
  })()`;

  return cdpEval(expr, { target: 'workbench', timeout: 3000 });
}

async function sendMessageToIDE(text) {
  const escapedText = JSON.stringify(text);
  const expr = `(async () => {
    const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
    if (cancel && cancel.offsetParent !== null) return { ok: false, reason: 'busy' };

    const selector = '#cascade [data-lexical-editor="true"][contenteditable="true"][role="textbox"], ' +
                     'div[contenteditable="true"][role="textbox"]';
    const candidates = [...document.querySelectorAll(selector)];
    const editor = candidates.filter(el => el.offsetParent !== null).at(-1);
    if (!editor) return { ok: false, error: 'no_editor' };

    editor.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);

    let inserted = false;
    try { inserted = !!document.execCommand('insertText', false, ${escapedText}); } catch {}

    if (!inserted) {
      editor.textContent = ${escapedText};
      editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: ${escapedText} }));
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${escapedText} }));
    }

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const root = editor.getRootNode();
    const submit = root.querySelector?.('svg.lucide-arrow-right')?.closest('button')
      || root.querySelector?.('[aria-label="Send Message"]')
      || document.querySelector('svg.lucide-arrow-right')?.closest('button')
      || document.querySelector('[aria-label="Send Message"]');

    if (submit && !submit.disabled) {
      submit.click();
      return { ok: true, method: 'click_submit' };
    }

    editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
    editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
    return { ok: true, method: 'enter_fallback' };
  })()`;

  return cdpEval(expr, { target: 'workbench', timeout: 10000 });
}

async function stopAgent() {
  const expr = `(() => {
    const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
    if (cancel && cancel.offsetParent !== null) {
      cancel.click();
      return { ok: true };
    }
    return { ok: false, error: 'not_busy' };
  })()`;

  return cdpEval(expr, { target: 'workbench', timeout: 5000 });
}

async function getModelInfo() {
  const expr = `(() => {
    const el = document.querySelector('.cursor-pointer .select-none.overflow-hidden.text-ellipsis');
    if (!el) return { ok: false, error: 'no_model_display' };
    return { ok: true, model: el.textContent.trim() };
  })()`;
  return cdpEval(expr, { target: 'workbench', timeout: 5000 });
}

async function getAvailableModels() {
  const expr = `(() => {
    const currentEl = document.querySelector('.cursor-pointer .select-none.overflow-hidden.text-ellipsis');
    const current = currentEl ? currentEl.textContent.trim() : '';
    const modelPatterns = ['Claude', 'Gemini', 'GPT', 'Llama', 'Mistral', 'Opus', 'Sonnet', 'Flash'];
    const optionDivs = Array.from(document.querySelectorAll('div[class*="cursor-pointer"][class*="hover\\\\:bg-gray-500"]'));
    const models = optionDivs.map(d => {
      const nameSpan = d.querySelector('.text-xs.font-medium');
      const label = nameSpan ? nameSpan.textContent.trim() : d.textContent.trim();
      return { label, selected: label === current };
    }).filter(m => m.label && modelPatterns.some(p => m.label.includes(p)));
    return { ok: true, models, current };
  })()`;
  return cdpEval(expr, { target: 'workbench', timeout: 5000 });
}

async function selectModel(modelLabel) {
  const escaped = JSON.stringify(modelLabel);
  const expr = `(() => {
    const optionDivs = Array.from(document.querySelectorAll('div[class*="cursor-pointer"][class*="hover\\\\:bg-gray-500"]'));
    const target = optionDivs.find(d => {
      const nameSpan = d.querySelector('.text-xs.font-medium');
      const label = nameSpan ? nameSpan.textContent.trim() : d.textContent.trim();
      return label.includes(${escaped});
    });
    if (!target) return { ok: false, error: 'model_not_found', available: optionDivs.map(d => (d.querySelector('.text-xs.font-medium') || d).textContent.trim()) };
    target.click();
    const editor = document.querySelector('[data-lexical-editor="true"]');
    if (editor) editor.click();
    return { ok: true, selected: (target.querySelector('.text-xs.font-medium') || target).textContent.trim() };
  })()`;
  return cdpEval(expr, { target: 'workbench', timeout: 5000 });
}

async function clickAcceptAll() {
  const expr = `(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Accept all') && b.offsetParent !== null);
    if (!btn) return { ok: false, error: 'not_found' };
    btn.click();
    return { ok: true };
  })()`;
  return cdpEval(expr, { target: 'workbench', timeout: 5000 });
}

async function clickRejectAll() {
  const expr = `(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.includes('Reject all') && b.offsetParent !== null);
    if (!btn) return { ok: false, error: 'not_found' };
    btn.click();
    return { ok: true };
  })()`;
  return cdpEval(expr, { target: 'workbench', timeout: 5000 });
}

async function clickNewChat() {
  const expr = `(() => {
    const btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
    if (!btn) return { ok: false, error: 'not_found' };
    btn.click();
    return { ok: true };
  })()`;
  return cdpEval(expr, { target: 'workbench', timeout: 5000 });
}

async function fetchConversationList() {
  const expr = `(async () => {
    let input = document.querySelector('input[placeholder="Select a conversation"]');
    if (!input) {
      const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
      if (!btn) return { ok: false, error: 'no_history_btn' };
      btn.click();
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 100));
        input = document.querySelector('input[placeholder="Select a conversation"]');
        if (input) break;
      }
      if (!input) return { ok: false, error: 'dialog_timeout' };
    }

    const root = input.closest('div[tabindex]');
    if (!root) return { ok: false, error: 'no_root' };

    const allDivs = root.querySelectorAll('div');
    for (const el of allDivs) {
      const t = (el.textContent || '').trim();
      if (t.startsWith('Show ') && t.includes('more')) el.click();
    }
    await new Promise(r => setTimeout(r, 500));

    const groups = [];
    let currentGroup = null;

    const walk = (el) => {
      for (const child of el.children) {
        const cls = child.className || '';
        const text = (child.textContent || '').trim();

        if (cls.includes('text-xs') && cls.includes('pt-4') && cls.includes('opacity-50') && text.length < 80) {
          currentGroup = { label: text, items: [] };
          groups.push(currentGroup);
          continue;
        }

        if (cls.includes('cursor-pointer') && cls.includes('justify-between') && cls.includes('rounded-md')) {
          const titleSpan = child.querySelector('.text-sm span');
          const title = titleSpan ? titleSpan.textContent.trim() : '';
          if (!title) continue;
          const timeEl = child.querySelector('.ml-4');
          const time = timeEl ? timeEl.textContent.trim() : '';
          const active = cls.includes('focusBackground');
          if (!currentGroup) {
            currentGroup = { label: '', items: [] };
            groups.push(currentGroup);
          }
          currentGroup.items.push({ title, time, active });
          continue;
        }

        if (child.children.length > 0) walk(child);
      }
    };

    walk(root);

    const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
    if (btn) btn.click();

    return { ok: true, groups: groups.filter(g => g.items.length > 0) };
  })()`;

  return cdpEval(expr, { target: 'workbench', timeout: 15000 });
}

async function selectConversation(title) {
  const escaped = JSON.stringify(title);
  const expr = `(async () => {
    let input = document.querySelector('input[placeholder="Select a conversation"]');
    if (!input) {
      const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
      if (!btn) return { ok: false, error: 'no_history_btn' };
      btn.click();
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 100));
        input = document.querySelector('input[placeholder="Select a conversation"]');
        if (input) break;
      }
      if (!input) return { ok: false, error: 'dialog_timeout' };
    }

    const root = input.closest('div[tabindex]');
    if (!root) return { ok: false, error: 'no_root' };

    const allDivs = root.querySelectorAll('div');
    for (const el of allDivs) {
      const t = (el.textContent || '').trim();
      if (t.startsWith('Show ') && t.includes('more')) el.click();
    }
    await new Promise(r => setTimeout(r, 500));

    const items = root.querySelectorAll('[class*="cursor-pointer"][class*="justify-between"][class*="rounded-md"]');
    for (const item of items) {
      const titleSpan = item.querySelector('.text-sm span');
      const itemTitle = titleSpan ? titleSpan.textContent.trim() : '';
      if (itemTitle === ${escaped}) {
        item.click();
        return { ok: true, selected: itemTitle };
      }
    }

    const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
    if (btn) btn.click();
    return { ok: false, error: 'conversation_not_found' };
  })()`;

  return cdpEval(expr, { target: 'workbench', timeout: 15000 });
}

export { cdpEval, fetchDom, fetchConversation, fetchConversationProbe, sendMessageToIDE, stopAgent, getModelInfo, getAvailableModels, selectModel, clickAcceptAll, clickRejectAll, clickNewChat, fetchConversationList, selectConversation };
