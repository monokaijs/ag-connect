import { Play, Square, RotateCw, LogOut, Loader2 } from 'lucide-react';

export default function Toolbar({ workspace, onStart, onStop, onRestart, onClearAuth }) {
  if (!workspace) return null;

  const isRunning = workspace.status === 'running';
  const isStopped = workspace.status === 'stopped';
  const isLoading = workspace.status === 'creating' || workspace.status === 'initializing';

  return (
    <div className="flex items-center h-10 px-4 bg-zinc-950 border-b border-white/5 select-none shrink-0">
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <span className="text-sm font-medium text-white truncate">{workspace.name}</span>
        {workspace.stage && (
          <span className="text-[11px] text-zinc-500 truncate">{workspace.stage}</span>
        )}
      </div>

      {workspace.auth?.email && (
        <div className="flex items-center gap-2 mr-4">
          <div className="text-[11px] text-zinc-400 truncate max-w-[180px]">
            {workspace.auth.name || workspace.auth.email}
          </div>
          <button
            onClick={onClearAuth}
            title="Clear auth"
            className="flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-orange-400 hover:bg-white/5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-1">
        {(isStopped || workspace.status === 'error') && (
          <button
            onClick={onStart}
            title="Start"
            className="flex items-center justify-center w-7 h-7 rounded text-zinc-400 hover:text-emerald-400 hover:bg-white/5 transition-colors"
          >
            <Play className="w-4 h-4" />
          </button>
        )}
        {isRunning && (
          <button
            onClick={onStop}
            title="Stop"
            className="flex items-center justify-center w-7 h-7 rounded text-zinc-400 hover:text-red-400 hover:bg-white/5 transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        )}
        {(isRunning || isStopped) && (
          <button
            onClick={onRestart}
            title="Restart"
            className="flex items-center justify-center w-7 h-7 rounded text-zinc-400 hover:text-blue-400 hover:bg-white/5 transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        )}
        {isLoading && (
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
        )}
      </div>
    </div>
  );
}
