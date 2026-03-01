import { useState, useEffect } from 'react';
import { getApiBase } from '@/config';
import { getAuthHeaders } from '@/hooks/use-auth';

export function useQuota(workspace, ws) {
  const [quota, setQuota] = useState(null);
  const [allQuotas, setAllQuotas] = useState({});
  const workspaceId = workspace?._id;
  const isRunning = workspace?.status === 'running';
  const hasAuth = !!workspace?.auth?.email;

  useEffect(() => {
    if (!isRunning || !hasAuth || !workspaceId) {
      setQuota(null);
      return;
    }
    fetch(`${getApiBase()}/api/workspaces/${workspaceId}/quota`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(data => { if (data?.ok) setQuota(data); })
      .catch(() => { });
  }, [workspaceId, isRunning, hasAuth]);

  useEffect(() => {
    if (!ws) return;
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
        if (msg.event === 'quota:all' && msg.payload) {
          setAllQuotas(msg.payload);
        }
      } catch { }
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [ws, workspaceId]);

  return { quota, allQuotas };
}
