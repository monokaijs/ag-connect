import { Plus, X, Loader2, LogIn, Circle, AlertCircle, Square } from 'lucide-react';

const statusColors = {
  creating: 'text-yellow-400',
  initializing: 'text-blue-400',
  needsLogin: 'text-orange-400',
  running: 'text-emerald-400',
  stopped: 'text-zinc-500',
  error: 'text-red-400',
};

const statusLabels = {
  creating: 'Creating',
  initializing: 'Setting up',
  needsLogin: 'Login needed',
  running: 'Running',
  stopped: 'Stopped',
  error: 'Error',
};

function TabIcon({ status }) {
  if (status === 'creating' || status === 'initializing') {
    return <Loader2 className={`w-3 h-3 animate-spin ${statusColors[status]}`} />;
  }
  if (status === 'needsLogin') {
    return <LogIn className={`w-3 h-3 ${statusColors[status]}`} />;
  }
  if (status === 'error') {
    return <AlertCircle className={`w-3 h-3 ${statusColors[status]}`} />;
  }
  if (status === 'stopped') {
    return <Square className={`w-3 h-3 ${statusColors[status]}`} />;
  }
  return <Circle className={`w-3 h-3 fill-emerald-400 ${statusColors[status]}`} />;
}

export default function TabBar({ workspaces, activeId, onSelect, onCreate, onClose }) {
  return (
    <div className="flex items-center h-9 bg-zinc-950 border-b border-white/5 select-none">
      <div className="flex items-center overflow-x-auto flex-1 min-w-0">
        {workspaces.map(ws => {
          const isActive = ws._id === activeId;
          const label = ws.auth?.email
            ? `${ws.name} • ${ws.auth.email}`
            : ws.name;

          return (
            <div
              key={ws._id}
              onClick={() => onSelect(ws._id)}
              className={`
                group flex items-center gap-1.5 px-3 h-9 text-xs cursor-pointer
                border-r border-white/5 min-w-[120px] max-w-[220px] shrink-0
                transition-colors duration-100
                ${isActive
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-950 text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-300'}
              `}
            >
              <TabIcon status={ws.status} />
              <span className="truncate flex-1">{label}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onClose(ws._id); }}
                className="opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded p-0.5 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={onCreate}
        className="flex items-center justify-center w-9 h-9 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors shrink-0"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}
