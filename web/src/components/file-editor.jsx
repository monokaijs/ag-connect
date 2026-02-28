import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Save, X, FileCode } from 'lucide-react';
import Editor from '@monaco-editor/react';

function getLanguage(path) {
    if (!path) return 'plaintext';
    const ext = path.split('.').pop().toLowerCase();
    const map = {
        js: 'javascript', jsx: 'javascript', mjs: 'javascript',
        ts: 'typescript', tsx: 'typescript',
        json: 'json', css: 'css', html: 'html', md: 'markdown',
        py: 'python', go: 'go', rs: 'rust', sh: 'shell',
        yml: 'yaml', yaml: 'yaml', toml: 'ini', xml: 'xml',
        sql: 'sql', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
        rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
        vue: 'html', svelte: 'html', scss: 'scss', less: 'less',
    };
    return map[ext] || 'plaintext';
}

function MenuBar({ onSave, onClose, onUndo, onRedo, onToggleWrap, onToggleMinimap, dirty, saving, loading }) {
    const [openMenu, setOpenMenu] = useState(null);
    const barRef = useRef(null);

    useEffect(() => {
        if (!openMenu) return;
        const handler = (e) => {
            if (barRef.current && !barRef.current.contains(e.target)) setOpenMenu(null);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [openMenu]);

    const menus = {
        File: [
            { label: 'Save', shortcut: 'Ctrl+S', action: onSave, disabled: loading || saving || !dirty },
            { type: 'sep' },
            { label: 'Close Editor', shortcut: 'Esc', action: onClose },
        ],
        Edit: [
            { label: 'Undo', shortcut: 'Ctrl+Z', action: onUndo },
            { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: onRedo },
        ],
        View: [
            { label: 'Toggle Word Wrap', action: onToggleWrap },
            { label: 'Toggle Minimap', action: onToggleMinimap },
        ],
    };

    return (
        <div ref={barRef} className="flex items-center gap-0 shrink-0">
            {Object.entries(menus).map(([name, items]) => (
                <div key={name} className="relative">
                    <button
                        onMouseDown={(e) => { e.preventDefault(); setOpenMenu(openMenu === name ? null : name); }}
                        onMouseEnter={() => { if (openMenu && openMenu !== name) setOpenMenu(name); }}
                        className={`px-2.5 py-1 text-xs transition-colors ${openMenu === name
                            ? 'bg-white/10 text-white'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                            }`}
                    >
                        {name}
                    </button>
                    {openMenu === name && (
                        <div className="absolute top-full left-0 mt-px min-w-[200px] bg-zinc-900 border border-white/10 rounded-md shadow-2xl py-1 z-50">
                            {items.map((item, i) =>
                                item.type === 'sep' ? (
                                    <div key={i} className="h-px bg-white/5 my-1 mx-2" />
                                ) : (
                                    <button
                                        key={i}
                                        disabled={item.disabled}
                                        onClick={() => { item.action?.(); setOpenMenu(null); }}
                                        className="w-full flex items-center justify-between gap-6 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
                                    >
                                        <span>{item.label}</span>
                                        {item.shortcut && <span className="text-[10px] text-zinc-500">{item.shortcut}</span>}
                                    </button>
                                )
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

export default function FileEditor({ fullPath, ag, onClose, onOpenFile }) {
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState(null);
    const [dirty, setDirty] = useState(false);
    const [editorRef, setEditorRef] = useState(null);
    const [wordWrap, setWordWrap] = useState('on');
    const [minimap, setMinimap] = useState(false);

    useEffect(() => {
        if (!fullPath) return;
        let mounted = true;
        setLoading(true);
        setError(null);
        setContent('');
        setDirty(false);
        setSaved(false);

        const rel = fullPath.replace(/^\/workspace\//, '');
        ag.api('GET', `/fs/read?path=${encodeURIComponent(rel)}`)
            .then(res => {
                if (!mounted) return;
                if (res?.content !== undefined) setContent(res.content);
                else setError('Failed to load file content.');
            })
            .catch(err => {
                if (!mounted) return;
                setError(err.message || 'Error loading file.');
            })
            .finally(() => { if (mounted) setLoading(false); });

        return () => { mounted = false; };
    }, [fullPath, ag]);

    const handleSave = useCallback(async () => {
        if (!fullPath || saving) return;
        setSaving(true);
        const rel = fullPath.replace(/^\/workspace\//, '');
        try {
            await ag.api('POST', '/fs/write', { path: rel, content });
            setDirty(false);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            console.error('Save failed', err);
        }
        setSaving(false);
    }, [fullPath, content, ag, saving]);

    useEffect(() => {
        const handler = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleSave, onClose]);

    const handleChange = (val) => {
        setContent(val || '');
        setDirty(true);
        setSaved(false);
    };

    const handleEditorMount = (editor) => {
        setEditorRef(editor);
        editor.focus();
    };

    const filename = fullPath ? fullPath.split('/').pop() : '';

    return (
        <div className="flex flex-col h-full w-full bg-[#1e1e1e]">
            <div className="shrink-0 h-9 flex items-center justify-between pl-2 bg-zinc-950 border-b border-white/5">
                <MenuBar
                    onSave={handleSave}
                    onClose={onClose}
                    onUndo={() => editorRef?.trigger('', 'undo')}
                    onRedo={() => editorRef?.trigger('', 'redo')}
                    onToggleWrap={() => setWordWrap(w => w === 'on' ? 'off' : 'on')}
                    onToggleMinimap={() => setMinimap(m => !m)}
                    dirty={dirty}
                    saving={saving}
                    loading={loading}
                />
                <div className="flex items-center gap-2 px-3">
                    <FileCode className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-xs text-zinc-400 font-mono">{filename}</span>
                    {dirty && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                    {saved && <span className="text-[10px] text-emerald-400">Saved</span>}
                </div>
                <div className="flex items-center gap-1 pr-2">
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
                        title="Close"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 relative">
                {loading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 gap-3">
                        <Loader2 className="w-6 h-6 animate-spin" />
                        <span className="text-xs">Loading file...</span>
                    </div>
                ) : error ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                        <span className="text-red-400 text-sm">{error}</span>
                        <button
                            onClick={onClose}
                            className="text-xs text-zinc-400 hover:text-white transition-colors"
                        >
                            Go back
                        </button>
                    </div>
                ) : (
                    <Editor
                        height="100%"
                        theme="vs-dark"
                        language={getLanguage(fullPath)}
                        value={content}
                        onChange={handleChange}
                        onMount={handleEditorMount}
                        options={{
                            minimap: { enabled: minimap },
                            fontSize: 13,
                            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                            scrollBeyondLastLine: false,
                            wordWrap,
                            padding: { top: 12, bottom: 12 },
                            renderLineHighlight: 'all',
                            bracketPairColorization: { enabled: true },
                            smoothScrolling: true,
                            cursorSmoothCaretAnimation: 'on',
                        }}
                    />
                )}
            </div>

            <div className="shrink-0 h-6 flex items-center justify-between px-3 bg-zinc-950 border-t border-white/5 text-[10px] text-zinc-600">
                <div className="flex items-center gap-3">
                    <span>{getLanguage(fullPath)}</span>
                    <span>UTF-8</span>
                </div>
                <div className="flex items-center gap-3">
                    {dirty && <span className="text-yellow-500/70">Modified</span>}
                    <span>Ctrl+S to save</span>
                </div>
            </div>
        </div>
    );
}
