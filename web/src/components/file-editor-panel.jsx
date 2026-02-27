import Editor from '@monaco-editor/react';
import { FileText, Save, X, Loader2, Folder } from 'lucide-react';

export default function FileEditorPanel({ selectedFile, fileContent, setFileContent, loadingFile, saving, saveFile, setSelectedFile }) {
  if (!selectedFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3 bg-[#1e1e1e]">
        <Folder className="w-12 h-12 stroke-1 opacity-50" />
        <p className="text-sm">Select a file to view and edit</p>
      </div>
    );
  }

  const extension = selectedFile.split('.').pop()?.toLowerCase();
  let language = 'plaintext';
  if (['js', 'jsx'].includes(extension)) language = 'javascript';
  if (['ts', 'tsx'].includes(extension)) language = 'typescript';
  if (['html', 'htm'].includes(extension)) language = 'html';
  if (['css'].includes(extension)) language = 'css';
  if (['json'].includes(extension)) language = 'json';
  if (['md'].includes(extension)) language = 'markdown';
  if (['sh', 'bash'].includes(extension)) language = 'shell';
  if (['py'].includes(extension)) language = 'python';

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] min-w-0">
      <div className="flex items-center justify-between h-10 px-3 border-b border-white/5 bg-[#181818] shrink-0">
        <div className="flex items-center gap-2 text-sm text-zinc-300 font-medium truncate">
          <FileText className="w-4 h-4 text-emerald-500 opacity-80" />
          <span className="truncate">{selectedFile.split('/').pop()}</span>
          <span className="text-xs text-zinc-600 truncate max-w-[150px] hidden sm:block">{selectedFile}</span>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={saveFile}
            disabled={saving || loadingFile}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10 text-zinc-300 rounded transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
          </button>
          <button
            onClick={() => setSelectedFile(null)}
            className="p-1 hover:bg-white/10 text-zinc-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 relative">
        {loadingFile && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1e1e1e]/50 backdrop-blur-sm">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        )}
        <Editor
          height="100%"
          language={language}
          theme="vs-dark"
          value={fileContent}
          onChange={(val) => setFileContent(val || '')}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            wordWrap: "on",
            padding: { top: 16 }
          }}
        />
      </div>
    </div>
  );
}
