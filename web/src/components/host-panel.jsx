import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, FileText, Folder, Save, X, Loader2, Trash2 } from 'lucide-react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import FileEditorPanel from './file-editor-panel';

function TreeItem({ name, path, type, nestedDepth = 0, onSelect, onDelete, ag }) {
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
          className="fixed z-50 bg-zinc-900 border border-white/10 rounded-lg shadow-xl p-1 min-w-[120px]"
          style={{ left: ctx.x, top: ctx.y }}
        >
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
            <TreeItem key={c.path} {...c} nestedDepth={nestedDepth + 1} onSelect={onSelect} onDelete={onDelete} ag={ag} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkspaceHostPanel({ workspace, ag }) {
  const [rootItems, setRootItems] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);

  const refreshTree = () => {
    ag.api('GET', '/fs/list').then(res => {
      if (Array.isArray(res)) setRootItems(res);
    }).catch(() => { });
  };

  useEffect(() => {
    if (!workspace.mountedPath) return;
    refreshTree();
  }, [workspace.mountedPath, ag]);

  const loadFile = async (path) => {
    setSelectedFile(path);
    setLoadingFile(true);
    try {
      const res = await ag.api('GET', `/fs/read?path=${encodeURIComponent(path)}`);
      setFileContent(res?.content || '');
    } catch {
      setFileContent('Error loading file.');
    }
    setLoadingFile(false);
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await ag.api('POST', '/fs/write', { path: selectedFile, content: fileContent });
    } catch { }
    setSaving(false);
  };

  if (!workspace?.mountedPath) {
    return (
      <div className="flex h-full border-r border-white/5 bg-[#111] w-[300px] shrink-0 flex-col items-center justify-center text-center gap-3 px-6">
        <Folder className="w-8 h-8 text-zinc-600" />
        <p className="text-sm text-zinc-400">No Host Folder Mounted</p>
        <p className="text-[11px] text-zinc-500">Stop this workspace to configure a host directory mount path.</p>
      </div>
    );
  }

  return (
    <PanelGroup direction="horizontal" className="flex h-full border-r border-white/5 bg-[#111] shrink-0">
      <Panel defaultSize={30} minSize={20} className="border-r border-white/5 flex flex-col h-full bg-[#181818] overflow-hidden min-w-0">
        <div className="px-3 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider shrink-0 shadow-sm z-10">EXPLORER</div>
        <div className="flex-1 overflow-y-auto no-scrollbar py-2">
          {rootItems.map(item => (
            <TreeItem key={item.path} {...item} onSelect={loadFile} onDelete={refreshTree} ag={ag} />
          ))}
          {rootItems.length === 0 && (
            <div className="px-4 text-xs text-zinc-500 italic mt-4">Empty directory or not found</div>
          )}
        </div>
      </Panel>
      <PanelResizeHandle className="w-1 bg-[#1a1a1a] hover:bg-blue-500/50 transition-colors active:bg-blue-500 cursor-col-resize shrink-0 z-10" />
      <Panel defaultSize={70} minSize={30} className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
        <FileEditorPanel
          selectedFile={selectedFile}
          fileContent={fileContent}
          setFileContent={setFileContent}
          loadingFile={loadingFile}
          saving={saving}
          saveFile={saveFile}
          setSelectedFile={setSelectedFile}
        />
      </Panel>
    </PanelGroup>
  );
}
