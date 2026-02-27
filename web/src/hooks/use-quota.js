import { useState, useEffect } from 'react';

export function useQuota(workspace, ws) {
  const [quota, setQuota] = useState(null);
  const workspaceId = workspace?._id;
  const isRunning = workspace?.status === 'running';
  const hasAuth = !!workspace?.auth?.email;

  useEffect(() => {
    if (!isRunning || !hasAuth) {
      setQuota(null);
    }
  }, [isRunning, hasAuth]);

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

  return { quota };
}
