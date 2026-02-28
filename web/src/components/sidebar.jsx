import { Plus, X, Loader2, LogIn, Circle, AlertCircle, Square } from 'lucide-react';

const statusColors = {
  creating: 'text-yellow-400',
  initializing: 'text-blue-400',
  needsLogin: 'text-orange-400',
  running: 'text-emerald-400',
  stopped: 'text-zinc-500',
  error: 'text-red-400',
};

function StatusDot({ status }) {
  if (status === 'creating' || status === 'initializing') {
    return <Loader2 className={`w-3.5 h-3.5 animate-spin ${statusColors[status]}`} />;
  }
  if (status === 'needsLogin') {
    return <LogIn className={`w-3.5 h-3.5 ${statusColors[status]}`} />;
  }
  if (status === 'error') {
    return <AlertCircle className={`w-3.5 h-3.5 ${statusColors[status]}`} />;
  }
  if (status === 'stopped') {
    return <Square className={`w-3.5 h-3.5 ${statusColors[status]}`} />;
  }
  return <Circle className={`w-3.5 h-3.5 fill-emerald-400 ${statusColors[status]}`} />;
}

export default function Sidebar({ workspaces, activeId, onSelect, onCreate, onClose }) {
  return (
    <div className="flex flex-col w-52 bg-zinc-950 border-r border-white/5 select-none h-full">
      <div className="flex items-center justify-between px-3 h-10 border-b border-white/5 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Workspaces</span>
        <button
          onClick={onCreate}
          className="flex items-center justify-center w-6 h-6 rounded text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {workspaces.map(ws => {
          const isActive = ws._id === activeId;
          return (
            <div
              key={ws._id}
              onClick={() => onSelect(ws._id)}
              className={`
                group flex items-center gap-2 px-3 py-2 mx-1 rounded-md cursor-pointer
                transition-colors duration-100
                ${isActive
                  ? 'bg-white/10 text-white'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-300'}
              `}
            >
              <StatusDot status={ws.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className="text-xs font-medium truncate">{ws.name}</div>
                  {ws.type === 'cli' && (
                    <span className="shrink-0 text-[9px] font-medium px-1 py-0.5 rounded bg-teal-500/10 text-teal-400 leading-none">CLI</span>
                  )}
                </div>
                {ws.auth?.email && (
                  <div className="text-[10px] text-zinc-500 truncate">{ws.auth.email}</div>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onClose(ws._id); }}
                className="opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded p-0.5 transition-opacity shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
