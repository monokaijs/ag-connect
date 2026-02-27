import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { getApiBase, getWsBase } from '../config';
import { getAuthToken } from '../hooks/use-auth';
import { X, Plus, TerminalSquare } from 'lucide-react';

function TerminalTab({ workspaceId, active, onActivate, onClose, label }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '\'JetBrains Mono\', \'Fira Code\', \'Cascadia Code\', Menlo, monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#d7ba7d',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#d7ba7d',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#e5e5e5',
      },
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const wsBase = getWsBase();
    const token = getAuthToken();
    const wsUrl = `${wsBase}/api/workspaces/${workspaceId}/terminal?token=${encodeURIComponent(token || '')}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const dims = { type: 'resize', cols: term.cols, rows: term.rows };
      ws.send('\x01' + JSON.stringify(dims));
    };

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data));
      } else {
        term.write(e.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      term.write('\r\n\x1b[90m[Terminal disconnected]\x1b[0m\r\n');
    };

    term.onData((data) => {
      if (ws.readyState === 1) {
        ws.send(data);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === 1) {
        ws.send('\x01' + JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (active && fitAddonRef.current) {
      setTimeout(() => {
        try { fitAddonRef.current.fit(); } catch { }
        termRef.current?.focus();
      }, 50);
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: active ? 'block' : 'none' }}
    />
  );
}

export default function TerminalPanel({ workspaceId }) {
  const [tabs, setTabs] = useState([{ id: 1, label: 'bash' }]);
  const [activeTab, setActiveTab] = useState(1);
  const nextId = useRef(2);

  const addTab = () => {
    const id = nextId.current++;
    setTabs(prev => [...prev, { id, label: 'bash' }]);
    setActiveTab(id);
  };

  const closeTab = (id) => {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) return prev;
      if (activeTab === id) {
        setActiveTab(next[next.length - 1].id);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="flex items-center h-8 px-2 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto no-scrollbar">
          {tabs.map(tab => (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-medium cursor-pointer transition-colors shrink-0 ${activeTab === tab.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
            >
              <TerminalSquare className="w-3 h-3" />
              <span>{tab.label}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  className="ml-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={addTab}
          title="New Terminal"
          className="flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-white hover:bg-white/5 transition-colors shrink-0"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 relative">
        {tabs.map(tab => (
          <TerminalTab
            key={tab.id}
            workspaceId={workspaceId}
            active={activeTab === tab.id}
            onActivate={() => setActiveTab(tab.id)}
            onClose={() => closeTab(tab.id)}
            label={tab.label}
          />
        ))}
      </div>
    </div>
  );
}
