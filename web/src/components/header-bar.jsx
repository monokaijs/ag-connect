import { Play, Square, RotateCw, LogOut, Loader2, User, History, Plus, Circle, Wifi, WifiOff, MonitorPlay, MessageSquare, Folder, FolderOpen, Gauge, TerminalSquare, ChevronDown, Download, Trash2, Pencil, PanelLeft, Menu, ZoomIn, ZoomOut, RotateCcw, Keyboard, Maximize } from 'lucide-react';
import { useState, useRef } from 'react';
import { FolderPickerDialog } from './folder-picker';
import { useConfirm } from './confirm-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getApiBase } from '../config';
import { getAuthHeaders } from '../hooks/use-auth';
const statusLabel = {
  creating: 'Creating...',
  initializing: 'Initializing...',
  needsLogin: 'Login required',
  running: 'Running',
  stopped: 'Stopped',
  error: 'Error',
};

const statusDot = {
  creating: 'bg-yellow-400',
  initializing: 'bg-blue-400',
  needsLogin: 'bg-orange-400',
  running: 'bg-emerald-400',
  stopped: 'bg-zinc-600',
  error: 'bg-red-400',
};

function getQuotaColor(pct) {
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

function getOverallQuota(quota) {
  if (!quota?.quotas) return null;
  const values = Object.values(quota.quotas);
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function QuotaMiniBar({ pct }) {
  return (
    <div className="w-8 h-1.5 rounded-full bg-white/10 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${getQuotaColor(pct)}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function formatResetTime(isoString) {
  if (!isoString) return '';
  const reset = new Date(isoString);
  const now = new Date();
  const diff = reset - now;
  if (diff <= 0) return 'now';
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m`;
}

function prettifyModelName(name) {
  return name
    .replace(/^models\//, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export default function HeaderBar({ workspace, ag, onStart, onStop, onRestart, onDelete, onUpdate, onClearAuth, viewMode, setViewMode, showHostPanel, setShowHostPanel, showTerminal, setShowTerminal, quota, onOpenMobileNav, vncRef }) {
  if (!workspace) return null;

  const isRunning = workspace.status === 'running';
  const isStopped = workspace.status === 'stopped';
  const isLoading = workspace.status === 'creating' || workspace.status === 'initializing';
  const isConnected = ag?.status === 'connected';
  const [showPicker, setShowPicker] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const submittedRef = useRef(false);
  const overallQuota = getOverallQuota(quota);
  const { confirm, dialog } = useConfirm();

  const handleClone = async () => {
    if (!cloneUrl.trim() || cloning) return;
    setCloning(true);
    setCloneError('');
    try {
      const res = await fetch(`${getApiBase()}/api/workspaces/${workspace._id}/git/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ url: cloneUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCloneError(data.error || 'Clone failed');
      } else {
        setShowClone(false);
        setCloneUrl('');
      }
    } catch (e) {
      setCloneError(e.message || 'Clone failed');
    }
    setCloning(false);
  };

  const submitRename = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const v = editName.trim();
    if (v && v !== workspace.name) onUpdate({ name: v });
    setEditing(false);
  };

  return (
    <div className="shrink-0">
      {dialog}
      <div className="flex items-center h-9 px-4 bg-zinc-950 border-b border-white/5">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {onOpenMobileNav && (
            <button
              onClick={onOpenMobileNav}
              className="md:hidden flex items-center justify-center w-6 h-6 text-zinc-400 hover:text-white transition-colors shrink-0"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}
          <div className={`w-2 h-2 rounded-full ${statusDot[workspace.status] || 'bg-zinc-600'} shrink-0`} title={statusLabel[workspace.status]} />
          {editing ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
                if (e.key === 'Escape') { submittedRef.current = true; setEditing(false); }
              }}
              className="text-sm font-medium text-white bg-transparent border-b border-indigo-500/50 outline-none px-0 py-0 w-40"
            />
          ) : (
            <span className="text-sm font-medium text-white truncate">{workspace.name}</span>
          )}
          <button
            onClick={() => { setEditName(workspace.name); submittedRef.current = false; setEditing(!editing); }}
            title="Rename"
            className="text-zinc-500 hover:text-white transition-colors shrink-0"
          >
            <Pencil className="w-3 h-3" />
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Popover>
            <PopoverTrigger asChild>
              <button className={`flex items-center gap-1.5 h-6 px-2.5 rounded text-[11px] font-medium transition-colors ${isRunning ? 'bg-emerald-500/10 text-emerald-400' : isStopped || workspace.status === 'error' ? 'bg-zinc-800 text-zinc-400' : 'bg-blue-500/10 text-blue-400'}`}>
                {isLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : isRunning ? (
                  <Play className="w-3 h-3 fill-current" />
                ) : (
                  <Square className="w-3 h-3" />
                )}
                <span className="hidden md:inline">{statusLabel[workspace.status]}</span>
                <ChevronDown className="w-2.5 h-2.5 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl">
              {(isStopped || workspace.status === 'error') && (
                <button
                  onClick={onStart}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-emerald-400 hover:bg-emerald-400/5 rounded-md transition-colors text-left"
                >
                  <Play className="w-3.5 h-3.5" />
                  Start
                </button>
              )}
              {isRunning && (
                <button
                  onClick={() => confirm({
                    title: 'Stop Workspace',
                    description: `Stop "${workspace.name}"? The container will be stopped but not removed.`,
                    confirmLabel: 'Stop',
                    variant: 'warning',
                  }).then(() => onStop())}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-amber-400 hover:bg-amber-400/5 rounded-md transition-colors text-left"
                >
                  <Square className="w-3.5 h-3.5" />
                  Stop
                </button>
              )}
              {(isRunning || isStopped) && (
                <button
                  onClick={() => confirm({
                    title: 'Restart Workspace',
                    description: `Restart "${workspace.name}"? This may take a moment.`,
                    confirmLabel: 'Restart',
                    variant: 'warning',
                  }).then(() => onRestart())}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-blue-400 hover:bg-blue-400/5 rounded-md transition-colors text-left"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  Restart
                </button>
              )}
              <div className="h-px bg-white/5 my-1" />
              <button
                onClick={() => confirm({
                  title: 'Delete Workspace',
                  description: `Permanently delete "${workspace.name}"? This cannot be undone.`,
                  confirmLabel: 'Delete',
                  variant: 'danger',
                }).then(() => onDelete())}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-red-400 hover:bg-red-400/5 rounded-md transition-colors text-left"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </PopoverContent>
          </Popover>
          {workspace.auth?.email && (
            <Popover>
              <PopoverTrigger asChild>
                <button title={workspace.auth.email} className="flex items-center gap-2 h-7 px-2 rounded-md hover:bg-white/5 transition-colors">
                  <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-white/10">
                    {workspace.auth.avatar ? (
                      <img src={workspace.auth.avatar} alt="User avatar" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-[10px] font-medium text-zinc-300">
                        {workspace.auth.email.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-0 mt-1 bg-[#1e1e1e] border-white/10" sideOffset={4}>
                <div className="px-3 py-2.5 border-b border-white/5 flex items-center gap-2.5 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/10 shrink-0">
                    {workspace.auth.avatar ? (
                      <img src={workspace.auth.avatar} alt="User avatar" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-sm font-medium text-zinc-300">
                        {workspace.auth.email.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-medium text-white truncate">{workspace.auth.name || 'Developer'}</span>
                    <span className="text-[10px] text-zinc-500 truncate">{workspace.auth.email}</span>
                    {quota?.tier && (
                      <span className="text-[10px] font-medium text-violet-400 capitalize mt-0.5">{quota.tier} Plan</span>
                    )}
                  </div>
                </div>

                {quota?.quotas && Object.keys(quota.quotas).length > 0 && (
                  <div className="px-3 py-2 border-b border-white/5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Gauge className="w-3 h-3 text-zinc-400" />
                      <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Quota</span>
                    </div>
                    <div className="space-y-2">
                      {Object.entries(quota.quotas)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([model, pct]) => (
                          <div key={model}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] text-zinc-400 truncate">{prettifyModelName(model)}</span>
                              <span className={`text-[10px] font-medium shrink-0 ml-2 ${getQuotaTextColor(pct)}`}>
                                {pct}%{quota.resets?.[model] ? ` · ${formatResetTime(quota.resets[model])}` : ''}
                              </span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${getQuotaColor(pct)}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <div className="p-1">
                  <button
                    onClick={onClearAuth}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-white/5 rounded-md transition-colors text-left"
                  >
                    <LogOut className="w-3 h-3" />
                    Log out workspace
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      <div className="flex items-center h-8 px-3 bg-zinc-950 border-b border-white/5 overflow-x-auto no-scrollbar whitespace-nowrap">
        <div className="flex items-center gap-0.5 flex-1 min-w-max">
          {isLoading && (
            <div className="flex items-center gap-1.5 h-6 px-2 text-[11px] text-blue-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{workspace.stage || 'Setting up...'}</span>
            </div>
          )}
          {isRunning && ag && (
            <>
              {viewMode !== 'vnc' && (
                <>
                  <button
                    onClick={() => setShowHostPanel(!showHostPanel)}
                    title="Toggle Panel"
                    className={`flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium transition-colors ${showHostPanel ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                  >
                    <PanelLeft className="w-3 h-3" />
                  </button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        title="New Workspace"
                        className="flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        <Folder className="w-3 h-3" />
                        <span className="hidden md:inline">Workspace</span>
                        <ChevronDown className="w-2.5 h-2.5 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-48 p-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl">
                      <button
                        onClick={() => setShowPicker(true)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-white hover:bg-white/5 rounded-md transition-colors text-left"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        Open Folder
                      </button>
                      <button
                        onClick={() => setShowClone(true)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-white hover:bg-white/5 rounded-md transition-colors text-left"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Clone Git Repo
                      </button>
                    </PopoverContent>
                  </Popover>
                  <div className="w-px h-4 bg-white/10 mx-1" />
                  <button
                    onClick={() => ag.clickNewChat().catch(() => { })}
                    title="New Chat"
                    className="flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span className="hidden md:inline">New Chat</span>
                  </button>
                  <button
                    onClick={() => ag.openHistory?.()}
                    title="History"
                    className="flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <History className="w-3 h-3" />
                    <span className="hidden md:inline">History</span>
                  </button>

                </>
              )}
              {viewMode === 'vnc' && (
                <>
                  {['480p', '720p', '1080p'].map(q => (
                    <button
                      key={q}
                      onClick={() => vncRef?.current?.changeQuality(q)}
                      className={`h-6 px-2 rounded text-[11px] font-bold transition-all ${vncRef?.current?.quality === q ? 'bg-white/15 text-white ring-1 ring-white/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                    >
                      {q}
                    </button>
                  ))}
                  <div className="w-px h-4 bg-white/10 mx-1" />
                  <button
                    onClick={() => vncRef?.current?.zoomOut()}
                    title="Zoom out"
                    className="flex items-center h-6 px-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] text-zinc-500 min-w-[28px] text-center font-mono">{Math.round((vncRef?.current?.zoom || 1) * 100)}%</span>
                  <button
                    onClick={() => vncRef?.current?.zoomIn()}
                    title="Zoom in"
                    className="flex items-center h-6 px-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  {(vncRef?.current?.zoom || 1) > 1 && (
                    <button
                      onClick={() => vncRef?.current?.resetZoom()}
                      title="Reset zoom"
                      className="flex items-center h-6 px-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                  <div className="w-px h-4 bg-white/10 mx-1" />
                  <button
                    onClick={() => vncRef?.current?.openKeyboard()}
                    title="Open keyboard"
                    className="flex items-center gap-1 h-6 px-1.5 rounded text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <Keyboard className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => vncRef?.current?.toggleFullscreen()}
                    title="Fullscreen"
                    className="flex items-center gap-1 h-6 px-1.5 rounded text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <Maximize className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </>
          )}
        </div>
        {isRunning && ag && (
          <button
            onClick={() => setViewMode(viewMode === 'vnc' ? 'chat' : 'vnc')}
            title={viewMode === 'vnc' ? 'Switch to Chat' : 'Remote Control'}
            className={`flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-medium transition-colors shrink-0 ${viewMode === 'vnc' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
          >
            {viewMode === 'vnc' ? <MessageSquare className="w-3 h-3" /> : <MonitorPlay className="w-3 h-3" />}
            <span className="hidden md:inline">{viewMode === 'vnc' ? 'Chat' : 'Remote Control'}</span>
          </button>
        )}
      </div>
      <FolderPickerDialog
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={(path) => {
          setShowPicker(false);
          if (onUpdate) onUpdate({ mountedPath: path });
        }}
      />
      {showClone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setShowClone(false); setCloneError(''); }}>
          <div className="bg-zinc-900 border border-white/10 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-medium text-white mb-1">Clone Git Repository</h3>
            <p className="text-[11px] text-zinc-500 mb-4">Enter the repository URL. GitHub HTTPS URLs will be auto-converted to SSH.</p>
            <input
              autoFocus
              value={cloneUrl}
              onChange={(e) => setCloneUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleClone(); }}
              placeholder="https://github.com/user/repo or git@github.com:user/repo.git"
              className="w-full h-9 px-3 text-xs bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 font-mono mb-3"
            />
            {cloneError && <p className="text-[11px] text-red-400 mb-3">{cloneError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowClone(false); setCloneError(''); }}
                className="h-8 px-3 text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClone}
                disabled={!cloneUrl.trim() || cloning}
                className="h-8 px-4 text-[11px] font-medium bg-indigo-500 text-white hover:bg-indigo-400 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                {cloning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                Clone
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
