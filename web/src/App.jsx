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
import { useState } from 'react';

export default function App() {
  const [viewMode, setViewMode] = useState('chat');
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
    ws,
  } = useWorkspaces();

  const ag = useAgConnect(activeWorkspace, ws);
  const { quota } = useQuota(activeWorkspace, ws);

  const handleCreate = ({ name, icon, color }) => {
    createWorkspace(name, '', icon, color);
  };

  const renderContent = () => {
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
          <VncViewer workspaceId={activeWorkspace._id} ag={ag} />
        ) : (
          <Dashboard workspace={activeWorkspace} ag={ag} showHostPanel={showHostPanel} quota={quota} showTerminal={showTerminal} setShowTerminal={setShowTerminal} showGit={showGit} setShowGit={setShowGit} />
        );
      case 'stopped':
        return <StoppedView workspace={activeWorkspace} onStart={() => startWorkspace(activeWorkspace._id)} />;
      case 'error':
        return <ErrorView workspace={activeWorkspace} onRetry={() => startWorkspace(activeWorkspace._id)} />;
      default:
        return <EmptyView onCreate={() => setShowCreateDialog(true)} />;
    }
  };

  return (
    <div className="flex h-full bg-zinc-900">
      <CreateWorkspaceDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreate}
      />
      <ActivityBar
        workspaces={workspaces}
        activeId={activeId}
        onSelect={(id) => { setShowSettings(false); setActiveId(id); }}
        onCreate={() => setShowCreateDialog(true)}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings(!showSettings)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {showSettings ? (
          <SettingsPage />
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
            />
            <div className="flex-1 overflow-hidden flex flex-col relative">
              <div className="flex-1 overflow-hidden flex flex-col relative">
                {renderContent()}
              </div>
              {(showTerminal || showGit) && activeWorkspace?.status === 'running' && (
                <div className="shrink-0 border-t border-white/10" style={{ height: 280 }}>
                  {showTerminal && showGit ? (
                    <PanelGroup direction="horizontal" className="h-full">
                      <Panel defaultSize={60} minSize={25} className="min-w-0">
                        <TerminalPanel key={`${activeWorkspace._id}-${activeWorkspace.containerId}`} workspaceId={activeWorkspace._id} />
                      </Panel>
                      <PanelResizeHandle className="w-1 bg-zinc-900 hover:bg-blue-500/50 transition-colors active:bg-blue-500 cursor-col-resize shrink-0" />
                      <Panel defaultSize={40} minSize={20} className="min-w-0">
                        <GitPanel workspaceId={activeWorkspace._id} />
                      </Panel>
                    </PanelGroup>
                  ) : showTerminal ? (
                    <TerminalPanel key={`${activeWorkspace._id}-${activeWorkspace.containerId}`} workspaceId={activeWorkspace._id} />
                  ) : (
                    <GitPanel workspaceId={activeWorkspace._id} />
                  )}
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
