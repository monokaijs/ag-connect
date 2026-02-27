import http from 'http';

const CDP_PORTS = [9000, 9001, 9002, 9003, 9222, 9229, 9333];

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

const BUSY_CHECK = `(() => {
  const el = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
  const busy = !!el && el.offsetParent !== null;
  return { found: !!el, busy };
})()`;

function makePokeExpression(messageContent) {
  return `(async () => {
    const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
    if (cancel && cancel.offsetParent !== null) return { ok:false, reason:"busy_cancel_visible" };

    function findInRoot(root) {
      if (!root || !root.querySelectorAll) return null;
      const selector = '#cascade [data-lexical-editor="true"][contenteditable="true"][role="textbox"], ' +
                       'div[contenteditable="true"][role="textbox"], ' +
                       '.monaco-editor textarea';
      const candidates = [...root.querySelectorAll(selector)];
      return candidates.filter(el => el.offsetParent !== null).at(-1);
    }

    function findEditor() {
      let found = findInRoot(document);
      if (found) return found;
      const iframes = document.querySelectorAll('iframe, webview');
      for (const frame of iframes) {
        try {
          const doc = frame.contentDocument;
          if (doc) {
            found = findInRoot(doc);
            if (found) return found;
          }
        } catch {}
      }
      return null;
    }

    const editor = findEditor();
    if (!editor) return { ok:false, error:"editor_not_found" };

    const text = ${JSON.stringify(messageContent)};

    editor.focus();
    document.execCommand?.("selectAll", false, null);
    document.execCommand?.("delete", false, null);

    let inserted = false;
    try { inserted = !!document.execCommand?.("insertText", false, text); } catch {}
    if (!inserted) {
      if (editor.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        setter?.call(editor, text);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        editor.textContent = text;
        editor.dispatchEvent(new InputEvent("beforeinput", { bubbles:true, inputType:"insertText", data:text }));
        editor.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data:text }));
      }
    }

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const root = editor.getRootNode();
    const submit = (root.querySelector || document.querySelector).call(root, "svg.lucide-arrow-right")?.closest("button") ||
                   (root.querySelector || document.querySelector).call(root, '[aria-label="Send Message"]') ||
                   (root.querySelector || document.querySelector).call(root, '.codicon-send');

    if (submit && !submit.disabled) {
      submit.click();
      return { ok:true, method:"click_submit" };
    }

    editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles:true, key:"Enter", code:"Enter", keyCode: 13 }));
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles:true, key:"Enter", code:"Enter", keyCode: 13 }));

    return { ok:true, method:"enter_fallback", submitFound: !!submit, submitDisabled: submit?.disabled ?? null };
  })()`;
}

async function findCdpTarget() {
  for (const port of CDP_PORTS) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      let found = list.find(t => t.url?.includes('workbench.html') || t.title?.includes('workbench'));
      if (!found) {
        found = list.find(t => t.url?.includes('workbench-jetski-agent.html'));
      }
      if (found?.webSocketDebuggerUrl) {
        return { target: found, wsUrl: found.webSocketDebuggerUrl, port };
      }
    } catch { }
  }
  return null;
}

async function poke(messageContent) {
  const expression = makePokeExpression(messageContent);
  const cdp = await findCdpTarget();

  if (!cdp) {
    return { ok: false, error: 'cdp_not_found', details: 'Is AG started with --remote-debugging-port=9000?' };
  }

  const { default: WebSocket } = await import('ws');
  const ws = new WebSocket(cdp.wsUrl);

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
      setTimeout(() => {
        ws.off('message', handler);
        reject(new Error('RPC Timeout'));
      }, 5000);
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
    await new Promise(r => setTimeout(r, 800));

    for (const ctx of contexts) {
      try {
        const evalResult = await call('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
          contextId: ctx.id,
        });

        if (evalResult.result?.value) {
          const res = evalResult.result.value;
          if (res.ok) return res;
          if (res.reason === 'busy_cancel_visible') return { ok: false, reason: 'busy' };
        }
      } catch { }
    }

    return { ok: false, error: 'editor_not_found_in_any_context', contextCount: contexts.length };
  } finally {
    ws.close();
  }
}

export { poke, findCdpTarget };
