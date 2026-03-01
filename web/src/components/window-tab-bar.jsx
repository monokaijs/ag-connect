import { useState, useEffect } from 'react';
import { X, Plus, Play, Square, Loader2, ChevronDown, RotateCw, Trash2, Menu, User } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useConfirm } from './confirm-dialog';
import { getApiBase } from '@/config';
import { getAuthHeaders } from '@/hooks/use-auth';

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

export default function WindowTabBar({
  targets, activeTargetId, onSelect, onClose,
  workspace, onStart, onStop, onRestart, onDelete,
  onOpenMobileNav, onNewWindow,
}) {
  const { confirm, dialog } = useConfirm();
  const [accounts, setAccounts] = useState([]);
  const [switching, setSwitching] = useState(false);

  if (!workspace) return null;

  const isRunning = workspace.status === 'running';
  const isStopped = workspace.status === 'stopped';
  const isLoading = workspace.status === 'creating' || workspace.status === 'initializing';
  const filteredTargets = targets || [];
  const avatar = workspace.auth?.avatar;
  const email = workspace.auth?.email;
  const name = workspace.auth?.name;

  const loadAccounts = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/accounts`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setAccounts(data);
    } catch { }
  };

  const switchAccount = async (accountId) => {
    setSwitching(true);
    try {
      await fetch(`${getApiBase()}/api/workspaces/${workspace._id}/set-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ accountId }),
      });
    } catch { }
    setSwitching(false);
  };

  return (
    <>
      {dialog}
      <div className="shrink-0 h-9 bg-zinc-950 border-b border-white/5 flex items-center select-none z-10">
        {onOpenMobileNav && (
          <button
            onClick={onOpenMobileNav}
            className="md:hidden flex items-center justify-center w-9 h-9 text-zinc-400 hover:text-white transition-colors shrink-0"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        <div className="flex-1 flex items-center overflow-x-auto no-scrollbar px-1 gap-0.5 min-w-0">
          {filteredTargets.length > 0 ? filteredTargets.map(t => (
            <div
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`group flex items-center h-7 px-2.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer shrink-0 ${activeTargetId === t.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'}`}
              title={t.url}
            >
              <div className={`w-1.5 h-1.5 mr-1.5 rounded-full shrink-0 ${activeTargetId === t.id ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]' : 'bg-zinc-700'}`} />
              <span className="truncate max-w-[150px] mr-1">{t.title || 'Window'}</span>
              {filteredTargets.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.id);
                  }}
                  className={`flex items-center justify-center w-4 h-4 rounded transition-colors ${activeTargetId === t.id ? 'hover:bg-white/20 text-white/40 hover:text-white' : 'opacity-0 group-hover:opacity-100 hover:bg-white/10 text-zinc-600 hover:text-white'}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          )) : (
            <div className="flex items-center gap-2 px-2 min-w-0">
              <div className={`w-2 h-2 rounded-full ${statusDot[workspace.status] || 'bg-zinc-600'} shrink-0`} />
              <span className="text-[11px] font-medium text-zinc-300 truncate">{workspace.name}</span>
            </div>
          )}
        </div>

        {workspace.type !== 'cli' && isRunning && (
          <button
            onClick={onNewWindow}
            title="New window"
            className="flex items-center justify-center w-7 h-7 rounded text-zinc-500 hover:text-white hover:bg-white/5 transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}

        <div className="flex items-center gap-1 px-2 shrink-0">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors">
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
                    description: `Stop "${workspace.name}"?`,
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
                    description: `Restart "${workspace.name}"?`,
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
                  description: `Permanently delete "${workspace.name}"?`,
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

          <Popover onOpenChange={(open) => { if (open) loadAccounts(); }}>
            <PopoverTrigger asChild>
              <button
                title={email || 'Account'}
                className="flex items-center justify-center w-6 h-6 rounded-full hover:ring-2 hover:ring-white/20 transition-all shrink-0 overflow-hidden"
              >
                {avatar ? (
                  <img src={avatar} alt="" className="w-6 h-6 rounded-full" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center">
                    <User className="w-3 h-3 text-zinc-400" />
                  </div>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl">
              {email && (
                <div className="px-2.5 py-2 border-b border-white/5 mb-1">
                  <div className="text-[11px] font-medium text-white truncate">{name || email}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{email}</div>
                </div>
              )}
              {switching ? (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  {accounts.map(a => (
                    <button
                      key={a._id}
                      onClick={() => {
                        if (a._id === workspace.accountId) return;
                        switchAccount(a._id);
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left rounded-md transition-colors ${a._id === workspace.accountId ? 'bg-white/5 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                    >
                      {a.avatar ? (
                        <img src={a.avatar} className="w-5 h-5 rounded-full shrink-0" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
                          <User className="w-2.5 h-2.5 text-zinc-500" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium truncate">{a.name || a.email}</div>
                        <div className="text-[10px] text-zinc-500 truncate">{a.email}</div>
                      </div>
                      {a._id === workspace.accountId && (
                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </>
  );
}
