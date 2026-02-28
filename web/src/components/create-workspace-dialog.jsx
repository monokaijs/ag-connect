import { useState } from 'react';
import { X, Container, Terminal } from 'lucide-react';

const WORKSPACE_ICONS = [
  'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z',
  'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  'M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z',
  'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  'M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1013 16H2m14.73-8.27A2.5 2.5 0 1119.5 12H2',
  'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  'M12 3v19m0 0l7-7m-7 7l-7-7',
  'M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z',
  'M12 8V4H8m8 16V4m0 0h4m-4 0H8m0 0v16m0 0H4m4 0h8m0 0h4',
  'M16 18l6-6-6-6M8 6l-6 6 6 6',
  'M4 17l6-6-6-6m8 14h8',
  'M22 12h-4l-3 9L9 3l-3 9H2',
  'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09zM12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z',
  'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z',
  'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z',
  'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z',
  'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z',
  'M6 12h4m4 0h4M6 12a6 6 0 1012 0 6 6 0 00-12 0zM15 7l-6 10',
];

const ICON_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6',
];

const WORKSPACE_TYPES = [
  {
    value: 'docker',
    label: 'Docker',
    description: 'Run AG inside a Docker container',
    Icon: Container,
  },
  {
    value: 'cli',
    label: 'Local CLI',
    description: 'Run AG locally via npx',
    Icon: Terminal,
  },
];

export default function CreateWorkspaceDialog({ open, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState(0);
  const [selectedColor, setSelectedColor] = useState(0);
  const [wsType, setWsType] = useState('docker');

  if (!open) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const wsName = name.trim() || 'Untitled Workspace';
    onCreate({ name: wsName, icon: selectedIcon, color: selectedColor, type: wsType });
    setName('');
    setSelectedIcon(0);
    setSelectedColor(0);
    setWsType('docker');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-white/10 rounded-xl shadow-2xl w-96 max-w-[90vw]">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-white">New Workspace</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-5">
          <div className="mb-4">
            <label className="block text-[11px] font-medium text-zinc-400 mb-2">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {WORKSPACE_TYPES.map(({ value, label, description, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setWsType(value)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${wsType === value
                    ? 'bg-indigo-500/10 border-indigo-500/50 ring-1 ring-indigo-500/20'
                    : 'border-white/5 hover:bg-white/5 hover:border-white/10'
                    }`}
                >
                  <Icon className={`w-5 h-5 ${wsType === value ? 'text-indigo-400' : 'text-zinc-500'}`} />
                  <span className={`text-xs font-medium ${wsType === value ? 'text-white' : 'text-zinc-400'}`}>{label}</span>
                  <span className="text-[10px] text-zinc-500 text-center leading-tight">{description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workspace"
              autoFocus
              className="w-full h-8 px-3 text-xs bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-colors"
            />
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-medium text-zinc-400 mb-2">Icon</label>
            <div className="grid grid-cols-5 gap-1.5">
              {WORKSPACE_ICONS.map((path, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedIcon(i)}
                  className={`flex items-center justify-center w-full aspect-square rounded-lg border transition-all ${selectedIcon === i ? 'bg-white/10 border-indigo-500/50 ring-1 ring-indigo-500/20' : 'border-white/5 hover:bg-white/5 hover:border-white/10'}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-5 h-5"
                    fill="none"
                    stroke={selectedIcon === i ? ICON_COLORS[selectedColor] : '#71717a'}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={path} />
                  </svg>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-5">
            <label className="block text-[11px] font-medium text-zinc-400 mb-2">Color</label>
            <div className="flex flex-wrap gap-1.5">
              {ICON_COLORS.map((color, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedColor(i)}
                  className={`w-6 h-6 rounded-full transition-all ${selectedColor === i ? 'ring-2 ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'}`}
                  style={{ backgroundColor: color, ringColor: selectedColor === i ? color : undefined }}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-4 text-[11px] font-medium rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-8 px-4 text-[11px] font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 transition-colors"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { WORKSPACE_ICONS, ICON_COLORS };

