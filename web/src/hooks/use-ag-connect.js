import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBase } from '../config';
import { getAuthHeaders } from './use-auth';

export function useAgConnect(workspace, ws, activeTargetId) {
  const [status, setStatus] = useState('disconnected');
  const [statusText, setStatusText] = useState('');
  const [currentModel, setCurrentModel] = useState(workspace?.gpi?.selectedModel || '');
  const [currentModelUid, setCurrentModelUid] = useState(workspace?.gpi?.selectedModelUid || '');
  const [isBusy, setIsBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasAcceptAll, setHasAcceptAll] = useState(false);
  const [hasRejectAll, setHasRejectAll] = useState(false);
  const [targets, setTargets] = useState([]);
  const activeTargetRef = useRef(activeTargetId);

  useEffect(() => {
    activeTargetRef.current = activeTargetId;
  }, [activeTargetId]);

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
    const body = { text };
    if (activeTargetRef.current) body.targetId = activeTargetRef.current;
    if (currentModelUid) body.modelUid = currentModelUid;
    return api('POST', '/cdp/send', body);
  }, [api, currentModelUid]);

  const stopAgent = useCallback(async () => {
    return api('POST', '/cdp/stop', {});
  }, [api]);

  const fetchModels = useCallback(async () => {
    return api('GET', '/cdp/models');
  }, [api]);

  const changeModel = useCallback(async (model, modelUid) => {
    setCurrentModel(model);
    setCurrentModelUid(modelUid || '');
  }, []);

  const clickAcceptAll = useCallback(async () => {
    return api('POST', '/cdp/accept-all', {});
  }, [api]);

  const clickRejectAll = useCallback(async () => {
    return api('POST', '/cdp/reject-all', {});
  }, [api]);

  const clickNewChat = useCallback(async () => {
    setItems([]);
    const body = {};
    if (activeTargetRef.current) body.targetId = activeTargetRef.current;
    if (currentModelUid) body.modelUid = currentModelUid;
    return api('POST', '/cdp/new-chat', body);
  }, [api, currentModelUid]);

  const fetchConversations = useCallback(async (folder) => {
    const qs = folder ? `?folder=${encodeURIComponent(folder)}` : '';
    return api('GET', `/cdp/conversations${qs}`);
  }, [api]);

  const captureScreenshot = useCallback(async () => {
    return api('GET', '/cdp/screenshot');
  }, [api]);

  const fetchChat = useCallback(async (targetId) => {
    const tid = targetId || activeTargetRef.current;
    const qs = tid ? `?targetId=${encodeURIComponent(tid)}` : '';
    return api('GET', `/cdp/conversation${qs}`);
  }, [api]);

  const syncChat = useCallback(async (targetId) => {
    setIsLoading(true);
    try {
      const msg = await fetchChat(targetId);
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

  const selectConversation = useCallback(async (title, cascadeId) => {
    setItems([]);
    setIsLoading(true);
    const body = { title };
    if (cascadeId) body.cascadeId = cascadeId;
    if (activeTargetRef.current) body.targetId = activeTargetRef.current;
    await api('POST', '/cdp/conversations/select', body);
    await syncChat();
  }, [api, syncChat]);

  useEffect(() => {
    setItems([]);
    setStatusText('');
    setIsBusy(false);
    setHasAcceptAll(false);
    setHasRejectAll(false);
    setCurrentModel('');
    setCurrentModelUid('');
    setStatus('disconnected');
    setTargets([]);
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
        if (val?.current) {
          setCurrentModel(val.current);
          const found = val.models?.find(m => m.label === val.current);
          if (found?.modelUid) setCurrentModelUid(found.modelUid);
        }
      }).catch(() => { });

      fetchTargets().then(res => {
        if (Array.isArray(res)) setTargets(res);
      }).catch(() => { });
    } else {
      setStatus('disconnected');
    }
  }, [workspaceId, workspace?.status, fetchModels, syncChat, fetchTargets]);

  useEffect(() => {
    if (!ws || !workspaceId) return;
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'conversation:update' && msg.payload?.id === workspaceId) {
          const payloadTarget = msg.payload.targetId;
          const currentTarget = activeTargetRef.current;
          if (payloadTarget && currentTarget && payloadTarget !== currentTarget) return;
          if (!payloadTarget && currentTarget) return;
          setItems(msg.payload.items || []);
          setStatusText(msg.payload.statusText || '');
          setIsBusy(!!msg.payload.isBusy);
          setHasAcceptAll(!!msg.payload.hasAcceptAll);
          setHasRejectAll(!!msg.payload.hasRejectAll);
        }
        if (msg.event === 'targets:update' && msg.payload?.id === workspaceId) {
          setTargets(msg.payload.targets || []);
        }
      } catch { }
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [ws, workspaceId]);

  const openFolder = useCallback(async (folderPath) => {
    return api('POST', '/cdp/open-folder', { folderPath });
  }, [api]);

  const openFolderNewWindow = useCallback(async (folderPath) => {
    return api('POST', '/cdp/open-folder-new-window', { folderPath });
  }, [api]);

  const openHistory = useCallback(async () => {
    return api('POST', '/cdp/history', {});
  }, [api]);

  return {
    status, statusText, currentModel, setCurrentModel,
    isBusy, isLoading, items, hasAcceptAll, hasRejectAll,
    sendMessage, stopAgent,
    fetchModels, changeModel,
    clickAcceptAll, clickRejectAll,
    clickNewChat, fetchConversations, selectConversation,
    captureScreenshot, fetchTargets, closeTarget, targets, setTargets,
    openFolder, openFolderNewWindow, openHistory,
    api, syncChat,
  };
}
