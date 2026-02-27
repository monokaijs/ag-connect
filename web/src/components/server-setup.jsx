import { useState } from 'react';
import { Server, ArrowRight, Loader2, Wifi } from 'lucide-react';

export default function ServerSetup({ onConnect }) {
  const [url, setUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    const cleaned = url.trim().replace(/\/+$/, '');
    if (!cleaned) return;

    setTesting(true);
    setError('');

    try {
      const res = await fetch(`${cleaned}/health`, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      if (data.ok) {
        onConnect(cleaned);
      } else {
        setError('Server responded but health check failed.');
      }
    } catch {
      setError('Could not connect. Check the URL and make sure the server is running.');
    }
    setTesting(false);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-zinc-950 p-8 safe-area-top safe-area-bottom safe-area-x">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/20 flex items-center justify-center">
            <Server className="w-9 h-9 text-indigo-400" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-white mb-1">AG Connect</h1>
            <p className="text-sm text-zinc-400">
              Enter the URL of your AG Connect server to get started.
            </p>
          </div>
        </div>

        <div className="w-full space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
              Server URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
              placeholder="https://4123.xomnghien.com"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full h-11 px-4 text-sm bg-zinc-900 border border-white/10 rounded-xl text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <Wifi className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          <button
            onClick={handleConnect}
            disabled={!url.trim() || testing}
            className="w-full h-11 flex items-center justify-center gap-2 bg-indigo-500 hover:bg-indigo-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-sm font-medium rounded-xl transition-all"
          >
            {testing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                Connect
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
