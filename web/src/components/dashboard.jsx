import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConversationItem } from '@/components/conversation-item';
import { WorkspaceHostPanel } from '@/components/host-panel';
import GitPanel from '@/components/git-panel';
import FileEditor from '@/components/file-editor';

import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import {
  Zap,
  Send,
  Square,
  MessageSquare,
  Plus,
  Loader2,
  ChevronUp,
  Check,
  History,
  Search,
  X,
  TerminalSquare,
  Wifi,
  WifiOff,
  GitBranch,
  Folder,
  FolderOpen,
} from 'lucide-react';

function getQuotaBarColor(pct) {
  if (pct >= 70) return 'bg-emerald-400';
  if (pct >= 40) return 'bg-yellow-400';
  if (pct >= 15) return 'bg-orange-400';
  return 'bg-red-400';
}

function getQuotaTextColor(pct) {
  if (pct >= 70) return 'text-emerald-400';
  if (pct >= 40) return 'text-yellow-400';
  if (pct >= 15) return 'text-orange-400';
  return 'text-red-400';
}

function findModelQuota(label, quota) {
  if (!quota?.quotas || !label) return null;
  const normalized = label.toLowerCase().replace(/\s+/g, '-');
  for (const [key, value] of Object.entries(quota.quotas)) {
    const cleanKey = key.replace(/^models\//, '').toLowerCase();
    if (cleanKey.includes(normalized) || normalized.includes(cleanKey)) return value;
    const keyParts = cleanKey.split('-').filter(Boolean);
    const labelParts = normalized.split('-').filter(Boolean);
    const matched = keyParts.filter(p => labelParts.some(lp => lp.includes(p) || p.includes(lp)));
    if (matched.length >= 2) return value;
  }
  return null;
}

function StatusDot({ status }) {
  const colors = {
    connected: 'bg-green-500',
    busy: 'bg-amber-500 animate-pulse',
    disconnected: 'bg-red-500',
  };
  return <div className={`h-2 w-2 rounded-full ${colors[status] || colors.disconnected}`} />;
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function ConversationPicker({ open, onClose, fetchConversations, selectConversation, activeFolder }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [switching, setSwitching] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSwitching(null);
    setLoading(true);
    fetchConversations(activeFolder).then(res => {
      let items = [];
      if (res?.results) {
        const val = res.results.find(r => r.value?.ok)?.value;
        if (val?.groups) {
          for (const g of val.groups) {
            for (const item of g.items) {
              items.push({ ...item, section: g.label, isCurrent: item.active });
            }
          }
        } else if (val?.conversations) {
          items = val.conversations;
        }
      }
      setConversations(items);
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }).catch(() => setLoading(false));
  }, [open, fetchConversations, activeFolder]);

  if (!open) return null;

  const filtered = search
    ? conversations.filter(c => c.title.toLowerCase().includes(search.toLowerCase()))
    : conversations;

  const sections = [];
  const sectionMap = {};
  for (const c of filtered) {
    const key = c.section || 'Conversations';
    if (!sectionMap[key]) {
      sectionMap[key] = [];
      sections.push(key);
    }
    sectionMap[key].push(c);
  }

  const handleSelect = async (conv) => {
    setSwitching(conv.cascadeId || conv.title);
    try {
      await selectConversation(conv.title, conv.cascadeId);
    } catch { }
    setSwitching(null);
    onClose();
  };

  return (
    <div className='fixed inset-0 z-50 flex items-start justify-center pt-[15vh]' onClick={onClose}>
      <div className='absolute inset-0 bg-black/40 backdrop-blur-[2px]' />
      <div
        className='relative w-full max-w-lg rounded-xl border bg-card shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='px-3 pt-3 pb-2'>
          <div className='flex items-center gap-2 rounded-lg border bg-secondary/50 px-3 focus-within:ring-1 focus-within:ring-ring'>
            <Search className='h-4 w-4 text-muted-foreground shrink-0' />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Select a conversation...'
              className='w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground'
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} className='text-muted-foreground hover:text-foreground'>
                <X className='h-3.5 w-3.5' />
              </button>
            )}
          </div>
        </div>
        <div className='max-h-[50vh] overflow-y-auto px-2 pb-2'>
          {loading ? (
            <div className='flex items-center justify-center py-8'>
              <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
            </div>
          ) : filtered.length === 0 ? (
            <div className='py-8 text-center text-sm text-muted-foreground'>
              {search ? 'No matching conversations' : 'No conversations found'}
            </div>
          ) : (
            sections.map((section) => (
              <div key={section} className='mb-1'>
                <div className='flex items-center gap-1.5 px-2 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60'>
                  <FolderOpen className='h-3 w-3' />
                  {section}
                </div>
                {sectionMap[section].map((conv, i) => (
                  <button
                    key={`${section}-${i}`}
                    onClick={() => handleSelect(conv)}
                    disabled={switching !== null}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${conv.isCurrent
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-accent'
                      } ${switching === (conv.cascadeId || conv.title) ? 'opacity-60' : ''}`}
                  >
                    <div className='flex min-w-0 flex-1 items-center gap-2'>
                      <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${conv.isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className='min-w-0 flex-1'>
                        <div className='truncate font-medium'>{conv.title}</div>
                      </div>
                    </div>
                    <div className='flex items-center gap-2 shrink-0'>
                      {conv.time && (
                        <span className='text-[10px] text-muted-foreground/50'>{formatRelativeTime(conv.time)}</span>
                      )}
                      {switching === (conv.cascadeId || conv.title) && (
                        <Loader2 className='h-3 w-3 animate-spin' />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ workspace, ag, showHostPanel, setShowHostPanel, quota, showTerminal, setShowTerminal, showGit, setShowGit, editingFile, setEditingFile, activeTargetId }) {
  const { status, statusText, currentModel, setCurrentModel, isBusy, isLoading, hasAcceptAll, hasRejectAll, clickAcceptAll, clickRejectAll, clickNewChat, fetchConversations, selectConversation, items, sendMessage, stopAgent, fetchModels, changeModel, captureScreenshot, targets } = ag;
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [optimisticItem, setOptimisticItem] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [models, setModels] = useState([]);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [activeTab, setActiveTab] = useState('explorer');
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const scrollRef = useRef(null);
  const isAtBottomRef = useRef(true);

  const handleFileOpen = (fullPath) => {
    if (!fullPath || !setEditingFile) return;
    setEditingFile(fullPath);
  };

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (showGit) {
      setActiveTab('git');
      if (!showHostPanel) setShowHostPanel(true);
    }
  }, [showGit]);

  ag.openHistory = () => setPickerOpen(true);




  const prevItemCount = useRef(0);
  useEffect(() => {
    if (optimisticItem && items.length > prevItemCount.current) {
      setOptimisticItem(null);
    }
    prevItemCount.current = items.length;
  }, [items, optimisticItem]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [inputText, resizeTextarea]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    setInputText('');
    setOptimisticItem({ type: 'user', text, isOptimistic: true });
    try {
      const res = await sendMessage(text);
      if (!res?.ok && !res?.results?.some(r => r.value?.ok)) {
        setInputText(text);
        setOptimisticItem(null);
      }
    } catch {
      setInputText(text);
      setOptimisticItem(null);
    }
    setSending(false);
    textareaRef.current?.focus();
  };

  const handleStop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await stopAgent();
    } catch { }
    setStopping(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleOpenModels = async () => {
    if (modelsOpen) {
      setModelsOpen(false);
      return;
    }
    setModelsOpen(true);
    if (models.length > 0) return;
    setModelsLoading(true);
    try {
      const res = await fetchModels();
      let val = null;
      if (res?.results) {
        val = res.results.find(r => r.value?.ok)?.value;
      } else if (res?.ok) {
        val = res;
      }
      if (val?.ok) {
        setModels(val.models || []);
        if (val.current) setCurrentModel(val.current);
      }
    } catch { }
    setModelsLoading(false);
  };

  const handleSelectModel = async (modelObj) => {
    setModelsOpen(false);
    setCurrentModel(modelObj.label);
    setModels(prev => prev.map(m => ({ ...m, selected: m.label === modelObj.label })));
    try {
      await changeModel(modelObj.label, modelObj.modelUid);
    } catch { }
  };

  const isConnected = status === 'connected' || status === 'busy';

  const allItems = useMemo(() => {
    const result = [...items];
    if (optimisticItem) result.push(optimisticItem);
    return result;
  }, [items, optimisticItem]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isAtBottomRef.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [allItems]);

  useEffect(() => {
    const onResize = () => {
      const el = scrollRef.current;
      if (!el) return;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const chatContent = (
    <>
      <div className='min-h-0 flex-1 overflow-hidden'>
        {isLoading ? (
          <div className='flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground h-full'>
            <Loader2 className='h-6 w-6 animate-spin' />
          </div>
        ) : allItems.length === 0 ? (
          <div className='flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground h-full'>
            <MessageSquare className='h-10 w-10 stroke-1' />
            <p className='text-sm'>Send a message or sync the IDE conversation</p>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className='h-full overflow-y-auto'
            onScroll={() => {
              const el = scrollRef.current;
              if (!el) return;
              isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            }}
          >
            <div className='flex flex-col'>
              {allItems.map((item, index) => (
                <div key={index} className='mx-auto max-w-3xl w-full px-4'>
                  <ConversationItem item={item} workspaceId={workspace._id} onFileOpen={handleFileOpen} />
                </div>
              ))}
              <div className='h-3' />
            </div>
          </div>
        )}
      </div>

      <div className='shrink-0 px-4 py-3'>
        <div className='mx-auto max-w-3xl mb-1 flex items-center h-7 px-1 text-[11px]'>
          <div className='flex items-center gap-2 flex-1'>
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              title="Toggle Terminal"
              className={`flex items-center gap-1 h-6 px-2 rounded font-medium transition-colors ${showTerminal ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
            >
              <TerminalSquare className="w-3 h-3" />
            </button>
            <button
              onClick={() => {
                if (activeTab === 'git' && showHostPanel) {
                  setShowHostPanel(false);
                } else {
                  setActiveTab('git');
                  setShowHostPanel(true);
                }
              }}
              title="Toggle Git"
              className={`flex items-center gap-1 h-6 px-2 rounded font-medium transition-colors ${activeTab === 'git' && showHostPanel ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
            >
              <GitBranch className="w-3 h-3" />
            </button>
            {isBusy && (
              <div className='flex items-center gap-1.5 text-zinc-400'>
                <Loader2 className='h-3 w-3 animate-spin' />
                <span>{statusText || 'Working...'}</span>
              </div>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {hasRejectAll && (
              <button onClick={clickRejectAll} className='h-5 px-2 rounded text-[10px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors'>
                Reject All
              </button>
            )}
            {hasAcceptAll && (
              <button onClick={clickAcceptAll} className='h-5 px-2 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors'>
                Accept All
              </button>
            )}
            <div className='flex items-center gap-1 text-[10px]'>
              {isConnected ? (
                <><Wifi className='w-3 h-3 text-emerald-400' /><span className='text-emerald-400'>Connected</span></>
              ) : (
                <><WifiOff className='w-3 h-3 text-zinc-500' /><span className='text-zinc-500'>Offline</span></>
              )}
            </div>
          </div>
        </div>
        <div className='mx-auto max-w-3xl overflow-hidden rounded-lg border bg-secondary/50 focus-within:ring-1 focus-within:ring-ring'>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Send a message to the agent...'
            disabled={sending}
            rows={1}
            className='w-full resize-none border-none bg-transparent px-3 pt-2.5 pb-0 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50'
          />
          <div className='flex items-center justify-between px-2 py-1.5'>
            <div className='flex items-center gap-1'>
              <Popover open={modelsOpen} onOpenChange={setModelsOpen}>
                <PopoverTrigger asChild>
                  <button
                    onClick={handleOpenModels}
                    className='flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                  >
                    <ChevronUp className='h-3 w-3' />
                    <span>{currentModel || 'Select model'}</span>
                    {(() => {
                      const q = findModelQuota(currentModel, quota);
                      if (q === null) return null;
                      return <span className={`text-[10px] font-medium ${getQuotaTextColor(q)}`}>{q}%</span>;
                    })()}
                  </button>
                </PopoverTrigger>
                <PopoverContent align='start' className='w-64 p-1' side='top'>
                  {modelsLoading ? (
                    <div className='flex items-center justify-center py-4'>
                      <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
                    </div>
                  ) : models.length === 0 ? (
                    <div className='px-3 py-2 text-xs text-muted-foreground'>No models found</div>
                  ) : (
                    models.map((m, i) => {
                      const modelQuota = findModelQuota(m.label, quota);
                      return (
                        <button
                          key={i}
                          onMouseDown={() => handleSelectModel(m)}
                          className='flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent'
                        >
                          <Check className={`h-3.5 w-3.5 shrink-0 ${m.selected ? 'opacity-100' : 'opacity-0'}`} />
                          <span className='truncate flex-1'>{m.label}</span>
                          {modelQuota !== null && (
                            <span className={`text-[10px] font-medium shrink-0 ${getQuotaTextColor(modelQuota)}`}>{modelQuota}%</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </PopoverContent>
              </Popover>
            </div>
            <Button
              onClick={isBusy ? handleStop : handleSend}
              disabled={isBusy ? stopping : (sending || !inputText.trim())}
              size='icon'
              variant={isBusy ? 'destructive' : 'default'}
              className='h-7 w-7'
            >
              {(sending || stopping) ? (
                <Loader2 className='h-3.5 w-3.5 animate-spin' />
              ) : isBusy ? (
                <Square className='h-3.5 w-3.5' />
              ) : (
                <Send className='h-3.5 w-3.5' />
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );

  const sidebarContent = (
    <div className="flex h-full w-full bg-[#0c0c0c] overflow-hidden">
      <div className="w-12 shrink-0 flex flex-col items-center py-2 gap-2 bg-[#0c0c0c] border-r border-white/5 z-10">
        <button
          onClick={() => setActiveTab('explorer')}
          className={`p-2 rounded-md transition-colors ${activeTab === 'explorer' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          title="Explorer"
        >
          <Folder className="w-[18px] h-[18px]" strokeWidth={2} />
        </button>
        <button
          onClick={() => setActiveTab('git')}
          className={`p-2 rounded-md transition-colors ${activeTab === 'git' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          title="Source Control"
        >
          <GitBranch className="w-[18px] h-[18px]" strokeWidth={2} />
        </button>
      </div>
      <div className="flex-1 min-w-0 bg-[#0c0c0c]">
        {activeTab === 'explorer' ? (
          <WorkspaceHostPanel workspace={workspace} ag={ag} onFileOpen={handleFileOpen} />
        ) : (
          <GitPanel workspaceId={workspace._id} />
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full w-full overflow-hidden bg-background relative flex">
      {isMobile ? (
        showHostPanel ? (
          <div className="flex flex-col h-full w-full min-w-0">
            {sidebarContent}
          </div>
        ) : (
          <div className="flex flex-col h-full w-full min-w-0 bg-[#0a0a0a]">
            {editingFile ? (
              <FileEditor
                fullPath={editingFile}
                ag={ag}
                workspace={workspace}
                onClose={() => setEditingFile(null)}
                onOpenFile={(path) => setEditingFile(path)}
              />
            ) : chatContent}
          </div>
        )
      ) : (
        <PanelGroup direction="horizontal" className="h-full w-full flex">
          {showHostPanel && (
            <>
              <Panel order={1} defaultSize={20} minSize={15} collapsible={true} className="flex min-w-0 border-r border-white/5">
                {sidebarContent}
              </Panel>
              <PanelResizeHandle className="w-1 bg-[#1a1a1a] hover:bg-zinc-600/50 transition-colors active:bg-zinc-600 cursor-col-resize shrink-0 z-10" />
            </>
          )}
          <Panel order={2} defaultSize={showHostPanel ? 80 : 100} minSize={30} className="flex flex-col min-w-0 bg-[#0a0a0a]">
            {editingFile ? (
              <FileEditor
                fullPath={editingFile}
                ag={ag}
                workspace={workspace}
                onClose={() => setEditingFile(null)}
                onOpenFile={(path) => setEditingFile(path)}
              />
            ) : chatContent}
          </Panel>
        </PanelGroup>
      )}
      <ConversationPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        fetchConversations={fetchConversations}
        selectConversation={selectConversation}
        activeFolder={(targets || []).find(t => t.id === activeTargetId)?.folder}
      />

    </div>
  );
}
