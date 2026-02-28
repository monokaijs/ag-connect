import { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, FileText, Folder, Loader2, Trash2, Download, Plus } from 'lucide-react';
import { getApiBase } from '../config';
import { getAuthHeaders } from '../hooks/use-auth';

function TreeItem({ name, path, type, nestedDepth = 0, onSelect, onDelete, ag, workspaceId }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ctx, setCtx] = useState(null);

  const toggle = async () => {
    if (type !== 'directory') {
      onSelect(path);
      return;
    }
    if (!open && children.length === 0) {
      setLoading(true);
      try {
        const res = await ag.api('GET', `/fs/list?path=${encodeURIComponent(path)}`);
        if (Array.isArray(res)) setChildren(res);
      } catch { }
      setLoading(false);
    }
    setOpen(!open);
  };

  const handleContext = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY });
    const close = () => { setCtx(null); window.removeEventListener('click', close); };
    window.addEventListener('click', close);
  };

  const handleDelete = async () => {
    setCtx(null);
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await ag.api('POST', '/fs/delete', { path });
      onDelete?.();
    } catch { }
  };

  const handleDownload = async () => {
    setCtx(null);
    try {
      const res = await fetch(`${getApiBase()}/api/workspaces/${workspaceId}/fs/read?path=${encodeURIComponent(path)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data?.content === undefined) return;
      const blob = new Blob([data.content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch { }
  };

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1 px-2 hover:bg-white/10 cursor-pointer text-sm text-zinc-300"
        style={{ paddingLeft: `${nestedDepth * 12 + 8}px` }}
        onClick={toggle}
        onContextMenu={handleContext}
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0">
          {type === 'directory' ? (
            loading ? <Loader2 className="w-3 h-3 animate-spin text-zinc-500" /> :
              open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <FileText className="w-3.5 h-3.5 text-zinc-500" />
          )}
        </div>
        <span className="truncate select-none">{name}</span>
      </div>
      {ctx && (
        <div
          className="fixed z-50 bg-zinc-900 border border-white/10 rounded-lg shadow-xl p-1 min-w-[140px]"
          style={{ left: ctx.x, top: ctx.y }}
        >
          {type !== 'directory' && (
            <button
              onClick={handleDownload}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-white hover:bg-white/5 rounded-md transition-colors text-left"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
          )}
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-red-400 hover:bg-red-400/5 rounded-md transition-colors text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      )}
      {open && type === 'directory' && (
        <div className="flex flex-col">
          {children.map(c => (
            <TreeItem key={c.path} {...c} nestedDepth={nestedDepth + 1} onSelect={onSelect} onDelete={onDelete} ag={ag} workspaceId={workspaceId} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkspaceHostPanel({ workspace, ag, onFileOpen }) {
  const [rootItems, setRootItems] = useState([]);
  const fileInputRef = useRef(null);

  const refreshTree = () => {
    ag.api('GET', '/fs/list').then(res => {
      if (Array.isArray(res)) setRootItems(res);
    }).catch(() => { });
  };

  useEffect(() => {
    if (workspace.status !== 'running') return;
    refreshTree();
  }, [workspace.status, ag]);

  const handleSelect = (filePath) => {
    const fullPath = filePath.startsWith('/workspace') ? filePath : `/workspace/${filePath}`;
    if (onFileOpen) onFileOpen(fullPath);
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await ag.api('POST', '/fs/write', { path: file.name, content: reader.result });
        refreshTree();
      } catch { }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="flex flex-col h-full bg-[#0c0c0c] w-full shrink-0 overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.2)] z-10 bg-[#0c0c0c]">
        <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">EXPLORER</span>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-0.5 text-zinc-500 hover:text-white transition-colors"
          title="Upload File"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar py-2">
        {rootItems.map(item => (
          <TreeItem key={item.path} {...item} onSelect={handleSelect} onDelete={refreshTree} ag={ag} workspaceId={workspace._id} />
        ))}
        {rootItems.length === 0 && (
          <div className="px-4 text-[11px] text-zinc-500 italic mt-4">Empty directory or missing</div>
        )}
      </div>
    </div>
  );
}
