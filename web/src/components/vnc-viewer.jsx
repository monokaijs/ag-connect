import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { getWsBase } from '../config';
import { Loader2, X, AlertCircle } from 'lucide-react';
import { getAuthToken } from '../hooks/use-auth';

export const VncViewer = forwardRef(function VncViewer({ workspaceId, ag, onControlsChange }, ref) {
  const [frame, setFrame] = useState(null);
  const [error, setError] = useState(null);
  const [targets, setTargets] = useState([]);
  const [activeTargetId, setActiveTargetId] = useState(null);
  const [quality, setQuality] = useState('720p');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const wsRef = useRef(null);
  const containerRef = useRef(null);
  const metadataRef = useRef(null);
  const hiddenInputRef = useRef(null);

  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1 });
  const panRef = useRef({ active: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });

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

    const token = getAuthToken();
    const wsUrl = `${getWsBase()}/api/workspaces/${workspaceId}/cdp/vnc?targetId=${activeTargetId}&token=${encodeURIComponent(token || '')}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setError(null);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'frame') {
          setFrame(`data:image/jpeg;base64,${msg.data}`);
          metadataRef.current = msg.metadata;
        } else if (msg.type === 'quality') {
          setQuality(msg.quality);
        }
      } catch { }
    };
    ws.onerror = () => setError('Connection failed. Please ensure the workspace is running.');
    ws.onclose = () => { };
    return () => ws.close();
  }, [workspaceId, activeTargetId]);

  const changeQuality = useCallback((q) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'quality', quality: q }));
    }
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setZoom(z => Math.min(z * 1.5, 5));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom(z => {
      const next = Math.max(z / 1.5, 1);
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const openKeyboard = useCallback(() => {
    if (hiddenInputRef.current) {
      hiddenInputRef.current.focus();
      hiddenInputRef.current.click();
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current?.closest('[data-vnc-root]');
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  }, []);

  useImperativeHandle(ref, () => ({
    quality,
    zoom,
    changeQuality,
    zoomIn,
    zoomOut,
    resetZoom,
    openKeyboard,
    toggleFullscreen,
  }), [quality, zoom, changeQuality, zoomIn, zoomOut, resetZoom, openKeyboard, toggleFullscreen]);

  useEffect(() => {
    onControlsChange?.({ quality, zoom });
  }, [quality, zoom]);

  const getCoords = useCallback((clientX, clientY) => {
    if (!containerRef.current || !metadataRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const meta = metadataRef.current;
    const containerAspect = rect.width / rect.height;
    const frameAspect = meta.deviceWidth / meta.deviceHeight;
    let drawWidth = rect.width;
    let drawHeight = rect.height;
    let offX = 0, offY = 0;
    if (containerAspect > frameAspect) {
      drawWidth = rect.height * frameAspect;
      offX = (rect.width - drawWidth) / 2;
    } else {
      drawHeight = rect.width / frameAspect;
      offY = (rect.height - drawHeight) / 2;
    }
    drawWidth *= zoom;
    drawHeight *= zoom;
    const cx = (rect.width / 2) + pan.x;
    const cy = (rect.height / 2) + pan.y;
    const imgLeft = cx - drawWidth / 2;
    const imgTop = cy - drawHeight / 2;
    const relX = clientX - rect.left - imgLeft;
    const relY = clientY - rect.top - imgTop;
    if (relX < 0 || relX > drawWidth || relY < 0 || relY > drawHeight) return null;
    const x = Math.round((relX / drawWidth) * meta.deviceWidth);
    const y = Math.round((relY / drawHeight) * meta.deviceHeight);
    return { x, y };
  }, [zoom, pan]);

  const sendMouse = useCallback((type, e) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    const coords = getCoords(e.clientX, e.clientY);
    if (!coords) return;
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
    wsRef.current.send(JSON.stringify({
      type: 'mouse',
      params: { type, ...coords, button, clickCount: e.detail || 1, modifiers },
    }));
  }, [getCoords]);

  const isMobile = 'ontouchstart' in window;
  const handlePointerDown = (e) => { if (isMobile && e.pointerType === 'touch') return; sendMouse('mousePressed', e); };
  const handlePointerUp = (e) => { if (isMobile && e.pointerType === 'touch') return; sendMouse('mouseReleased', e); };
  const handlePointerMove = (e) => { if (isMobile && e.pointerType === 'touch') return; sendMouse('mouseMoved', e); };

  const handleWheel = useCallback((e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    const coords = getCoords(e.clientX, e.clientY);
    if (!coords) return;
    let modifiers = 0;
    if (e.altKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.metaKey) modifiers |= 4;
    if (e.shiftKey) modifiers |= 8;
    wsRef.current.send(JSON.stringify({
      type: 'mouse',
      params: { type: 'mouseWheel', ...coords, deltaX: e.deltaX, deltaY: e.deltaY, modifiers },
    }));
  }, [getCoords, zoomIn, zoomOut]);

  const lastTap = useRef(0);
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { active: true, startDist: Math.hypot(dx, dy), startZoom: zoom };
      panRef.current.active = false;
    } else if (e.touches.length === 1 && zoom > 1) {
      panRef.current = { active: true, startX: e.touches[0].clientX, startY: e.touches[0].clientY, startPanX: pan.x, startPanY: pan.y };
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) resetZoom();
      lastTap.current = now;
    }
  }, [zoom, pan, resetZoom]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2 && pinchRef.current.active) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / pinchRef.current.startDist;
      const next = Math.max(1, Math.min(pinchRef.current.startZoom * scale, 5));
      setZoom(next);
      if (next <= 1) setPan({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && panRef.current.active && zoom > 1) {
      const dx = e.touches[0].clientX - panRef.current.startX;
      const dy = e.touches[0].clientY - panRef.current.startY;
      setPan({ x: panRef.current.startPanX + dx, y: panRef.current.startPanY + dy });
    }
  }, [zoom]);

  const handleTouchEnd = useCallback((e) => {
    if (e.touches.length < 2) pinchRef.current.active = false;
    if (e.touches.length === 0) {
      if (!panRef.current.active || (Math.abs(pan.x - panRef.current.startPanX) < 5 && Math.abs(pan.y - panRef.current.startPanY) < 5)) {
        if (e.changedTouches.length === 1 && !pinchRef.current.active) {
          const t = e.changedTouches[0];
          const coords = getCoords(t.clientX, t.clientY);
          if (coords && wsRef.current?.readyState === 1) {
            wsRef.current.send(JSON.stringify({ type: 'mouse', params: { type: 'mousePressed', ...coords, button: 'left', clickCount: 1, modifiers: 0 } }));
            setTimeout(() => {
              if (wsRef.current?.readyState === 1) {
                wsRef.current.send(JSON.stringify({ type: 'mouse', params: { type: 'mouseReleased', ...coords, button: 'left', clickCount: 1, modifiers: 0 } }));
              }
            }, 50);
          }
        }
      }
      panRef.current.active = false;
    }
  }, [getCoords, pan]);

  const handleHiddenInput = useCallback((e) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    const text = e.target.value;
    if (!text) return;
    for (const char of text) {
      wsRef.current.send(JSON.stringify({ type: 'key', params: { type: 'keyDown', text: char, unmodifiedText: char, key: char, code: '', windowsVirtualKeyCode: char.charCodeAt(0), nativeVirtualKeyCode: char.charCodeAt(0), modifiers: 0 } }));
      wsRef.current.send(JSON.stringify({ type: 'key', params: { type: 'keyUp', key: char, code: '', windowsVirtualKeyCode: char.charCodeAt(0), nativeVirtualKeyCode: char.charCodeAt(0), modifiers: 0 } }));
    }
    e.target.value = '';
  }, []);

  const handleHiddenKeyDown = useCallback((e) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    if (e.key.length > 1) {
      let modifiers = 0;
      if (e.altKey) modifiers |= 1;
      if (e.ctrlKey) modifiers |= 2;
      if (e.metaKey) modifiers |= 4;
      if (e.shiftKey) modifiers |= 8;
      wsRef.current.send(JSON.stringify({ type: 'key', params: { type: 'keyDown', keyIdentifier: e.key, code: e.code, key: e.key, windowsVirtualKeyCode: e.keyCode, nativeVirtualKeyCode: e.keyCode, modifiers } }));
      e.preventDefault();
    }
  }, []);

  const handleHiddenKeyUp = useCallback((e) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    if (e.key.length > 1) {
      let modifiers = 0;
      if (e.altKey) modifiers |= 1;
      if (e.ctrlKey) modifiers |= 2;
      if (e.metaKey) modifiers |= 4;
      if (e.shiftKey) modifiers |= 8;
      wsRef.current.send(JSON.stringify({ type: 'key', params: { type: 'keyUp', keyIdentifier: e.key, code: e.code, key: e.key, windowsVirtualKeyCode: e.keyCode, nativeVirtualKeyCode: e.keyCode, modifiers } }));
    }
  }, []);

  const handleKeyDown = (e) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    let modifiers = 0;
    if (e.altKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.metaKey) modifiers |= 4;
    if (e.shiftKey) modifiers |= 8;
    wsRef.current.send(JSON.stringify({ type: 'key', params: { type: 'keyDown', text: e.key.length === 1 ? e.key : undefined, unmodifiedText: e.key.length === 1 ? e.key : undefined, keyIdentifier: e.key, code: e.code, key: e.key, windowsVirtualKeyCode: e.keyCode, nativeVirtualKeyCode: e.keyCode, autoRepeat: e.repeat, isKeypad: e.location === 3, isSystemKey: e.altKey || e.ctrlKey || e.metaKey, modifiers } }));
    e.preventDefault();
  };

  const handleKeyUp = (e) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    let modifiers = 0;
    if (e.altKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.metaKey) modifiers |= 4;
    if (e.shiftKey) modifiers |= 8;
    wsRef.current.send(JSON.stringify({ type: 'key', params: { type: 'keyUp', keyIdentifier: e.key, code: e.code, key: e.key, windowsVirtualKeyCode: e.keyCode, nativeVirtualKeyCode: e.keyCode, isKeypad: e.location === 3, isSystemKey: e.altKey || e.ctrlKey || e.metaKey, modifiers } }));
    e.preventDefault();
  };

  const imgStyle = {
    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
    transformOrigin: 'center center',
    transition: pinchRef.current.active || panRef.current.active ? 'none' : 'transform 0.15s ease-out',
  };

  return (
    <div data-vnc-root className="flex flex-col flex-1 w-full h-full bg-[#0a0a0a] overflow-hidden relative">
      <input
        ref={hiddenInputRef}
        type="text"
        className="fixed -top-[100px] left-0 w-0 h-0 opacity-0"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onInput={handleHiddenInput}
        onKeyDown={handleHiddenKeyDown}
        onKeyUp={handleHiddenKeyUp}
      />

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
            className="w-full h-full flex items-center justify-center select-none overflow-hidden"
            style={{ touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerMove={handlePointerMove}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onContextMenu={e => e.preventDefault()}
          >
            <img
              src={frame}
              alt="Remote View"
              className="object-contain w-full h-full pointer-events-none bg-black"
              style={imgStyle}
              draggable={false}
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
});
