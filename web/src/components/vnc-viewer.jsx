import { useState, useEffect, useRef } from 'react';
import { wsProtocol, hostname, isDev } from '../config';
import { Loader2, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function VncViewer({ workspaceId, ag }) {
  const [frame, setFrame] = useState(null);
  const [error, setError] = useState(null);
  const [targets, setTargets] = useState([]);
  const [activeTargetId, setActiveTargetId] = useState(null);
  const wsRef = useRef(null);
  const containerRef = useRef(null);
  const metadataRef = useRef(null);

  useEffect(() => {
    if (!ag?.fetchTargets) return;
    const fetch = () => {
      ag.fetchTargets().then(res => {
        if (!Array.isArray(res)) return;
        setTargets(res);
        setActiveTargetId(prev => {
          if (!prev) {
            const editor = res.find(t => t.url?.includes('workbench.html'));
            if (editor) return editor.id;
            const wb = res.find(t => t.url?.includes('workbench'));
            return wb ? wb.id : (res.length > 0 ? res[0].id : null);
          }
          if (!res.find(t => t.id === prev)) return res.length > 0 ? res[0].id : null;
          return prev;
        });
      }).catch(() => { });
    };
    fetch();
    const interval = setInterval(fetch, 2000);
    return () => clearInterval(interval);
  }, [ag]);

  useEffect(() => {
    if (!workspaceId || !activeTargetId) return;
    setFrame(null);
    setError(null);

    const wsUrl = `${isDev ? `${wsProtocol}//${hostname}:8787` : `${wsProtocol}//${window.location.host}`}/api/workspaces/${workspaceId}/cdp/vnc?targetId=${activeTargetId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setError(null);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'frame') {
          setFrame(`data:image/jpeg;base64,${msg.data}`);
          metadataRef.current = msg.metadata; // metadata has deviceWidth, deviceHeight, pageScaleFactor, scrollOffsetX, scrollOffsetY
        }
      } catch (err) {
        console.error('WebSocket message parsing error:', err);
      }
    };

    ws.onerror = () => {
      setError('Connection failed. Please ensure the workspace is running.');
    };

    ws.onclose = () => {
      // closed
    };

    return () => {
      ws.close();
    };
  }, [workspaceId, activeTargetId]);

  const sendMouse = (type, e) => {
    if (!wsRef.current || wsRef.current.readyState !== 1 || !metadataRef.current || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const meta = metadataRef.current;

    // Scale coordinates based on the actual image size vs displayed size
    // For simplicity, we assume the image fills the container in object-contain
    // We need to calculate the actual letterbox offset
    const containerAspect = rect.width / rect.height;
    const frameAspect = meta.deviceWidth / meta.deviceHeight;

    let drawWidth = rect.width;
    let drawHeight = rect.height;
    let offX = 0;
    let offY = 0;

    if (containerAspect > frameAspect) {
      drawWidth = rect.height * frameAspect;
      offX = (rect.width - drawWidth) / 2;
    } else {
      drawHeight = rect.width / frameAspect;
      offY = (rect.height - drawHeight) / 2;
    }

    const unscaledX = e.clientX - rect.left - offX;
    const unscaledY = e.clientY - rect.top - offY;

    if (unscaledX < 0 || unscaledX > drawWidth || unscaledY < 0 || unscaledY > drawHeight) return;

    const x = Math.round((unscaledX / drawWidth) * meta.deviceWidth);
    const y = Math.round((unscaledY / drawHeight) * meta.deviceHeight);

    let button = 'none';
    if (type === 'mouseMoved') {
      if ((e.buttons & 1) !== 0) button = 'left';
      else if ((e.buttons & 4) !== 0) button = 'middle';
      else if ((e.buttons & 2) !== 0) button = 'right';
    } else {
      if (e.button === 0) button = 'left';
      else if (e.button === 1) button = 'middle';
      else if (e.button === 2) button = 'right';
    }

    let modifiers = 0;
    if (e.altKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.metaKey) modifiers |= 4;
    if (e.shiftKey) modifiers |= 8;

    const params = { type, x, y, button, clickCount: e.detail || 1, modifiers };
    wsRef.current.send(JSON.stringify({ type: 'mouse', params }));
  };

  const handlePointerDown = (e) => sendMouse('mousePressed', e);
  const handlePointerUp = (e) => sendMouse('mouseReleased', e);
  const handlePointerMove = (e) => {
    // Only send mouseMoved periodically or if buttons are pressed
    sendMouse('mouseMoved', e);
  };
  const handleWheel = (e) => {
    if (!wsRef.current || wsRef.current.readyState !== 1 || !metadataRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const meta = metadataRef.current;

    const containerAspect = rect.width / rect.height;
    const frameAspect = meta.deviceWidth / meta.deviceHeight;
    let drawWidth = rect.width;
    let drawHeight = rect.height;
    let offX = 0; let offY = 0;
    if (containerAspect > frameAspect) {
      drawWidth = rect.height * frameAspect;
      offX = (rect.width - drawWidth) / 2;
    } else {
      drawHeight = rect.width / frameAspect;
      offY = (rect.height - drawHeight) / 2;
    }
    const unscaledX = e.clientX - rect.left - offX;
    const unscaledY = e.clientY - rect.top - offY;
    if (unscaledX < 0 || unscaledX > drawWidth || unscaledY < 0 || unscaledY > drawHeight) return;

    const x = Math.round((unscaledX / drawWidth) * meta.deviceWidth);
    const y = Math.round((unscaledY / drawHeight) * meta.deviceHeight);

    let modifiers = 0;
    if (e.altKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.metaKey) modifiers |= 4;
    if (e.shiftKey) modifiers |= 8;

    wsRef.current.send(JSON.stringify({
      type: 'mouse', // Backend will dispatch this as Input.dispatchMouseEvent
      params: { type: 'mouseWheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers }
    }));
  };

  const handleKeyDown = (e) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;

    let modifiers = 0;
    if (e.altKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.metaKey) modifiers |= 4;
    if (e.shiftKey) modifiers |= 8;

    wsRef.current.send(JSON.stringify({
      type: 'key',
      params: {
        type: 'keyDown',
        text: e.key.length === 1 ? e.key : undefined,
        unmodifiedText: e.key.length === 1 ? e.key : undefined,
        keyIdentifier: e.key,
        code: e.code,
        key: e.key,
        windowsVirtualKeyCode: e.keyCode,
        nativeVirtualKeyCode: e.keyCode,
        autoRepeat: e.repeat,
        isKeypad: e.location === 3,
        isSystemKey: e.altKey || e.ctrlKey || e.metaKey,
        modifiers
      }
    }));
    e.preventDefault();
  };

  const handleKeyUp = (e) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;

    let modifiers = 0;
    if (e.altKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.metaKey) modifiers |= 4;
    if (e.shiftKey) modifiers |= 8;

    wsRef.current.send(JSON.stringify({
      type: 'key',
      params: {
        type: 'keyUp',
        keyIdentifier: e.key,
        code: e.code,
        key: e.key,
        windowsVirtualKeyCode: e.keyCode,
        nativeVirtualKeyCode: e.keyCode,
        isKeypad: e.location === 3,
        isSystemKey: e.altKey || e.ctrlKey || e.metaKey,
        modifiers
      }
    }));
    e.preventDefault();
  };

  return (
    <div className="flex flex-col flex-1 w-full h-full bg-[#111] overflow-hidden relative">
      <div
        className="flex-1 w-full min-h-0 flex flex-col items-center justify-center focus:outline-none relative"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      >
        {error ? (
          <div className="flex flex-col items-center text-red-400 p-8 bg-zinc-900 rounded-lg border border-red-500/20">
            <AlertCircle className="w-10 h-10 mb-4" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        ) : !frame ? (
          <div className="flex flex-col items-center text-zinc-400 p-8">
            <Loader2 className="w-10 h-10 mb-4 animate-spin text-zinc-600" />
            <p className="text-sm">Connecting to Remote Viewer...</p>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="w-full h-full flex items-center justify-center select-none"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerMove={handlePointerMove}
            onWheel={handleWheel}
            onContextMenu={e => e.preventDefault()}
          >
            <img
              src={frame}
              alt="Remote View"
              className="object-contain w-full h-full pointer-events-none rounded shadow-2xl ring-1 ring-white/10 bg-black"
            />
          </div>
        )}
      </div>

      {targets.length > 0 && (
        <div className="shrink-0 h-10 bg-zinc-950 border-t border-white/5 flex items-center px-2 gap-2 overflow-x-auto no-scrollbar">
          {targets.map(t => (
            <div
              key={t.id}
              onClick={() => setActiveTargetId(t.id)}
              className={`group flex items-center h-7 px-2.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${activeTargetId === t.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'}`}
              title={t.url}
            >
              <div className={`w-1.5 h-1.5 mr-1.5 rounded-full shrink-0 ${activeTargetId === t.id ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]' : 'bg-zinc-700'}`} />
              <span className="truncate max-w-[150px] mr-1">{t.title || 'Window'}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  ag?.closeTarget(t.id);
                  setTargets(prev => prev.filter(x => x.id !== t.id));
                  if (activeTargetId === t.id) setActiveTargetId(targets.find(x => x.id !== t.id)?.id || null);
                }}
                className={`flex items-center justify-center w-5 h-5 rounded ml-1 transition-colors ${activeTargetId === t.id ? 'hover:bg-white/20 text-white/50 hover:text-white' : 'opacity-0 group-hover:opacity-100 hover:bg-white/10 text-zinc-500 hover:text-white'}`}
                title="Close Window"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
