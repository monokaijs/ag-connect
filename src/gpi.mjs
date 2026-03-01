import { cdpEvalOnPort, cdpEvalOnAllTargets } from './workspace-cdp.mjs';
import { cliCdpEval, cliExec } from './cli-ws.mjs';
import { DEFAULT_MODEL_UID } from './config.mjs';

const LS_PREFIX = '/exa.language_server_pb.LanguageServerService';

async function discoverCsrfViaDocker(containerId) {
  if (!containerId) return null;

  try {
    const { default: Dockerode } = await import('dockerode');
    const { existsSync } = await import('fs');
    const { homedir } = await import('os');

    const socketPaths = [
      process.env.DOCKER_SOCKET,
      '/var/run/docker.sock',
      `${homedir()}/.colima/default/docker.sock`,
    ].filter(Boolean);
    const socketPath = socketPaths.find(p => existsSync(p)) || '/var/run/docker.sock';
    const docker = new Dockerode({ socketPath });

    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: ['bash', '-c', 'ps aux | grep language_server'],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: false });

    const output = await new Promise((resolve) => {
      let data = '';
      stream.on('data', (chunk) => { data += chunk.toString(); });
      stream.on('end', () => resolve(data));
      setTimeout(() => resolve(data), 3000);
    });

    const csrfMatch = output.match(/--csrf_token\s+([a-f0-9-]+)/);
    const portMatch = output.match(/--extension_server_port\s+(\d+)/);

    if (!csrfMatch) return null;

    return {
      csrf: csrfMatch[1],
      extensionPort: portMatch ? parseInt(portMatch[1]) : null,
    };
  } catch (err) {
    console.error('[GPI] Docker exec failed:', err.message);
    return null;
  }
}

async function discoverLsUrl(workspace) {
  const port = workspace.cdpPort || workspace.ports?.debug;
  if (!port) return null;

  try {
    const result = await cdpEvalOnPort(port, `(() => {
      const perf = performance.getEntriesByType('resource');
      for (let i = perf.length - 1; i >= 0; i--) {
        if (perf[i].name.includes('LanguageServerService')) {
          return new URL(perf[i].name).origin;
        }
      }
      return null;
    })()`, {
      target: 'workbench',
      host: workspace.cdpHost,
      timeout: 5000,
    });
    const val = result.results?.[0]?.value;
    return typeof val === 'string' ? val : null;
  } catch {
    return null;
  }
}

function buildFetchExpr(endpoint, body) {
  const jsonBody = JSON.stringify(body);
  return `(async () => {
    try {
      const perf = performance.getEntriesByType('resource');
      let lsUrl = null;
      for (let i = perf.length - 1; i >= 0; i--) {
        if (perf[i].name.includes('LanguageServerService')) {
          const u = new URL(perf[i].name);
          lsUrl = u.origin;
          break;
        }
      }
      if (!lsUrl) return { ok: false, error: 'ls_not_found' };

      let csrf = window.__gpiCsrf;

      if (!csrf) {
        try {
          const frames = document.querySelectorAll('iframe');
          for (const f of frames) {
            try {
              const fc = f.contentWindow?.__gpiCsrf;
              if (fc) { csrf = fc; break; }
            } catch {}
          }
        } catch {}
      }

      if (!csrf) {
        return { ok: false, error: 'no_csrf' };
      }

      const origFetch = window.__origFetch || window.fetch;
      const headers = window.__gpiHeaders
        ? { ...window.__gpiHeaders, 'content-type': 'application/json', 'x-codeium-csrf-token': csrf }
        : { 'content-type': 'application/json', 'connect-protocol-version': '1', 'x-codeium-csrf-token': csrf };
      const res = await origFetch(lsUrl + '${LS_PREFIX}/${endpoint}', {
        method: 'POST',
        headers,
        body: ${JSON.stringify(jsonBody)},
      });

      const data = await res.json().catch(() => null);
      return { ok: res.status === 200, status: res.status, data, _csrf: csrf.substring(0, 8), _lsUrl: lsUrl };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  })()`;
}

function buildSendExpr(cascadeId, message, model) {
  const requestedModel = { model: model || DEFAULT_MODEL_UID };
  const body = {
    cascadeId,
    items: [{ text: message }],
    metadata: {
      ideName: 'antigravity',
      locale: 'en',
      ideVersion: '1.19.6',
      extensionName: 'antigravity',
    },
    cascadeConfig: {
      plannerConfig: {
        conversational: {
          plannerMode: 'CONVERSATIONAL_PLANNER_MODE_DEFAULT',
          agenticMode: true,
        },
        toolConfig: {
          runCommand: {
            autoCommandConfig: {
              autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_ALWAYS',
            },
          },
          sendCommandInput: {
            autoCommandConfig: {
              autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_ALWAYS',
            },
          },
          notifyUser: {
            artifactReviewMode: 'ARTIFACT_REVIEW_MODE_ALWAYS',
          },
        },
        requestedModel,
      },
      conversationHistoryConfig: {
        enabled: true,
      },
    },
    clientType: 'CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE',
  };

  return `(async () => {
    try {
      const perf = performance.getEntriesByType('resource');
      let lsUrl = null;
      for (let i = perf.length - 1; i >= 0; i--) {
        if (perf[i].name.includes('LanguageServerService')) {
          lsUrl = new URL(perf[i].name).origin;
          break;
        }
      }
      if (!lsUrl) return { ok: false, error: 'ls_not_found' };

      const csrf = window.__gpiCsrf;
      if (!csrf) return { ok: false, error: 'no_csrf' };

      const origFetch = window.__origFetch || window.fetch;
      const parsed = JSON.parse(${JSON.stringify(JSON.stringify(body))});

      const headers = window.__gpiHeaders
        ? { ...window.__gpiHeaders, 'content-type': 'application/json', 'x-codeium-csrf-token': csrf }
        : { 'content-type': 'application/json', 'connect-protocol-version': '1', 'x-codeium-csrf-token': csrf };
      const res = await origFetch(lsUrl + '${LS_PREFIX}/SendUserCascadeMessage', {
        method: 'POST',
        headers,
        body: JSON.stringify(parsed),
      });
      const data = await res.json().catch(() => null);
      return { ok: res.status === 200, status: res.status, data };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  })()`;
}

function buildBootstrapExpr() {
  return `(async () => {
    try {
      const perf = performance.getEntriesByType('resource');
      let lsUrl = null;
      for (let i = perf.length - 1; i >= 0; i--) {
        if (perf[i].name.includes('LanguageServerService')) {
          lsUrl = new URL(perf[i].name).origin;
          break;
        }
      }

      const origFetch = window.__origFetch || window.fetch;
      window.__origFetch = origFetch;
      window.fetch = function(...args) {
        const req = args[0];
        const opts = args[1] || {};
        const url = typeof req === 'string' ? req : req?.url || '';
        if (url.includes('LanguageServerService')) {
          const h = opts.headers || {};
          const c = h['x-codeium-csrf-token'];
          if (c) {
            window.__gpiCsrf = c;
            window.__gpiHeaders = {};
            for (const [k, v] of Object.entries(h)) {
              window.__gpiHeaders[k] = v;
            }
          }
          if (url.includes('SendUserCascadeMessage') || url.includes('StartCascade')) {
            if (opts.body) {
              try {
                const b = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
                const uid = b?.cascadeConfig?.plannerConfig?.requestedModel?.model
                  || b?.cascadeConfig?.plannerConfig?.requestedModelUid
                  || b?.cascadeConfig?.requestedModelUid;
                if (uid) window.__gpiModelUid = uid;
              } catch {}
            }
          }
        }
        return origFetch.apply(this, args);
      };

      if (!window.__origSetHeader) {
        const origXHR = window.XMLHttpRequest.prototype.setRequestHeader;
        window.__origSetHeader = origXHR;
        window.XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
          if (name === 'x-codeium-csrf-token') {
            window.__gpiCsrf = value;
          }
          return window.__origSetHeader.call(this, name, value);
        };
      }

      if (!window.__gpiCsrf && lsUrl) {
        try {
          const probeRes = await origFetch(lsUrl + '/exa.language_server_pb.LanguageServerService/GetProcesses', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'connect-protocol-version': '1' },
            body: '{}',
          });
          const csrfHeader = probeRes.headers.get('x-codeium-csrf-token');
          if (csrfHeader) window.__gpiCsrf = csrfHeader;
        } catch {}
      }

      if (!window.__gpiCsrf && lsUrl) {
        await new Promise(r => setTimeout(r, 200));
        try {
          const triggerBtn = document.querySelector('[data-testid="new-chat-button"]')
            || document.querySelector('button[aria-label*="new"]')
            || document.querySelector('button[aria-label*="New"]');
          if (triggerBtn) {
            triggerBtn.click();
            await new Promise(r => setTimeout(r, 1500));
          }
        } catch {}
      }

      if (!window.__gpiCsrf && lsUrl) {
        await new Promise(r => setTimeout(r, 2000));
      }

      return {
        ok: !!window.__gpiCsrf,
        lsUrl: lsUrl || null,
        hasCsrf: !!window.__gpiCsrf,
        csrf: window.__gpiCsrf || null,
        headers: window.__gpiHeaders || null,
        modelUid: window.__gpiModelUid || null,
        installed: true,
      };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  })()`;
}

function buildGetTrajectoryExpr(cascadeId) {
  return buildFetchExpr('GetCascadeTrajectory', { cascadeId, numSteps: 10000 });
}

function buildGetAllTrajectoriesExpr() {
  return buildFetchExpr('GetAllCascadeTrajectories', {});
}

function buildStartCascadeExpr(modelUid) {
  const requestedModel = { model: modelUid || DEFAULT_MODEL_UID };
  const body = {
    metadata: {
      ideName: 'antigravity',
      locale: 'en',
      ideVersion: '1.19.6',
      extensionName: 'antigravity',
    },
    cascadeConfig: {
      plannerConfig: {
        conversational: {
          plannerMode: 'CONVERSATIONAL_PLANNER_MODE_DEFAULT',
          agenticMode: true,
        },
        toolConfig: {
          runCommand: {
            autoCommandConfig: {
              autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_ALWAYS',
            },
          },
          sendCommandInput: {
            autoCommandConfig: {
              autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_ALWAYS',
            },
          },
          notifyUser: {
            artifactReviewMode: 'ARTIFACT_REVIEW_MODE_ALWAYS',
          },
        },
        requestedModel,
      },
      conversationHistoryConfig: {
        enabled: true,
      },
    },
    clientType: 'CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE',
  };

  return buildFetchExpr('StartCascade', body);
}

function buildCancelExpr(cascadeId) {
  return `(async () => {
    try {
      const perf = performance.getEntriesByType('resource');
      let lsUrl = null;
      for (let i = perf.length - 1; i >= 0; i--) {
        if (perf[i].name.includes('LanguageServerService')) {
          lsUrl = new URL(perf[i].name).origin;
          break;
        }
      }
      if (!lsUrl) return { ok: false, error: 'ls_not_found' };

      const csrf = window.__gpiCsrf;
      if (!csrf) return { ok: false, error: 'no_csrf' };

      function encodeVarint(n) {
        const b = [];
        while (n > 127) { b.push((n & 0x7F) | 0x80); n >>>= 7; }
        b.push(n);
        return new Uint8Array(b);
      }
      function encodeString(field, str) {
        const d = new TextEncoder().encode(str);
        const tag = new Uint8Array([(field << 3) | 2]);
        const len = encodeVarint(d.length);
        const r = new Uint8Array(tag.length + len.length + d.length);
        r.set(tag, 0);
        r.set(len, tag.length);
        r.set(d, tag.length + len.length);
        return r;
      }

      const proto = encodeString(1, ${JSON.stringify(cascadeId)});
      const origFetch = window.__origFetch || window.fetch;
      const res = await origFetch(lsUrl + '${LS_PREFIX}/CancelCascadeInvocation', {
        method: 'POST',
        headers: {
          'content-type': 'application/proto',
          'connect-protocol-version': '1',
          'x-codeium-csrf-token': csrf,
        },
        body: proto,
      });
      return { ok: res.status === 200 };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  })()`;
}

async function evalForWorkspace(workspace, expression, opts = {}) {
  if (workspace.type === 'cli') {
    const result = await cliCdpEval(workspace._id.toString(), expression, opts);
    return result;
  }
  const port = workspace.cdpPort || workspace.ports?.debug;
  if (!port) return { ok: false, error: 'no_debug_port' };
  if (opts.allTargets) {
    return cdpEvalOnAllTargets(port, expression, {
      host: workspace.cdpHost,
      timeout: opts.timeout || 15000,
    });
  }
  return cdpEvalOnPort(port, expression, {
    target: opts.target || 'workbench',
    host: workspace.cdpHost,
    timeout: opts.timeout || 15000,
  });
}

async function gpiEval(workspace, expression) {
  const pickBest = (results) => {
    if (!results?.length) return null;
    return results.find(r => r.value?.ok === true)?.value
      || results.find(r => r.value?.turnCount !== undefined)?.value
      || results.find(r => !r.value?.error)?.value
      || results[0]?.value;
  };

  const result = await evalForWorkspace(workspace, expression, {
    target: 'workbench',
    timeout: 15000,
  });
  if (!result.ok) return result;
  const val = pickBest(result.results);

  const needsRebootstrap = val?.error === 'no_csrf'
    || val?.status === 401
    || val?.data?.code === 'unauthenticated';

  if (needsRebootstrap) {
    const reason = val?.error === 'no_csrf' ? 'missing' : 'stale';
    console.log(`[GPI] CSRF ${reason}, auto-bootstrapping...`);
    const bootstrap = await gpiBootstrap(workspace);
    console.log(`[GPI] Re-bootstrap result: csrf=${bootstrap?.csrf?.substring(0, 8)}.. ok=${bootstrap?.ok}`);
    if (bootstrap?.csrf) {
      const retry = await evalForWorkspace(workspace, expression, {
        target: 'workbench',
        timeout: 15000,
      });
      if (!retry.ok) return retry;
      const retryVal = pickBest(retry.results);
      if (retryVal && !retryVal.ok) {
        console.log(`[GPI] Retry after re-bootstrap still failed: status=${retryVal.status} error=${retryVal.error} data=${JSON.stringify(retryVal.data).substring(0, 200)}`);
      }
      return retryVal || { ok: false, error: 'no_result_after_retry' };
    }
    return val;
  }

  return val || { ok: false, error: 'no_result' };
}

export async function gpiBootstrap(workspace) {
  await evalForWorkspace(workspace, 'window.__gpiCsrf = null', {
    target: 'workbench',
    timeout: 5000,
    allTargets: true,
  }).catch(() => { });

  const result = await evalForWorkspace(workspace, buildBootstrapExpr(), {
    target: 'workbench',
    timeout: 20000,
    allTargets: true,
  });

  const hasCsrf = result.results?.some(r => r.value?.csrf);
  if (hasCsrf) {
    const best = result.results.find(r => r.value?.csrf);
    if (best.value?.headers) {
      console.log(`[GPI] Intercepted headers: ${JSON.stringify(best.value.headers)}`);
    }
    return { ...best.value, results: result.results };
  }

  if (workspace.type === 'cli') {
    try {
      const psOutput = await cliExec(workspace._id.toString(), 'ps aux 2>/dev/null || tasklist 2>nul', 5000);
      const csrfMatch = psOutput.match(/--csrf_token\s+([a-f0-9-]+)/);
      const portMatch = psOutput.match(/--extension_server_port\s+(\d+)/);
      if (csrfMatch) {
        const lines = psOutput.split('\n').filter(l => l.includes('--csrf_token'));
        const candidates = [];
        for (const line of lines) {
          const cm = line.match(/--csrf_token\s+([a-f0-9-]+)/);
          const pm = line.match(/--grpc_server_port\s+(\d+)/);
          if (cm) candidates.push({ csrf: cm[1], port: pm ? pm[1] : null });
        }
        console.log(`[GPI] Found ${candidates.length} CSRF candidates: ${candidates.map(c => c.csrf.substring(0, 8) + ':' + c.port).join(', ')}`);

        const validateExpr = (tokens) => `(async () => {
          try {
            const perf = performance.getEntriesByType('resource');
            let lsUrl = null;
            for (let i = perf.length - 1; i >= 0; i--) {
              if (perf[i].name.includes('LanguageServerService')) {
                lsUrl = new URL(perf[i].name).origin;
                break;
              }
            }
            if (!lsUrl) return { ok: false, error: 'no_ls' };
            const origFetch = window.__origFetch || window.fetch;
            const candidates = ${JSON.stringify(tokens)};
            for (const c of candidates) {
              try {
                const res = await origFetch(lsUrl + '/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'connect-protocol-version': '1', 'x-codeium-csrf-token': c.csrf },
                  body: '{}',
                });
                if (res.status === 200) {
                  window.__gpiCsrf = c.csrf;
                  return { ok: true, csrf: c.csrf, source: 'validated', lsUrl };
                }
              } catch {}
            }
            if (window.__gpiCsrf) return { ok: true, csrf: window.__gpiCsrf, source: 'intercepted' };
            return { ok: false, error: 'all_tokens_invalid', lsUrl, tried: candidates.length };
          } catch(e) {
            return { ok: false, error: e.message };
          }
        })()`;
        const valResult = await evalForWorkspace(workspace, validateExpr(candidates), {
          target: 'workbench',
          timeout: 15000,
        });
        const valBest = valResult.results?.find(r => r.value?.ok)?.value
          || valResult.results?.[0]?.value;
        console.log(`[GPI] CSRF validation: ${JSON.stringify(valBest).substring(0, 300)}`);
        if (valBest?.ok && valBest?.csrf) {
          return {
            ok: true,
            csrf: valBest.csrf,
            extensionPort: portMatch ? parseInt(portMatch[1]) : null,
            hasCsrf: true,
            installed: true,
          };
        }
      }
    } catch (err) {
      console.error('[GPI] CLI CSRF discovery failed:', err.message);
    }
  } else {
    const discovery = await discoverCsrfViaDocker(workspace.containerId);
    if (discovery?.csrf) {
      const lsUrl = await discoverLsUrl(workspace);
      const port = workspace.cdpPort || workspace.ports?.debug;
      await cdpEvalOnAllTargets(port, `window.__gpiCsrf = ${JSON.stringify(discovery.csrf)}`, {
        host: workspace.cdpHost,
        timeout: 5000,
      });
      return {
        ok: true,
        csrf: discovery.csrf,
        lsUrl,
        hasCsrf: true,
        installed: true,
      };
    }
  }

  const best = result.results?.[0];
  return { ...best?.value, results: result.results, ok: false };
}

export async function gpiSendMessage(workspace, cascadeId, message, model) {
  return gpiEval(workspace, buildSendExpr(cascadeId, message, model));
}

export async function gpiGetTrajectory(workspace, cascadeId) {
  return gpiEval(workspace, buildGetTrajectoryExpr(cascadeId));
}

export async function gpiGetAllTrajectories(workspace) {
  return gpiEval(workspace, buildGetAllTrajectoriesExpr());
}

export async function gpiStartCascade(workspace, modelUid) {
  return gpiEval(workspace, buildStartCascadeExpr(modelUid));
}

export async function gpiDiscoverModelUid(workspace) {
  const expr = `(async () => {
    try {
      if (window.__gpiModelUid) return { ok: true, modelUid: window.__gpiModelUid, source: 'intercepted' };

      try {
        const storage = Object.keys(localStorage);
        for (const key of storage) {
          if (key.includes('model') || key.includes('cascade') || key.includes('planner')) {
            const val = localStorage.getItem(key);
            if (val && val.length < 500) {
              try {
                const parsed = JSON.parse(val);
                if (parsed.modelUid || parsed.model_uid || parsed.requestedModelUid) {
                  const uid = parsed.modelUid || parsed.model_uid || parsed.requestedModelUid;
                  return { ok: true, modelUid: uid, source: 'localStorage:' + key };
                }
              } catch {}
            }
          }
        }
      } catch {}

      return { ok: false, error: 'not_found' };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  })()`;
  return gpiEval(workspace, expr);
}

export async function gpiCancelInvocation(workspace, cascadeId) {
  return gpiEval(workspace, buildCancelExpr(cascadeId));
}

export async function gpiGetModels(workspace) {
  const expr = `(async () => {
    try {
      const perf = performance.getEntriesByType('resource');
      let lsUrl = null;
      for (let i = perf.length - 1; i >= 0; i--) {
        if (perf[i].name.includes('LanguageServerService')) {
          const u = new URL(perf[i].name);
          lsUrl = u.origin;
          break;
        }
      }
      if (!lsUrl) return { ok: false, error: 'ls_not_found' };

      let csrf = window.__gpiCsrf;
      if (!csrf) {
        try {
          const frames = document.querySelectorAll('iframe');
          for (const f of frames) {
            try {
              const fc = f.contentWindow?.__gpiCsrf;
              if (fc) { csrf = fc; break; }
            } catch {}
          }
        } catch {}
      }
      if (!csrf) return { ok: false, error: 'no_csrf' };

      let apiKey = '';
      try {
        const items = await caches.keys().then(async names => {
          for (const name of names) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            for (const key of keys) {
              if (key.url.includes('api_key') || key.url.includes('apiKey')) {
                return key.url;
              }
            }
          }
          return null;
        });
      } catch {}

      try {
        if (!apiKey) {
          const perfEntries = performance.getEntriesByType('resource');
          for (const entry of perfEntries) {
            if (entry.name.includes('api_key=')) {
              const match = entry.name.match(/api_key=([^&]+)/);
              if (match) { apiKey = match[1]; break; }
            }
          }
        }
      } catch {}

      const origFetch = window.__origFetch || window.fetch;
      const res = await origFetch(lsUrl + '/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'connect-protocol-version': '1',
          'x-codeium-csrf-token': csrf,
        },
        body: JSON.stringify({
          metadata: {
            ideName: 'antigravity',
            locale: 'en',
            ideVersion: '1.15.8',
            extensionName: 'antigravity',
            apiKey: apiKey || undefined,
          },
        }),
      });

      const data = await res.json().catch(() => null);
      return { ok: res.status === 200, status: res.status, data, keys: data ? Object.keys(data) : [] };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  })()`;

  const result = await gpiEval(workspace, expr);
  console.log('[GPI] GetCascadeModelConfigs result:', JSON.stringify(result).substring(0, 800));
  if (!result?.ok || !result?.data) return { ok: false, error: result?.error || 'no_data', raw: result };

  const dataKeys = Object.keys(result.data);
  console.log('[GPI] Model data keys:', dataKeys);

  const configs = result.data.clientModelConfigs
    || result.data.client_model_configs
    || result.data.modelConfigs
    || result.data.model_configs
    || (dataKeys.length === 1 ? result.data[dataKeys[0]] : [])
    || [];

  const configArr = Array.isArray(configs) ? configs : [];
  console.log('[GPI] Model configs found:', configArr.length);

  const models = configArr
    .filter(c => !c.disabled)
    .map(c => {
      const moa = c.modelOrAlias || c.model_or_alias || {};
      return {
        label: c.label,
        modelOrAlias: moa,
        modelUid: c.modelUid || c.model_uid || moa.modelUid || moa.model_uid || '',
        isPremium: !!c.isPremium || !!c.is_premium,
        isBeta: !!c.isBeta || !!c.is_beta,
        isNew: !!c.isNew || !!c.is_new,
        supportsImages: !!c.supportsImages || !!c.supports_images,
      };
    });
  if (models.length > 0) {
    console.log('[GPI] First model sample:', JSON.stringify({ label: models[0].label, modelUid: models[0].modelUid, moaKeys: Object.keys(models[0].modelOrAlias) }));
    console.log('[GPI] Models with UIDs:', models.filter(m => m.modelUid).length, '/', models.length);
  }
  return { ok: true, models };
}

function parseTrajectoryItems(trajectory) {
  const items = [];
  const steps = trajectory?.steps || [];

  for (const step of steps) {
    switch (step.type) {
      case 'CORTEX_STEP_TYPE_USER_INPUT': {
        const ui = step.userInput || {};
        const query = ui.query || ui.items?.[0]?.text || '';
        if (query) items.push({ type: 'user', text: query });
        break;
      }
      case 'CORTEX_STEP_TYPE_PLANNER_RESPONSE': {
        if (step.plannerResponse?.thinking) {
          const dur = step.plannerResponse.thinkingDuration || '';
          let durationText = 'Thinking...';
          if (dur) {
            const secs = parseFloat(dur.replace('s', ''));
            durationText = isNaN(secs) ? `Thought for ${dur}` : `Thought for ${secs.toFixed(2)} seconds`;
          }
          items.push({
            type: 'thinking',
            text: durationText,
            content: step.plannerResponse.thinking.substring(0, 5000),
          });
        }
        if (step.plannerResponse?.response) {
          items.push({
            type: 'markdown',
            text: step.plannerResponse.response,
            html: step.plannerResponse.response,
          });
        }
        break;
      }
      case 'CORTEX_STEP_TYPE_RUN_COMMAND': {
        const cmd = step.runCommand || {};
        const cmdLine = cmd.commandLine || cmd.command || '';
        const cwd = cmd.cwd || '';
        const output = (typeof cmd.combinedOutput === 'object' ? cmd.combinedOutput?.full : cmd.combinedOutput) || cmd.output || '';
        const prefix = step.status === 'CORTEX_STEP_STATUS_DONE'
          ? 'Ran'
          : step.status === 'CORTEX_STEP_STATUS_RUNNING'
            ? 'Running'
            : 'Canceled';
        const prompt = cwd ? `${cwd} $ ${cmdLine}` : `$ ${cmdLine}`;
        const code = output ? `${prompt}\n${output}` : prompt;
        items.push({
          type: 'command',
          label: `${prefix} command`,
          code: code.substring(0, 3000),
        });
        break;
      }
      case 'CORTEX_STEP_TYPE_CODE_ACTION': {
        const ca = step.codeAction || {};
        const spec = ca.actionSpec || {};
        const result = ca.actionResult || {};
        const edit = result.edit || {};
        const fileUri = edit.absoluteUri || spec.createFile?.path || spec.editFile?.path || '';
        const file = fileUri.replace('file://', '');
        const isCreate = !!edit.createFile || !!spec.createFile;
        const action = isCreate ? 'Created' : 'Edited';
        let added = 0, removed = 0;
        const diffLines = edit.diff?.unifiedDiff?.lines || [];
        for (const line of diffLines) {
          if (line.type === 'UNIFIED_DIFF_LINE_TYPE_INSERT') added++;
          if (line.type === 'UNIFIED_DIFF_LINE_TYPE_DELETE') removed++;
        }
        let content = '';
        if (ca.isArtifactFile || file.includes('implementation_plan') || file.includes('plan')) {
          content = diffLines
            .filter(l => l.type === 'UNIFIED_DIFF_LINE_TYPE_INSERT')
            .map(l => l.text || '')
            .join('\n')
            .substring(0, 5000);
        }
        items.push({
          type: 'file_action',
          action,
          file: file.split('/').pop() || ca.description || 'file',
          fullPath: file || undefined,
          ext: (file.split('.').pop() || '').toUpperCase(),
          diff: `+${added}-${removed}`,
          content: content || undefined,
        });
        break;
      }
      case 'CORTEX_STEP_TYPE_VIEW_FILE': {
        const vf = step.viewFile || {};
        const uri = vf.absolutePathUri || '';
        const file = uri.replace('file://', '');
        const basename = file.split('/').pop() || 'file';
        const ext = (basename.split('.').pop() || '').toUpperCase();
        const endLine = vf.endLine || vf.numLines || '';
        const lineRange = endLine ? `#L1-${endLine}` : '';
        items.push({ type: 'file_action', action: 'Analyzed', file: basename, fullPath: file || undefined, ext, lineRange });
        break;
      }
      case 'CORTEX_STEP_TYPE_LIST_DIRECTORY': {
        const uri = step.listDirectory?.directoryPathUri || '';
        const dir = uri.replace('file://', '');
        const basename = dir.split('/').pop() || dir || '/';
        items.push({ type: 'file_action', action: 'Listed', file: basename });
        break;
      }
      case 'CORTEX_STEP_TYPE_FIND': {
        const f = step.find || {};
        const dir = (f.searchDirectory || '').split('/').pop() || '';
        const pattern = f.pattern || '';
        items.push({ type: 'file_action', action: 'Searched', file: `${pattern} in ${dir}`.trim() });
        break;
      }
      case 'CORTEX_STEP_TYPE_SEARCH': {
        const s = step.search || step.grepSearch || {};
        const query = s.query || s.pattern || '';
        items.push({ type: 'file_action', action: 'Searched', file: query.substring(0, 80) });
        break;
      }
      case 'CORTEX_STEP_TYPE_FILE_WRITE': {
        const fw = step.fileWrite || step.writeToFile || {};
        const file = (fw.absolutePathUri || fw.filePath || '').replace('file://', '');
        const basename = file.split('/').pop() || 'file';
        const ext = (basename.split('.').pop() || '').toUpperCase();
        items.push({ type: 'file_action', action: 'Wrote', file: basename, fullPath: file || undefined, ext });
        break;
      }
      case 'CORTEX_STEP_TYPE_BROWSER_SCREENSHOT':
      case 'CORTEX_STEP_TYPE_BROWSER_SUBAGENT': {
        items.push({ type: 'tool', text: 'Browser action' });
        break;
      }
      case 'CORTEX_STEP_TYPE_COMMAND_STATUS': {
        const cs = step.commandStatus || step.runCommand || {};
        const output = cs?.output || cs?.commandLine || cs?.command || '';
        if (output) {
          items.push({
            type: 'command',
            label: `Command output`,
            code: output.substring(0, 2000),
          });
        }
        break;
      }
      case 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE':
        break;
      case 'CORTEX_STEP_TYPE_TASK_BOUNDARY': {
        const tb = step.taskBoundary || {};
        if (tb.taskName) {
          items.push({
            type: 'progress',
            title: tb.taskName || '',
            status: tb.taskStatus || '',
            summary: tb.taskSummary || '',
            mode: tb.mode || '',
          });
        }
        break;
      }
      case 'CORTEX_STEP_TYPE_NOTIFY_USER': {
        const nu = step.notifyUser || {};
        const uris = nu.reviewAbsoluteUris || [];
        const file = uris[0] ? uris[0].replace('file://', '') : '';
        items.push({
          type: 'plan_review',
          text: nu.notificationContent || '',
          file: file.split('/').pop() || '',
          fullPath: file,
          isBlocking: !!nu.isBlocking && step.status === 'CORTEX_STEP_STATUS_WAITING',
        });
        break;
      }
      case 'CORTEX_STEP_TYPE_GREP_SEARCH': {
        const gs = step.grepSearch || {};
        const query = gs.query || '';
        const searchPath = (gs.searchPathUri || '').replace('file://', '');
        const dir = searchPath.split('/').pop() || '';
        items.push({ type: 'file_action', action: 'Searched', file: `"${query}" in ${dir}` });
        break;
      }
      case 'CORTEX_STEP_TYPE_GREP_SEARCH_V2': {
        const gs = step.grepSearchV2 || step.grep_search_v2 || {};
        const pattern = gs.pattern || '';
        const searchPath = (gs.searchPathUri || gs.search_path_uri || '').replace('file://', '');
        const dir = searchPath.split('/').pop() || '';
        items.push({ type: 'file_action', action: 'Searched', file: `"${pattern}" in ${dir}` });
        break;
      }
      case 'CORTEX_STEP_TYPE_VIEW_FILE_OUTLINE': {
        const vfo = step.viewFileOutline || {};
        const uri = vfo.absolutePathUri || '';
        const file = uri.replace('file://', '');
        const basename = file.split('/').pop() || 'file';
        const ext = (basename.split('.').pop() || '').toUpperCase();
        items.push({ type: 'file_action', action: 'Analyzed', file: basename, fullPath: file || undefined, ext });
        break;
      }
      case 'CORTEX_STEP_TYPE_VIEW_CODE_ITEM': {
        const vci = step.viewCodeItem || step.view_code_item || {};
        const uri = vci.absolutePathUri || vci.absolute_path_uri || '';
        const file = uri.replace('file://', '');
        const basename = file.split('/').pop() || 'file';
        const ext = (basename.split('.').pop() || '').toUpperCase();
        const nodeName = vci.nodePath || vci.node_path || '';
        items.push({ type: 'file_action', action: 'Analyzed', file: nodeName ? `${nodeName} in ${basename}` : basename, fullPath: file || undefined, ext });
        break;
      }
      case 'CORTEX_STEP_TYPE_WRITE_TO_FILE': {
        const wf = step.writeToFile || step.write_to_file || {};
        const uri = wf.absolutePathUri || wf.absolute_path_uri || wf.filePath || '';
        const file = uri.replace('file://', '');
        const basename = file.split('/').pop() || 'file';
        const ext = (basename.split('.').pop() || '').toUpperCase();
        items.push({ type: 'file_action', action: 'Created', file: basename, fullPath: file || undefined, ext });
        break;
      }
      case 'CORTEX_STEP_TYPE_ERROR_MESSAGE': {
        const em = step.errorMessage || step.error_message || {};
        const err = em.error || step.error || {};
        const text = err.userErrorMessage || err.user_error_message || err.shortError || err.short_error || err.fullError || err.full_error || 'An error occurred';
        items.push({ type: 'error', text: text.substring(0, 1000) });
        break;
      }
      case 'CORTEX_STEP_TYPE_MCP_TOOL': {
        const mcp = step.mcpTool || step.mcp_tool || {};
        const name = mcp.toolName || mcp.tool_name || mcp.serverName || mcp.server_name || 'MCP Tool';
        items.push({ type: 'tool', text: `MCP: ${name}` });
        break;
      }
      case 'CORTEX_STEP_TYPE_MEMORY': {
        const mem = step.memory || {};
        const content = mem.content || mem.text || '';
        if (content) items.push({ type: 'tool', text: `Memory: ${content.substring(0, 200)}` });
        break;
      }
      case 'CORTEX_STEP_TYPE_READ_URL_CONTENT': {
        const ruc = step.readUrlContent || step.read_url_content || {};
        const url = ruc.url || '';
        items.push({ type: 'tool', text: `Read URL: ${url.substring(0, 200)}` });
        break;
      }
      case 'CORTEX_STEP_TYPE_SEARCH_WEB': {
        const sw = step.searchWeb || step.search_web || {};
        const query = sw.query || '';
        items.push({ type: 'tool', text: `Web search: ${query.substring(0, 200)}` });
        break;
      }
      case 'CORTEX_STEP_TYPE_GIT_COMMIT': {
        const gc = step.gitCommit || step.git_commit || {};
        const message = gc.commitMessage || gc.commit_message || gc.message || '';
        items.push({ type: 'tool', text: `Git commit: ${message.substring(0, 200)}` });
        break;
      }
      case 'CORTEX_STEP_TYPE_READ_TERMINAL': {
        const rt = step.readTerminal || step.read_terminal || {};
        const name = rt.name || rt.processId || rt.process_id || 'terminal';
        items.push({ type: 'tool', text: `Read terminal: ${name}` });
        break;
      }
      case 'CORTEX_STEP_TYPE_TODO_LIST': {
        const tl = step.todoList || step.todo_list || {};
        const todos = tl.todos || [];
        if (todos.length) {
          const summary = todos.map(t => `${t.status === 'CORTEX_TODO_LIST_ITEM_STATUS_COMPLETED' ? '✓' : '○'} ${t.content || ''}`).join('\n');
          items.push({ type: 'tool', text: summary.substring(0, 500) });
        }
        break;
      }
      case 'CORTEX_STEP_TYPE_FINISH':
      case 'CORTEX_STEP_TYPE_DUMMY':
      case 'CORTEX_STEP_TYPE_INFORM':
      case 'CORTEX_STEP_TYPE_CHECKPOINT':
      case 'CORTEX_STEP_TYPE_SUGGESTED_RESPONSES':
      case 'CORTEX_STEP_TYPE_BLOCKING':
        break;
      default: {
        if (step.error) {
          const err = step.error;
          const text = err.userErrorMessage || err.user_error_message || err.shortError || err.short_error || err.fullError || err.full_error || '';
          if (text) {
            items.push({ type: 'error', text: text.substring(0, 1000) });
          }
        }
        break;
      }
    }
  }

  const grouped = [];
  let currentTask = null;
  let taskBroken = false;
  for (const item of items) {
    if (item.type === 'progress') {
      if (currentTask && !taskBroken && currentTask.title === item.title) {
        currentTask.summary = item.summary;
        currentTask.mode = item.mode;
        if (item.status) currentTask.steps.push(item);
      } else {
        const block = {
          type: 'task_block',
          title: item.title,
          summary: item.summary,
          mode: item.mode,
          steps: item.status ? [item] : [],
          files: [],
        };
        grouped.push(block);
        currentTask = block;
        taskBroken = false;
      }
    } else if (item.type === 'file_action') {
      if (currentTask && !taskBroken) {
        if (!currentTask.files.find(f => f.fullPath === item.fullPath && f.action === item.action)) {
          currentTask.files.push(item);
        }
      } else {
        grouped.push(item);
      }
    } else {
      taskBroken = true;
      grouped.push(item);
    }
  }

  return grouped;
}

export function trajectoryToConversation(trajectoryData) {
  const trajectory = trajectoryData?.trajectory;
  if (!trajectory) return { turnCount: 0, items: [], statusText: '', isBusy: false };

  const items = parseTrajectoryItems(trajectory);
  const steps = trajectory.steps || [];
  const lastStep = steps[steps.length - 1];
  const isBusy = lastStep?.status === 'CORTEX_STEP_STATUS_RUNNING'
    || lastStep?.status === 'CORTEX_STEP_STATUS_WAITING';

  const pendingSteps = steps.filter(s => s.status === 'CORTEX_STEP_STATUS_WAITING');
  const hasAcceptAll = pendingSteps.some(s =>
    s.type === 'CORTEX_STEP_TYPE_CODE_ACTION'
    || s.type === 'CORTEX_STEP_TYPE_RUN_COMMAND'
  );

  let statusText = '';
  if (isBusy) {
    statusText = lastStep?.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' ? 'Generating' : 'Working';
  }

  const turnCount = items.length;
  const lastItem = items[items.length - 1];
  const lastText = lastItem?.text || lastItem?.html || lastItem?.code || '';
  const hash = `${turnCount}:${isBusy}:${hasAcceptAll}:${hasAcceptAll}:${statusText}:${items.length}:${lastText.length}`;

  return {
    turnCount,
    items,
    statusText,
    isBusy,
    hasAcceptAll,
    hasRejectAll: hasAcceptAll,
    hash,
    cascadeId: trajectory.cascadeId,
    trajectoryId: trajectory.trajectoryId,
  };
}
