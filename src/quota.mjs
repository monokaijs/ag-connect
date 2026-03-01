import os from 'os';

const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLOUD_CODE_BASE_URL = 'https://daily-cloudcode-pa.sandbox.googleapis.com';

const QUOTA_ENDPOINTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];

const osName = os.platform() === 'darwin' ? 'darwin' : os.platform() === 'win32' ? 'win32' : 'linux';
const AG_USER_AGENT = `antigravity/1.19.5 ${osName}/${os.arch()}`;

const CLOUD_HEADERS = {
  'Content-Type': 'application/json',
  'x-client-name': 'antigravity',
  'x-goog-api-client': 'gl-node/18.18.2 fire/0.8.6 grpc/1.10.x',
};

async function refreshAccessToken(refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchTierAndProject(accessToken) {
  try {
    const res = await fetch(`${CLOUD_CODE_BASE_URL}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: {
        ...CLOUD_HEADERS,
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': AG_USER_AGENT,
      },
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });
    if (!res.ok) return { projectId: '', tier: 'free' };
    const data = await res.json();
    const projectId = data.cloudaicompanionProject || '';
    const rawTier = (data.paidTier?.id || data.currentTier?.id || '').toLowerCase();
    let tier = 'free';
    if (rawTier.includes('ultra')) tier = 'ultra';
    else if (rawTier.includes('pro') || rawTier.includes('premium') || rawTier.includes('enterprise')) tier = 'pro';
    return { projectId, tier };
  } catch {
    return { projectId: '', tier: 'free' };
  }
}

async function fetchQuotas(accessToken, projectId) {
  const headers = {
    ...CLOUD_HEADERS,
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': AG_USER_AGENT,
  };
  const body = JSON.stringify(projectId ? { project: projectId } : {});

  for (const endpoint of QUOTA_ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: 'POST',
        headers,
        body,
      });
      if (!res.ok) {
        console.log(`[quota] ${endpoint} failed:`, res.status);
        continue;
      }
      const data = await res.json();
      const quotas = {};
      const resets = {};
      for (const [name, info] of Object.entries(data.models || {})) {
        const lower = name.toLowerCase();
        if (!lower.includes('gemini') && !lower.includes('claude')) continue;
        const pct = info.quotaInfo?.remainingFraction != null
          ? Math.round(info.quotaInfo.remainingFraction * 100)
          : 0;
        quotas[name] = pct;
        if (info.quotaInfo?.resetTime) resets[name] = info.quotaInfo.resetTime;
      }
      return { quotas, resets };
    } catch (err) {
      console.log(`[quota] ${endpoint} error:`, err.message);
      continue;
    }
  }
  return { quotas: {}, resets: {} };
}

async function getValidAccessToken(auth) {
  if (!auth?.refreshToken) return auth?.accessToken || null;
  const now = Math.floor(Date.now() / 1000);
  if (auth.accessToken && auth.expiryTimestamp && now < auth.expiryTimestamp - 300) {
    return auth.accessToken;
  }
  const result = await refreshAccessToken(auth.refreshToken);
  if (!result?.access_token) return auth.accessToken || null;
  auth.accessToken = result.access_token;
  auth.expiryTimestamp = Math.floor(Date.now() / 1000) + (result.expires_in || 3600);
  return result.access_token;
}

async function fetchWorkspaceQuota(workspace) {
  if (!workspace?.auth?.accessToken) return null;
  const oldToken = workspace.auth.accessToken;
  const accessToken = await getValidAccessToken(workspace.auth);
  if (!accessToken) return null;
  if (accessToken !== oldToken && workspace.accountId) {
    try {
      const { Account } = await import('./models/account.mjs');
      await Account.findByIdAndUpdate(workspace.accountId, {
        accessToken: workspace.auth.accessToken,
        expiryTimestamp: workspace.auth.expiryTimestamp,
      });
    } catch { }
  }
  const { projectId, tier } = await fetchTierAndProject(accessToken);
  const { quotas, resets } = await fetchQuotas(accessToken, projectId);
  return { tier, projectId, quotas, resets };
}

export { fetchWorkspaceQuota, refreshAccessToken, getValidAccessToken };
