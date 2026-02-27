import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Save, FileCode } from 'lucide-react';
import Editor from '@monaco-editor/react';

export function FilePreviewDialog({ fullPath, open, onClose, ag }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !fullPath) return;

    let isMounted = true;
    setLoading(true);
    setError(null);
    setContent('');

    const relativePath = fullPath.replace(/^\/workspace\//, '');

    ag.api('GET', `/fs/read?path=${encodeURIComponent(relativePath)}`)
      .then(res => {
        if (!isMounted) return;
        if (res?.content !== undefined) {
          setContent(res.content);
        } else {
          setError('Failed to load file content.');
        }
      })
      .catch(err => {
        if (!isMounted) return;
        setError(err.message || 'Error loading file.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [fullPath, open, ag]);

  const handleSave = async () => {
    if (!fullPath) return;
    setSaving(true);
    const relativePath = fullPath.replace(/^\/workspace\//, '');
    try {
      await ag.api('POST', '/fs/write', { path: relativePath, content });
    } catch (err) {
      console.error('Failed to save file', err);
    }
    setSaving(false);
  };

  const getLanguageOptions = (path) => {
    if (!path) return 'plaintext';
    const ext = path.split('.').pop().toLowerCase();
    switch (ext) {
      case 'js':
      case 'jsx': return 'javascript';
      case 'ts':
      case 'tsx': return 'typescript';
      case 'json': return 'json';
      case 'css': return 'css';
      case 'html': return 'html';
      case 'md': return 'markdown';
      case 'py': return 'python';
      case 'go': return 'go';
      case 'rs': return 'rust';
      case 'sh': return 'shell';
      default: return 'plaintext';
    }
  };

  const filename = fullPath ? fullPath.split('/').pop() : '';

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className='max-w-[70vw] w-full h-[80vh] flex flex-col p-0 gap-0 overflow-hidden bg-[#1e1e1e] border-zinc-800 rounded-xl'>
        <DialogHeader className='px-4 py-3 flex flex-row items-center justify-between border-b border-zinc-800 m-0'>
          <div className='flex items-center gap-2'>
            <FileCode className='w-4 h-4 text-zinc-400' />
            <DialogTitle className='text-sm font-medium text-zinc-200 tracking-wide font-mono'>{filename}</DialogTitle>
          </div>
          <div className='flex items-center gap-3 pr-6'>
            <button
              onClick={handleSave}
              disabled={loading || saving}
              className='flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50'
            >
              {saving ? <Loader2 className='w-3.5 h-3.5 animate-spin' /> : <Save className='w-3.5 h-3.5' />}
              Save
            </button>
          </div>
        </DialogHeader>

        <div className='flex-1 relative w-full h-full min-h-0 bg-[#1e1e1e]'>
          {loading ? (
            <div className='absolute inset-0 flex flex-col items-center justify-center text-zinc-500 gap-3'>
              <Loader2 className='w-6 h-6 animate-spin' />
              <span className='text-xs'>Loading file...</span>
            </div>
          ) : error ? (
            <div className='absolute inset-0 flex items-center justify-center text-red-400 text-sm'>
              {error}
            </div>
          ) : (
            <Editor
              height="100%"
              theme="vs-dark"
              language={getLanguageOptions(fullPath)}
              value={content}
              onChange={(val) => setContent(val || '')}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                padding: { top: 16, bottom: 16 },
                renderLineHighlight: 'all',
                bracketPairColorization: { enabled: true },
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
