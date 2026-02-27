import { Plus, Loader2, Settings } from 'lucide-react';
import { WORKSPACE_ICONS, ICON_COLORS } from './create-workspace-dialog';

const statusDot = {
  creating: 'bg-yellow-400',
  initializing: 'bg-blue-400',
  needsLogin: 'bg-orange-400',
  running: 'bg-emerald-400',
  stopped: 'bg-zinc-500',
  error: 'bg-red-400',
};

function getWorkspaceIcon(ws) {
  if (ws.icon >= 0 && ws.icon < WORKSPACE_ICONS.length) {
    const colorIdx = (ws.color ?? 0) % ICON_COLORS.length;
    return { path: WORKSPACE_ICONS[ws.icon], color: ICON_COLORS[colorIdx] };
  }
  let hash = 0;
  for (let i = 0; i < ws._id.length; i++) {
    hash = ((hash << 5) - hash) + ws._id.charCodeAt(i);
    hash |= 0;
  }
  const iconIdx = Math.abs(hash) % WORKSPACE_ICONS.length;
  const colorIdx = Math.abs(hash >> 4) % ICON_COLORS.length;
  return { path: WORKSPACE_ICONS[iconIdx], color: ICON_COLORS[colorIdx] };
}

export default function ActivityBar({ workspaces, activeId, onSelect, onCreate, showSettings, onToggleSettings }) {
  return (
    <div className="flex flex-col items-center w-12 bg-zinc-950 border-r border-white/5 select-none h-full">
      <button
        onClick={onCreate}
        title="New workspace"
        className="flex items-center justify-center w-12 h-10 text-zinc-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
      >
        <Plus className="w-4 h-4" />
      </button>
      <div className="w-6 h-px bg-white/10 shrink-0" />
      <div className="flex-1 flex flex-col items-center overflow-y-auto py-2 gap-1">
        {workspaces.map(ws => {
          const isActive = ws._id === activeId && !showSettings;
          const { path, color } = getWorkspaceIcon(ws);
          const isLoading = ws.status === 'creating' || ws.status === 'initializing';

          return (
            <div key={ws._id} className="relative">
              <button
                onClick={() => onSelect(ws._id)}
                title={`${ws.name} — ${ws.status}`}
                className={`
                  flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150
                  ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}
                `}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    className="w-5 h-5"
                    fill="none"
                    stroke={isActive ? color : '#71717a'}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={path} />
                  </svg>
                )}
              </button>
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[3px] w-1 h-5 rounded-r bg-white" />
              )}
              <div
                className={`absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full border border-zinc-950 ${statusDot[ws.status] || 'bg-zinc-600'}`}
                title={ws.status}
              />
            </div>
          );
        })}
      </div>
      <div className="w-6 h-px bg-white/10 shrink-0" />
      <button
        onClick={onToggleSettings}
        title="Settings"
        className={`flex items-center justify-center w-12 h-10 transition-colors shrink-0 ${showSettings ? 'text-white bg-white/10' : 'text-zinc-400 hover:text-white hover:bg-white/10'}`}
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  );
}

