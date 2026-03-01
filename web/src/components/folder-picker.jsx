import { useState, useEffect } from 'react';
import { Loader2, Folder, X, ChevronRight, Check } from 'lucide-react';
import { getApiBase } from '../config';
import { getAuthHeaders } from '../hooks/use-auth';

export function FolderPickerDialog({ open, onClose, onSelect, workspaceId }) {
  const [currentPath, setCurrentPath] = useState('');
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hostMountPath, setHostMountPath] = useState('');

  useEffect(() => {
    if (open) {
      loadFolders('');
    }
  }, [open]);

  const loadFolders = async (targetPath) => {
    setLoading(true);
    setError(null);
    try {
      const base = workspaceId
        ? `${getApiBase()}/api/workspaces/${workspaceId}/ls`
        : `${getApiBase()}/api/system/ls`;
      const url = targetPath
        ? `${base}?path=${encodeURIComponent(targetPath)}`
        : base;
      const res = await fetch(url, { headers: getAuthHeaders() });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setCurrentPath(data.path);
        setFolders(data.folders || []);
        if (data.hostMountPath) setHostMountPath(data.hostMountPath);
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#181818] border border-white/10 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">

        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#1e1e1e]">
          <h2 className="text-sm font-medium text-white flex items-center gap-2">
            <Folder className="w-4 h-4 text-blue-400" />
            Select Folder
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-white hover:bg-white/10 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 bg-[#111] border-b border-white/5 flex flex-col gap-2">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Current Path</label>
          <div className="bg-[#1e1e1e] border border-white/10 rounded flex items-center px-3 py-1.5 min-h-[32px]">
            <span className="text-xs text-zinc-300 truncate w-full font-mono">{currentPath || 'Loading...'}</span>
          </div>
          {hostMountPath && (
            <div className="text-[10px] text-zinc-600">Scoped to: {hostMountPath}</div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto max-h-[400px] min-h-[300px] p-2 bg-[#181818]">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 gap-2">
              <p className="text-sm text-red-400">Failed to load directory</p>
              <p className="text-xs text-zinc-500">{error}</p>
              <button
                onClick={() => loadFolders(currentPath)}
                className="mt-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded text-xs text-zinc-300"
              >
                Retry
              </button>
            </div>
          ) : folders.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-xs text-zinc-500">Empty directory</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {folders.map((f, i) => (
                <button
                  key={i}
                  onClick={() => loadFolders(f.path)}
                  className="flex items-center w-full gap-3 px-3 py-2 rounded-md hover:bg-white/5 text-left transition-colors group"
                >
                  <Folder className="w-4 h-4 text-zinc-500 group-hover:text-blue-400 shrink-0" />
                  <span className="text-sm text-zinc-300 truncate flex-1">{f.name}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 shrink-0 opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-white/10 bg-[#1e1e1e] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-zinc-400 hover:text-white rounded hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSelect(currentPath)}
            disabled={!currentPath || loading || !!error}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            Select Directory
          </button>
        </div>

      </div>
    </div>
  );
}
