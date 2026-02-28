import { useAuth } from '@/hooks/use-auth';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { useAgConnect } from '@/hooks/use-ag-connect';
import { useQuota } from '@/hooks/use-quota';
import ActivityBar from '@/components/activity-bar';
import HeaderBar from '@/components/header-bar';
import { InitView, LoginView, ErrorView, StoppedView, EmptyView } from '@/components/workspace-views';
import Dashboard from '@/components/dashboard';
import { VncViewer } from '@/components/vnc-viewer';
import TerminalPanel from '@/components/terminal-panel';
import GitPanel from '@/components/git-panel';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import CreateWorkspaceDialog from '@/components/create-workspace-dialog';
import SettingsPage from '@/components/settings-page';
import OnboardingWizard from '@/components/onboarding-wizard';
import ServerSetup from '@/components/server-setup';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { isNative } from '@/lib/capacitor';
import { hasServerEndpoint, setServerEndpoint } from '@/config';
import { Plus, Settings, X } from 'lucide-react';
import { WORKSPACE_ICONS, ICON_COLORS } from '@/components/create-workspace-dialog';
import { useState, useRef } from 'react';

export default function App() {
  const [serverReady, setServerReady] = useState(!isNative || hasServerEndpoint());

  if (isNative && !serverReady) {
    return (
      <ServerSetup onConnect={(url) => {
        setServerEndpoint(url);
        setServerReady(true);
        window.location.reload();
      }} />
    );
  }

  return <AppWithAuth />;
}

function AppWithAuth() {
  const auth = useAuth();

  if (auth.loading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-900 safe-area-top safe-area-bottom">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-6 w-6 text-indigo-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          <span className="text-xs text-zinc-500">Connecting to server...</span>
        </div>
      </div>
    );
  }

  if (!auth.initialized) {
    return <OnboardingWizard onSetup={auth.setup} />;
  }

  if (!auth.authenticated) {
    return <OnboardingWizard onLogin={auth.login} isLogin />;
  }

  return <AuthenticatedApp auth={auth} />;
}

function AuthenticatedApp({ auth }) {
  const push = usePushNotifications();
  const [viewMode, setViewMode] = useState('chat');
  const [editingFile, setEditingFile] = useState(null);
  const [showHostPanel, setShowHostPanel] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showGit, setShowGit] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const {
    workspaces,
    activeId,
    activeWorkspace,
    setActiveId,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    stopWorkspace,
    startWorkspace,
    restartWorkspace,
    clearAuth,
    loginWorkspace,
    oauthPending,
    submitOAuthCallback,
    cancelOAuth,
    loaded,
    ws,
  } = useWorkspaces();

  const ag = useAgConnect(activeWorkspace, ws);
  const { quota } = useQuota(activeWorkspace, ws);

  const handleCreate = ({ name, icon, color, type }) => {
    createWorkspace(name, '', icon, color, type);
  };

  const renderContent = () => {
    if (!loaded) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      );
    }
    if (!activeWorkspace) {
      return <EmptyView onCreate={() => setShowCreateDialog(true)} />;
    }

    switch (activeWorkspace.status) {
      case 'creating':
      case 'initializing':
        return <InitView workspace={activeWorkspace} />;
      case 'needsLogin':
        return <LoginView workspace={activeWorkspace} onLogin={() => loginWorkspace(activeWorkspace._id)} />;
      case 'running':
        return viewMode === 'vnc' ? (
          <VncViewer ref={vncRef} workspaceId={activeWorkspace._id} ag={ag} onControlsChange={setVncState} />
        ) : (
          <Dashboard workspace={activeWorkspace} ag={ag} showHostPanel={showHostPanel} setShowHostPanel={setShowHostPanel} quota={quota} showTerminal={showTerminal} setShowTerminal={setShowTerminal} showGit={showGit} setShowGit={setShowGit} editingFile={editingFile} setEditingFile={setEditingFile} />
        );
      case 'stopped':
        return <StoppedView workspace={activeWorkspace} onStart={() => startWorkspace(activeWorkspace._id)} />;
      case 'error':
        return <ErrorView workspace={activeWorkspace} onRetry={() => startWorkspace(activeWorkspace._id)} />;
      default:
        return <EmptyView onCreate={() => setShowCreateDialog(true)} />;
    }
  };

  const [showMobileNav, setShowMobileNav] = useState(false);
  const [vncState, setVncState] = useState({ quality: '720p', zoom: 1 });
  const vncRef = useRef(null);

  return (
    <div className="flex h-full bg-zinc-950 safe-area-top safe-area-bottom safe-area-x">
      <CreateWorkspaceDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreate}
      />
      <div className="hidden md:flex">
        <ActivityBar
          workspaces={workspaces}
          activeId={activeId}
          onSelect={(id) => { setShowSettings(false); setActiveId(id); }}
          onCreate={() => setShowCreateDialog(true)}
          showSettings={showSettings}
          onToggleSettings={() => setShowSettings(!showSettings)}
        />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        {showSettings ? (
          <SettingsPage auth={auth} push={push} />
        ) : (
          <>
            <HeaderBar
              workspace={activeWorkspace}
              ag={ag}
              onStart={() => startWorkspace(activeWorkspace?._id)}
              onStop={() => stopWorkspace(activeWorkspace?._id)}
              onRestart={() => restartWorkspace(activeWorkspace?._id)}
              onDelete={() => deleteWorkspace(activeWorkspace?._id)}
              onUpdate={(data) => updateWorkspace(activeWorkspace?._id, data)}
              onClearAuth={() => clearAuth(activeWorkspace?._id)}
              viewMode={viewMode}
              setViewMode={setViewMode}
              showHostPanel={showHostPanel}
              setShowHostPanel={setShowHostPanel}
              showTerminal={showTerminal}
              setShowTerminal={setShowTerminal}
              quota={quota}
              onOpenMobileNav={() => setShowMobileNav(true)}
              vncRef={vncRef}
              vncState={vncState}
            />
            <div className="flex-1 overflow-hidden flex flex-col relative">
              <div className="flex-1 overflow-hidden flex flex-col relative">
                {renderContent()}
              </div>
              {showTerminal && activeWorkspace?.status === 'running' && (
                <div className="shrink-0 border-t border-white/10" style={{ height: 280 }}>
                  <TerminalPanel key={`${activeWorkspace._id}-${activeWorkspace.containerId}`} workspaceId={activeWorkspace._id} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {oauthPending && (
        <OAuthDialog
          oauthPending={oauthPending}
          onSubmit={submitOAuthCallback}
          onCancel={cancelOAuth}
        />
      )}
      {showMobileNav && (
        <WorkspaceSelectorDialog
          workspaces={workspaces}
          activeId={activeId}
          onSelect={(id) => { setShowSettings(false); setActiveId(id); setShowMobileNav(false); }}
          onCreate={() => { setShowMobileNav(false); setShowCreateDialog(true); }}
          onSettings={() => { setShowMobileNav(false); setShowSettings(true); }}
          onClose={() => setShowMobileNav(false)}
        />
      )}
    </div>
  );
}

function OAuthDialog({ oauthPending, onSubmit, onCancel }) {
  const [callbackUrl, setCallbackUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(oauthPending.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-white/10 rounded-xl w-[480px] p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-white mb-1">Sign in with Google</h3>
        <p className="text-xs text-zinc-400 mb-4">
          Open the link below to sign in. After granting access, you will be redirected to a page that won't load.
          Copy the full URL from your browser's address bar and paste it below.
        </p>

        <div className="mb-4">
          <label className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5 block">Step 1: Open this link</label>
          <div className="flex gap-2">
            <input
              readOnly
              value={oauthPending.url}
              className="flex-1 bg-zinc-800 border border-white/10 rounded-md px-3 py-2 text-xs text-zinc-300 truncate focus:outline-none"
            />
            <button
              onClick={handleCopyUrl}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-colors shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <a
              href={oauthPending.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-medium rounded-md transition-colors shrink-0"
            >
              Open
            </a>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5 block">Step 2: Paste the callback URL</label>
          <textarea
            value={callbackUrl}
            onChange={(e) => setCallbackUrl(e.target.value)}
            placeholder="http://localhost:1/oauth/callback?code=...&state=..."
            className="w-full bg-zinc-800 border border-white/10 rounded-md px-3 py-2 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-blue-500/50 resize-none h-20"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(callbackUrl)}
            disabled={!callbackUrl.includes('code=')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-xs font-medium rounded-md transition-colors"
          >
            Sign In
          </button>
        </div>
      </div>
    </div>
  );
}

const statusDotColor = {
  creating: 'bg-yellow-400',
  initializing: 'bg-blue-400',
  needsLogin: 'bg-orange-400',
  running: 'bg-emerald-400',
  stopped: 'bg-zinc-500',
  error: 'bg-red-400',
};

function getWsIcon(ws) {
  if (ws.icon >= 0 && ws.icon < WORKSPACE_ICONS.length) {
    const colorIdx = (ws.color ?? 0) % ICON_COLORS.length;
    return { path: WORKSPACE_ICONS[ws.icon], color: ICON_COLORS[colorIdx] };
  }
  return { path: WORKSPACE_ICONS[0], color: ICON_COLORS[0] };
}

function WorkspaceSelectorDialog({ workspaces, activeId, onSelect, onCreate, onSettings, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-64 h-full bg-zinc-950 border-r border-white/10 flex flex-col shadow-2xl safe-area-top safe-area-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 h-10 border-b border-white/5 shrink-0">
          <span className="text-xs font-semibold text-white">Workspaces</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {workspaces.map(ws => {
            const isActive = ws._id === activeId;
            const { path, color } = getWsIcon(ws);
            return (
              <button
                key={ws._id}
                onClick={() => onSelect(ws._id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}`}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke={isActive ? color : '#71717a'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={path} />
                </svg>
                <span className={`text-xs font-medium truncate ${isActive ? 'text-white' : 'text-zinc-400'}`}>{ws.name}</span>
                <div className={`ml-auto w-2 h-2 rounded-full shrink-0 ${statusDotColor[ws.status] || 'bg-zinc-600'}`} />
              </button>
            );
          })}
        </div>
        <div className="shrink-0 border-t border-white/5 p-2 space-y-0.5">
          <button
            onClick={onCreate}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Workspace
          </button>
          <button
            onClick={onSettings}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>
        </div>
      </div>
    </div>
  );
}
