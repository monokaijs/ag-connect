import { useState, useEffect, useCallback } from 'react';
import { GitBranch, Plus, Minus, Check, Upload, Download, RefreshCw, Loader2, FileText, Clock, ChevronDown, ArrowUpDown } from 'lucide-react';
import { getApiBase } from '../config';
import { getAuthHeaders } from '../hooks/use-auth';

export default function GitPanel({ workspaceId }) {
  const [tab, setTab] = useState('changes');
  const [status, setStatus] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [actionResult, setActionResult] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${getApiBase()}/api/workspaces/${workspaceId}/git/status`, { headers: getAuthHeaders() });
      const data = await res.json();
      setStatus(data);
    } catch { }
    setLoading(false);
  }, [workspaceId]);

  const fetchLog = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${getApiBase()}/api/workspaces/${workspaceId}/git/log`, { headers: getAuthHeaders() });
      const data = await res.json();
      setLog(data.commits || []);
    } catch { }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    if (tab === 'changes') fetchStatus();
    else if (tab === 'history') fetchLog();
  }, [tab, fetchStatus, fetchLog]);

  const doAction = async (action, body) => {
    setActionLoading(action);
    setActionResult('');
    try {
      const res = await fetch(`${getApiBase()}/api/workspaces/${workspaceId}/git/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json();
      setActionResult(data.output || data.error || 'Done');
      fetchStatus();
    } catch (err) {
      setActionResult(err.message);
    }
    setActionLoading('');
  };

  const stageAll = () => doAction('stage', { files: [] });
  const unstageAll = () => doAction('unstage', { files: [] });
  const commit = () => { if (commitMsg.trim()) doAction('commit', { message: commitMsg.trim() }).then(() => setCommitMsg('')); };
  const sync = () => doAction('sync');

  const statusIcon = (s) => {
    const colors = { M: 'text-amber-400', A: 'text-emerald-400', D: 'text-red-400', '?': 'text-zinc-500', R: 'text-blue-400' };
    return <span className={`text-[10px] font-mono font-bold w-3 ${colors[s] || 'text-zinc-400'}`}>{s}</span>;
  };

  const tabs = [
    { id: 'changes', label: 'Changes' },
    { id: 'history', label: 'History' },
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-xs">
      <div className="flex items-center h-8 px-2 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-1 flex-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`h-6 px-2.5 rounded text-[11px] font-medium transition-colors ${tab === t.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {status?.branch && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-500 mr-2">
              <GitBranch className="w-3 h-3" />
              {status.branch}
            </span>
          )}
          <button onClick={tab === 'changes' ? fetchStatus : fetchLog} className="p-1 text-zinc-500 hover:text-white transition-colors" title="Refresh">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {tab === 'changes' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {!status ? (
              <div className="flex items-center justify-center py-8 text-zinc-500">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : status.staged.length === 0 && status.unstaged.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-1 text-zinc-500">
                <Check className="w-5 h-5" />
                <span>Working tree clean</span>
              </div>
            ) : (
              <>
                {status.staged.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wider bg-zinc-900/50">
                      <span>Staged ({status.staged.length})</span>
                      <button onClick={unstageAll} className="text-zinc-500 hover:text-white" title="Unstage all">
                        <Minus className="w-3 h-3" />
                      </button>
                    </div>
                    {status.staged.map((f, i) => (
                      <div key={`s-${i}`} className="flex items-center gap-2 px-3 py-1 hover:bg-white/5">
                        {statusIcon(f.status)}
                        <span className="truncate text-zinc-300">{f.file}</span>
                      </div>
                    ))}
                  </div>
                )}
                {status.unstaged.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wider bg-zinc-900/50">
                      <span>Changes ({status.unstaged.length})</span>
                      <button onClick={stageAll} className="text-zinc-500 hover:text-white" title="Stage all">
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    {status.unstaged.map((f, i) => (
                      <div key={`u-${i}`} className="flex items-center gap-2 px-3 py-1 hover:bg-white/5">
                        {statusIcon(f.status)}
                        <span className="truncate text-zinc-300">{f.file}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {status && (status.staged.length > 0 || status.unstaged.length > 0) && (
            <div className="shrink-0 border-t border-white/5 p-2">
              <input
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
                placeholder="Commit message..."
                className="w-full h-7 px-2 mb-1.5 text-[11px] bg-zinc-900 border border-white/10 rounded text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50"
              />
              <div className="flex gap-1 relative">
                <button
                  onClick={commit}
                  disabled={!commitMsg.trim() || !!actionLoading}
                  className="flex-1 h-7 flex items-center justify-center gap-1 text-[10px] font-medium bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded-l transition-colors disabled:opacity-40"
                >
                  {actionLoading === 'commit' ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Check className="w-3 h-3" /> Commit</>}
                </button>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="h-7 px-1.5 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded-r border-l border-indigo-500/30 transition-colors"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
                {showDropdown && (
                  <div className="absolute bottom-full mb-1 right-0 w-40 bg-zinc-900 border border-white/10 rounded-lg shadow-xl p-1 z-20">
                    <button
                      onClick={() => { setShowDropdown(false); commit(); }}
                      disabled={!commitMsg.trim() || !!actionLoading}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-white hover:bg-white/5 rounded-md transition-colors text-left disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Commit
                    </button>
                    <button
                      onClick={() => { setShowDropdown(false); sync(); }}
                      disabled={!!actionLoading}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-white hover:bg-white/5 rounded-md transition-colors text-left disabled:opacity-40"
                    >
                      <ArrowUpDown className="w-3.5 h-3.5" />
                      Sync
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {actionResult && (
            <div className="shrink-0 border-t border-white/5 px-3 py-2 text-[10px] text-zinc-400 font-mono whitespace-pre-wrap max-h-20 overflow-y-auto">
              {actionResult}
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : log.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-1 text-zinc-500">
              <Clock className="w-5 h-5" />
              <span>No commits</span>
            </div>
          ) : (
            log.map((c, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-1.5 hover:bg-white/5 border-b border-white/[0.03]">
                <span className="text-[10px] font-mono text-indigo-400 shrink-0 mt-0.5">{c.short}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-zinc-300">{c.message}</div>
                  <div className="text-[10px] text-zinc-600">{c.author} · {c.time}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
