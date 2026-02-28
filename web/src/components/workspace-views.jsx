import { useRef, useEffect, useState } from 'react';
import {
  Loader2, AlertCircle, LogIn, Play, Terminal,
  Plug, Package, Rocket, Hourglass, Lock, Syringe, RefreshCw, Settings, Zap, FolderOpen
} from 'lucide-react';
import { getApiBase } from '../config';
import { getAuthHeaders } from '../hooks/use-auth';
import { FolderPickerDialog } from './folder-picker';

const stageIcons = {
  'Allocating ports': Plug,
  'Creating container': Package,
  'Starting container': Rocket,
  'Waiting for IDE': Hourglass,
  'Checking auth': Lock,
  'Injecting credentials': Syringe,
  'Restarting IDE': RefreshCw,
};

function StageIcon({ stage }) {
  const Icon = stageIcons[stage] || Settings;
  return <Icon className="w-4 h-4 text-blue-400" />;
}

function InitView({ workspace }) {
  const logsRef = useRef(null);
  const logs = workspace.initLogs || [];

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
        <h2 className="text-lg font-medium text-white">Setting up workspace...</h2>
        {workspace.stage && (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <StageIcon stage={workspace.stage} />
            <span>{workspace.stage}</span>
          </div>
        )}
      </div>
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-2 text-xs text-zinc-500">
          <Terminal className="w-3 h-3" />
          <span>Initialization Logs</span>
        </div>
        <div
          ref={logsRef}
          className="bg-zinc-950 border border-white/5 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs text-zinc-400 space-y-0.5"
        >
          {logs.map((line, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-zinc-600 select-none shrink-0">{String(i + 1).padStart(2, '0')}</span>
              <span>{line}</span>
            </div>
          ))}
          {logs.length === 0 && (
            <span className="text-zinc-600">Waiting for logs...</span>
          )}
        </div>
      </div>
    </div>
  );
}

function LoginView({ workspace, onLogin }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center">
        <LogIn className="w-8 h-8 text-blue-400" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-lg font-medium text-white">Authentication Required</h2>
        <p className="text-sm text-zinc-400 max-w-sm">
          Your workspace is ready but needs a Google account to use the Antigravity agent.
        </p>
      </div>
      <button
        onClick={onLogin}
        className="flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-lg font-medium text-sm hover:bg-zinc-200 transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        Sign in with Google
      </button>
    </div>
  );
}

function ErrorView({ workspace, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <AlertCircle className="w-12 h-12 text-red-400" />
      <div className="text-center space-y-2">
        <h2 className="text-lg font-medium text-white">Something went wrong</h2>
        <p className="text-sm text-red-400/80 max-w-sm font-mono">{workspace.error || 'Unknown error'}</p>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm hover:bg-zinc-700 transition-colors"
      >
        <Play className="w-3 h-3" />
        Retry
      </button>
    </div>
  );
}

function StoppedView({ workspace, onStart }) {
  const [path, setPath] = useState(workspace.mountedPath || '');
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const handleStart = async () => {
    setSaving(true);
    if (path !== workspace.mountedPath) {
      await fetch(`${getApiBase()}/api/workspaces/${workspace._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ mountedPath: path })
      });
    }
    setSaving(false);
    onStart();
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="w-16 h-16 rounded-2xl bg-zinc-800 border border-white/5 flex items-center justify-center">
        <Play className="w-8 h-8 text-zinc-400" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-lg font-medium text-white">Workspace Stopped</h2>
        <p className="text-sm text-zinc-400">Configure your workspace and click start.</p>
      </div>
      <div className="w-full max-w-sm space-y-2">
        <label className="text-xs font-medium text-zinc-400">Host Folder Path (optional)</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={path}
            onChange={e => setPath(e.target.value)}
            placeholder="/Users/username/my-project"
            className="flex-1 min-w-0 bg-zinc-900 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="flex items-center justify-center px-3 bg-zinc-800 border border-white/10 rounded-md hover:bg-zinc-700 transition-colors shrink-0"
            title="Browse Host Folders"
          >
            <FolderOpen className="w-4 h-4 text-zinc-300" />
          </button>
        </div>
        <p className="text-[10px] text-zinc-500">
          {workspace.type === 'cli'
            ? 'This directory will be used as the workspace folder.'
            : <>This directory on your host machine will be mounted to <code className="bg-white/10 px-1 rounded text-zinc-400">/workspace</code>.</>}
        </p>
      </div>
      <button
        onClick={handleStart}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium text-sm hover:bg-emerald-500 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        Start Workspace
      </button>

      <FolderPickerDialog
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={(p) => {
          setPath(p);
          setShowPicker(false);
        }}
      />
    </div>
  );
}

function EmptyView({ onCreate }) {
  const [path, setPath] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-white/5 flex items-center justify-center">
        <Zap className="w-10 h-10 text-blue-400" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-medium text-white">Welcome to AG Connect</h2>
        <p className="text-sm text-zinc-400 max-w-md">
          Create a workspace to start coding with Antigravity IDE — use Docker or run locally via CLI.
        </p>
      </div>
      <div className="w-full max-w-sm space-y-2">
        <label className="text-xs font-medium text-zinc-400">Host Folder Path (optional)</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={path}
            onChange={e => setPath(e.target.value)}
            placeholder="/Users/username/my-project"
            className="flex-1 min-w-0 bg-zinc-900 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="flex items-center justify-center px-3 bg-zinc-800 border border-white/10 rounded-md hover:bg-zinc-700 transition-colors shrink-0"
            title="Browse Host Folders"
          >
            <FolderOpen className="w-4 h-4 text-zinc-300" />
          </button>
        </div>
        <p className="text-[10px] text-zinc-500">This directory on your host machine will be mounted to <code className="bg-white/10 px-1 rounded text-zinc-400">/workspace</code>.</p>
      </div>
      <button
        onClick={() => onCreate(path)}
        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-500 transition-colors"
      >
        Create Workspace
      </button>

      <FolderPickerDialog
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={(p) => {
          setPath(p);
          setShowPicker(false);
        }}
      />
    </div>
  );
}

function RunningView({ workspace, onStop }) {
  const auth = workspace.auth || {};
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-white/10 flex items-center justify-center">
        <Zap className="w-8 h-8 text-emerald-400" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-lg font-medium text-white">Workspace Running</h2>
        {auth.email && (
          <div className="flex items-center justify-center gap-2 text-sm text-zinc-400">
            {auth.avatar && <img src={auth.avatar} className="w-5 h-5 rounded-full" alt="" />}
            <span>{auth.name || auth.email}</span>
          </div>
        )}
        <p className="text-xs text-zinc-500">Antigravity IDE is running in this workspace.</p>
      </div>
      {onStop && (
        <button
          onClick={onStop}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 transition-colors"
        >
          <Play className="w-3 h-3 rotate-90" />
          Stop Workspace
        </button>
      )}
    </div>
  );
}

export { InitView, LoginView, ErrorView, StoppedView, EmptyView, RunningView };
