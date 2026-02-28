import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBase } from '../config';
import { getAuthHeaders } from './use-auth';

export function useAgConnect(workspace, ws) {
  const [status, setStatus] = useState('disconnected');
  const [statusText, setStatusText] = useState('');
  const [currentModel, setCurrentModel] = useState(workspace?.gpi?.selectedModel || '');
  const [isBusy, setIsBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasAcceptAll, setHasAcceptAll] = useState(false);
  const [hasRejectAll, setHasRejectAll] = useState(false);

  const workspaceId = workspace?._id;
  const apiBase = `${getApiBase()}/api/workspaces/${workspaceId}`;

  const api = useCallback(async (method, path, body) => {
    if (!workspaceId) return {};
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${apiBase}${path}`, opts);
    return res.json();
  }, [workspaceId, apiBase]);

  const sendMessage = useCallback(async (text) => {
    return api('POST', '/cdp/send', { text });
  }, [api]);

  const stopAgent = useCallback(async () => {
    return api('POST', '/cdp/stop', {});
  }, [api]);

  const fetchModels = useCallback(async () => {
    return api('GET', '/cdp/models');
  }, [api]);

  const changeModel = useCallback(async (model, modelUid) => {
    setCurrentModel(model);
    return api('POST', '/cdp/models/select', { model, modelUid });
  }, [api]);

  const clickAcceptAll = useCallback(async () => {
    return api('POST', '/cdp/accept-all', {});
  }, [api]);

  const clickRejectAll = useCallback(async () => {
    return api('POST', '/cdp/reject-all', {});
  }, [api]);

  const clickNewChat = useCallback(async () => {
    setItems([]);
    return api('POST', '/cdp/new-chat', {});
  }, [api]);

  const fetchConversations = useCallback(async () => {
    return api('GET', '/cdp/conversations');
  }, [api]);

  const captureScreenshot = useCallback(async () => {
    return api('GET', '/cdp/screenshot');
  }, [api]);

  const fetchChat = useCallback(async () => {
    return api('GET', '/cdp/conversation');
  }, [api]);

  const syncChat = useCallback(async () => {
    setIsLoading(true);
    try {
      const msg = await fetchChat();
      if (msg && msg.items) {
        setItems(msg.items || []);
        setStatusText(msg.statusText || '');
        setIsBusy(!!msg.isBusy);
        setHasAcceptAll(!!msg.hasAcceptAll);
        setHasRejectAll(!!msg.hasRejectAll);
      }
    } catch { }
    setIsLoading(false);
  }, [fetchChat]);

  const fetchTargets = useCallback(async () => {
    return api('GET', '/cdp/targets');
  }, [api]);

  const closeTarget = useCallback(async (targetId) => {
    return api('POST', '/cdp/targets/close', { targetId });
  }, [api]);

  const selectConversation = useCallback(async (title) => {
    setItems([]);
    setIsLoading(true);
    await api('POST', '/cdp/conversations/select', { title });
    await syncChat();
  }, [api, syncChat]);

  useEffect(() => {
    setItems([]);
    setStatusText('');
    setIsBusy(false);
    setHasAcceptAll(false);
    setHasRejectAll(false);
    setCurrentModel('');
    setStatus('disconnected');
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId && workspace?.status === 'running') {
      setStatus('connected');

      syncChat();

      fetchModels().then(res => {
        let val = null;
        if (res?.results) {
          val = res.results.find(r => r.value?.ok)?.value;
        } else if (res?.ok) {
          val = res;
        }
        if (val?.current) setCurrentModel(val.current);
      }).catch(() => { });
    } else {
      setStatus('disconnected');
    }
  }, [workspaceId, workspace?.status, fetchModels, fetchChat]);

  useEffect(() => {
    if (!ws || !workspaceId) return;
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'conversation:update' && msg.payload?.id === workspaceId) {
          setItems(msg.payload.items || []);
          setStatusText(msg.payload.statusText || '');
          setIsBusy(!!msg.payload.isBusy);
          setHasAcceptAll(!!msg.payload.hasAcceptAll);
          setHasRejectAll(!!msg.payload.hasRejectAll);
        }
      } catch { }
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [ws, workspaceId]);

  return {
    status, statusText, currentModel, setCurrentModel,
    isBusy, isLoading, items, hasAcceptAll, hasRejectAll,
    sendMessage, stopAgent,
    fetchModels, changeModel,
    clickAcceptAll, clickRejectAll,
    clickNewChat, fetchConversations, selectConversation,
    captureScreenshot, fetchTargets, closeTarget,
    api, syncChat,
  };
}
