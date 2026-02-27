import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiBase, getWsBase } from '../config';
import { getAuthToken, getAuthHeaders } from './use-auth';

const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
].join(' ');

function authFetch(url, opts = {}) {
  const headers = { ...getAuthHeaders(), ...(opts.headers || {}) };
  return fetch(url, { ...opts, headers });
}

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const wsRef = useRef(null);
  const [wsInstance, setWsInstance] = useState(null);
  const reconnectTimer = useRef(null);

  const wsBackoff = useRef(2000);

  const connect = useCallback(() => {
    const token = getAuthToken();
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const base = getWsBase() ? `${getWsBase()}/api/ws` : `${protocol}://${window.location.host}/api/ws`;
    const wsUrl = `${base}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      wsBackoff.current = 2000;
      setWsInstance(ws);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleEvent(msg);
      } catch { }
    };

    ws.onclose = () => {
      setWsInstance(null);
      reconnectTimer.current = setTimeout(connect, wsBackoff.current);
      wsBackoff.current = Math.min(wsBackoff.current * 1.5, 30000);
    };

    wsRef.current = ws;
  }, []);

  const handleEvent = useCallback((msg) => {
    const { event, payload } = msg;

    switch (event) {
      case 'workspace:created':
        setWorkspaces(prev => [payload, ...prev]);
        setActiveId(payload._id);
        break;

      case 'workspace:removed':
        setWorkspaces(prev => prev.filter(w => w._id !== payload.id));
        setActiveId(prev => prev === payload.id ? null : prev);
        break;

      case 'workspace:updated':
        setWorkspaces(prev => prev.map(w => w._id === payload._id ? { ...w, ...payload } : w));
        break;

      case 'workspace:status':
        setWorkspaces(prev => prev.map(w =>
          w._id === payload.id
            ? { ...w, status: payload.status, stage: payload.stage || '', error: payload.message && payload.status === 'error' ? payload.message : w.error }
            : w
        ));
        break;

      case 'workspace:log':
        setWorkspaces(prev => prev.map(w =>
          w._id === payload.id
            ? { ...w, initLogs: [...(w.initLogs || []), payload.line] }
            : w
        ));
        break;

      case 'workspace:auth':
        setWorkspaces(prev => prev.map(w =>
          w._id === payload.id
            ? { ...w, auth: { ...w.auth, email: payload.email, avatar: payload.avatar, name: payload.name } }
            : w
        ));
        break;

      case 'workspace:deleted':
        setWorkspaces(prev => {
          const next = prev.filter(w => w._id !== payload.id);
          setActiveId(id => id === payload.id ? (next[0]?._id || null) : id);
          return next;
        });
        break;
    }
  }, []);

  useEffect(() => {
    connect();
    fetchWorkspaces();
    handleOAuthCallback();

    const poll = setInterval(fetchWorkspaces, 3000);

    return () => {
      clearInterval(poll);
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const handleOAuthCallback = async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const stateB64 = params.get('state');
    if (!code || !stateB64) return;

    window.history.replaceState({}, '', '/');

    try {
      const state = JSON.parse(atob(stateB64.replace(/-/g, '+').replace(/_/g, '/')));
      const workspaceId = state.workspace;
      const redirectUri = `${window.location.origin}/api/oauth/google/callback`;

      setActiveId(workspaceId);

      const res = await authFetch(`${getApiBase()}/api/oauth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, workspaceId, redirectUri }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('[oauth] Exchange failed:', err);
      }
    } catch (err) {
      console.error('[oauth] Callback error:', err);
    }
  };

  const fetchWorkspaces = async () => {
    try {
      const res = await authFetch(`${getApiBase()}/api/workspaces`);
      if (res.status === 401) return;
      const data = await res.json();
      setWorkspaces(data);
      if (data.length > 0 && !activeId) {
        setActiveId(data[0]._id);
      }
    } catch (err) {
      console.error('[workspaces] fetch error:', err);
    }
  };

  const createWorkspace = async (name, mountedPath, icon, color) => {
    const res = await authFetch(`${getApiBase()}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mountedPath, icon, color }),
    });
    return res.json();
  };

  const updateWorkspace = async (id, data) => {
    const res = await authFetch(`${getApiBase()}/api/workspaces/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  };

  const deleteWorkspace = async (id) => {
    await authFetch(`${getApiBase()}/api/workspaces/${id}`, { method: 'DELETE' });
  };

  const stopWorkspace = async (id) => {
    await authFetch(`${getApiBase()}/api/workspaces/${id}/stop`, { method: 'POST' });
  };

  const startWorkspace = async (id) => {
    await authFetch(`${getApiBase()}/api/workspaces/${id}/start`, { method: 'POST' });
  };

  const restartWorkspace = async (id) => {
    await authFetch(`${getApiBase()}/api/workspaces/${id}/restart`, { method: 'POST' });
  };

  const clearAuth = async (id) => {
    await authFetch(`${getApiBase()}/api/workspaces/${id}/clear-auth`, { method: 'POST' });
  };

  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const LOCALHOST_REDIRECT = 'http://localhost:1/oauth/callback';

  const [oauthPending, setOauthPending] = useState(null);

  const loginWorkspace = (id) => {
    const state = btoa(JSON.stringify({ workspace: id }));

    if (isLocalhost) {
      const redirectUri = `${window.location.origin}/api/oauth/google/callback`;
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      window.location.href = `${GOOGLE_AUTH_URL}?${params.toString()}`;
    } else {
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: LOCALHOST_REDIRECT,
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      const url = `${GOOGLE_AUTH_URL}?${params.toString()}`;
      setOauthPending({ workspaceId: id, url });
    }
  };

  const submitOAuthCallback = async (callbackUrl) => {
    if (!oauthPending) return;
    try {
      const trimmed = callbackUrl.trim();
      const url = new URL(trimmed);
      const code = url.searchParams.get('code');
      if (!code) {
        alert('No authorization code found in the URL. Make sure you copied the full URL.');
        return;
      }

      const pendingWs = oauthPending.workspaceId;
      setOauthPending(null);
      setActiveId(pendingWs);

      const res = await authFetch(`${getApiBase()}/api/oauth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          workspaceId: pendingWs,
          redirectUri: LOCALHOST_REDIRECT,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('[oauth] Exchange failed:', err);
      }
    } catch (err) {
      console.error('[oauth] Submit callback error:', err);
      alert('Invalid URL. Please paste the full URL from the browser address bar.');
    }
  };

  const cancelOAuth = () => setOauthPending(null);

  const activeWorkspace = workspaces.find(w => w._id === activeId) || null;

  return {
    workspaces,
    activeId,
    activeWorkspace,
    setActiveId,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    stopWorkspace,
    startWorkspace,
    restartWorkspace,
    clearAuth,
    loginWorkspace,
    oauthPending,
    submitOAuthCallback,
    cancelOAuth,
    fetchWorkspaces,
    ws: wsInstance,
  };
}
