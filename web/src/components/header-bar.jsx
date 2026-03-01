import { Play, Square, RotateCw, LogOut, Loader2, User, History, Plus, Circle, Wifi, WifiOff, MonitorPlay, MessageSquare, Folder, FolderOpen, Gauge, TerminalSquare, ChevronDown, Download, Trash2, Pencil, PanelLeft, Menu, ZoomIn, ZoomOut, RotateCcw, Keyboard, Maximize, Check, AlertCircle } from 'lucide-react';
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

export default function HeaderBar({ workspace, ag, onStart, onStop, onRestart, onDelete, onUpdate, onClearAuth, viewMode, setViewMode, showHostPanel, setShowHostPanel, showTerminal, setShowTerminal, quota, onOpenMobileNav, vncRef, vncState }) {
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
  const [cloneSuccess, setCloneSuccess] = useState('');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const submittedRef = useRef(false);
  const overallQuota = getOverallQuota(quota);
  const { confirm, dialog } = useConfirm();

  const [showNewWindowPicker, setShowNewWindowPicker] = useState(false);

  const handleClone = async () => {
    if (!cloneUrl.trim() || cloning) return;
    setCloning(true);
    setCloneError('');
    setCloneSuccess('');
    try {
      const res = await fetch(`${getApiBase()}/api/workspaces/${workspace._id}/git/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ url: cloneUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setCloneError(data.error || 'Clone failed');
      } else {
        setCloneSuccess(data.repoName || 'Repository');
        setTimeout(() => {
          setShowClone(false);
          setCloneUrl('');
          setCloneSuccess('');
          if (onRestart) onRestart();
        }, 2000);
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
                    <PopoverContent align="start" className="w-52 p-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl">
                      <button
                        onClick={() => setShowPicker(true)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-white hover:bg-white/5 rounded-md transition-colors text-left"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        Open Folder
                      </button>
                      <button
                        onClick={() => setShowNewWindowPicker(true)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-white hover:bg-white/5 rounded-md transition-colors text-left"
                      >
                        <MonitorPlay className="w-3.5 h-3.5" />
                        Open in New Window
                      </button>
                      <div className="h-px bg-white/5 my-1" />
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
                      className={`h-6 px-2 rounded text-[11px] font-bold transition-all ${vncState?.quality === q ? 'bg-white/15 text-white ring-1 ring-white/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
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
                  <span className="text-[10px] text-zinc-500 min-w-[28px] text-center font-mono">{Math.round((vncState?.zoom || 1) * 100)}%</span>
                  <button
                    onClick={() => vncRef?.current?.zoomIn()}
                    title="Zoom in"
                    className="flex items-center h-6 px-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  {(vncState?.zoom || 1) > 1 && (
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
        workspaceId={workspace._id}
        onSelect={(folderPath) => {
          setShowPicker(false);
          if (ag?.openFolder) ag.openFolder(folderPath);
          else if (onUpdate) onUpdate({ mountedPath: folderPath });
        }}
      />
      <FolderPickerDialog
        open={showNewWindowPicker}
        onClose={() => setShowNewWindowPicker(false)}
        workspaceId={workspace._id}
        onSelect={(folderPath) => {
          setShowNewWindowPicker(false);
          if (ag?.openFolderNewWindow) ag.openFolderNewWindow(folderPath);
        }}
      />
      {showClone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { if (!cloning) { setShowClone(false); setCloneError(''); setCloneSuccess(''); } }}>
          <div className="bg-zinc-900 border border-white/10 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            {cloneSuccess ? (
              <div className="flex flex-col items-center py-4">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                  <Check className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="text-sm font-medium text-white mb-1">Cloned successfully</p>
                <p className="text-[11px] text-zinc-400 font-mono">{cloneSuccess}</p>
              </div>
            ) : cloning ? (
              <div className="flex flex-col items-center py-6">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
                <p className="text-sm font-medium text-white mb-1">Cloning repository...</p>
                <p className="text-[11px] text-zinc-500">This may take a moment</p>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-medium text-white mb-1">Clone Git Repository</h3>
                <p className="text-[11px] text-zinc-500 mb-4">Enter the repository URL (HTTPS or SSH).</p>
                <input
                  autoFocus
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleClone(); }}
                  placeholder="https://github.com/user/repo"
                  className="w-full h-9 px-3 text-xs bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 font-mono mb-3"
                />
                {cloneError && (
                  <div className="mb-3 p-2.5 rounded-lg bg-red-500/5 border border-red-500/10">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                      <pre className="text-[11px] text-red-400 whitespace-pre-wrap break-all font-mono leading-relaxed">{cloneError}</pre>
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setShowClone(false); setCloneError(''); }}
                    className="h-8 px-3 text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleClone}
                    disabled={!cloneUrl.trim()}
                    className="h-8 px-4 text-[11px] font-medium bg-indigo-500 text-white hover:bg-indigo-400 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1.5"
                  >
                    <Download className="w-3 h-3" />
                    Clone
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
