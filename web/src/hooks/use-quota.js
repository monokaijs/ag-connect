import { useState, useEffect, useCallback, useRef } from 'react';

import { API_BASE } from '../config';

export function useQuota(workspace, ws) {
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const workspaceId = workspace?._id;
  const isRunning = workspace?.status === 'running';
  const hasAuth = !!workspace?.auth?.email;

  const fetchQuota = useCallback(async () => {
    if (!workspaceId || !isRunning || !hasAuth) return;
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/quota`);
      const data = await res.json();
      if (data.ok) {
        setQuota(data);
      }
    } catch { }
    setLoading(false);
  }, [workspaceId, isRunning, hasAuth]);

  useEffect(() => {
    if (!isRunning || !hasAuth) {
      setQuota(null);
      return;
    }

    fetchQuota();
    timerRef.current = setInterval(fetchQuota, 30000);
    return () => clearInterval(timerRef.current);
  }, [fetchQuota, isRunning, hasAuth]);

  useEffect(() => {
    if (!ws || !workspaceId) return;
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'workspace:quota' && msg.payload?.id === workspaceId) {
          setQuota({
            ok: true,
            tier: msg.payload.tier,
            projectId: msg.payload.projectId,
            quotas: msg.payload.quotas,
            resets: msg.payload.resets,
          });
        }
      } catch { }
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [ws, workspaceId]);

  return { quota, loading, refetch: fetchQuota };
}
