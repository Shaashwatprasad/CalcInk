import { useEffect, useRef, useState } from 'react';
import { InkStore } from '../document/InkStore';
import { mountInk } from '../render/mountInk';
import type { InkTool } from '../render/mountInk';
import { openNotebookStorage, validateDocument } from '../persistence/document';
import { prepareOffline } from '../offline/register';
import { startRecognizer } from './recognizer';
import type { RecognitionState } from './recognizer';
import { monitorFrames } from '../metrics/frames';
import type { FrameMetrics } from '../metrics/frames';

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    pen: 'M4 20l4-1 12-12-3-3L5 16l-1 4M14 7l3 3',
    erase: 'M5 15l8-10 7 6-8 10H8l-3-6M9 10l7 6M12 21h9',
    pixel: 'M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM16 15v6m-3-3h6',
    undo: 'M8 5L3 10l5 5M3 10h10a7 7 0 010 14',
    redo: 'M16 5l5 5-5 5m5-5H11a7 7 0 000 14',
    clear: 'M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6m4-6v6',
    download: 'M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4',
    upload: 'M12 15V3m-4 4 4-4 4 4M4 17v4h16v-4',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
const initialState: RecognitionState = {
  status: 'loading',
  message: 'Loading on-device recognition…',
  projections: [],
  queued: 0,
  inferenceMs: 0,
};
export function App() {
  const [store] = useState(() => new InkStore());
  const [document, setDocument] = useState(() => store.getSnapshot());
  const [tool, setTool] = useState<InkTool>({
    mode: 'pen',
    width: 3,
    color: '#252d38',
    eraserRadius: 12,
  });
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const committed = useRef<HTMLCanvasElement>(null);
  const active = useRef<HTMLCanvasElement>(null);
  const projection = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Opening notebook…');
  const [recognition, setRecognition] = useState(initialState);
  const [retry, setRetry] = useState(0);
  const [offlineCached, setOfflineCached] = useState(false);
  const [notice, setNotice] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const debug = new URLSearchParams(location.search).get('debug') === 'true';
  const [frameMetrics, setFrameMetrics] = useState<FrameMetrics>();
  useEffect(() => {
    if (debug) return monitorFrames(setFrameMetrics);
  }, [debug]);

  useEffect(
    () => store.subscribe(() => setDocument(store.getSnapshot())),
    [store],
  );
  useEffect(() => {
    let alive = true;
    let stopSaving: (() => void) | undefined;
    let close: (() => void) | undefined;
    void (async () => {
      try {
        const storage = await openNotebookStorage();
        close = () => storage.close();
        const restored = await storage.load();
        if (!alive) {
          storage.close();
          return;
        }
        if (restored) store.replaceDocument(restored);
        setSaveStatus('Saved on this device');
        stopSaving = store.subscribe(() => {
          setSaveStatus('Saving…');
          const snapshot = store.getSnapshot();
          void storage.save(snapshot).then(
            () => {
              if (
                alive &&
                store.getSnapshot().revision === snapshot.revision &&
                store.getSnapshot().documentId === snapshot.documentId &&
                store.getSnapshot().generation === snapshot.generation
              )
                setSaveStatus('Saved on this device');
            },
            () => {
              if (
                alive &&
                store.getSnapshot().revision === snapshot.revision &&
                store.getSnapshot().documentId === snapshot.documentId &&
                store.getSnapshot().generation === snapshot.generation
              )
                setSaveStatus('Save failed · export your ink');
            },
          );
        });
      } catch {
        if (alive) setSaveStatus('Storage unavailable · export your ink');
      }
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
      stopSaving?.();
      close?.();
    };
  }, [store]);
  useEffect(() => {
    if (!loaded || !committed.current || !active.current) return;
    try {
      return mountInk(
        committed.current,
        active.current,
        store,
        () => toolRef.current,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Drawing could not start');
    }
  }, [store, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try {
      return startRecognizer(store, setRecognition);
    } catch (e) {
      setRecognition({
        ...initialState,
        status: 'error',
        message: e instanceof Error ? e.message : 'Recognition unavailable',
      });
    }
  }, [store, loaded, retry]);
  useEffect(() => {
    let alive = true;
    void prepareOffline().then(
      (ok) => {
        if (alive) setOfflineCached(ok);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const canvas = projection.current;
    if (!canvas) return;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const p of recognition.projections) {
        if (!p.answerText || !p.answerBounds) continue;
        const height = Math.min(
          36,
          Math.max(22, (p.equalsBounds!.maxY - p.equalsBounds!.minY) * 1.15),
        );
        ctx.font = `500 ${height}px Georgia`;
        ctx.fillStyle = '#287568';
        ctx.textBaseline = 'middle';
        const x = p.answerBounds.minX;
        const y = (p.equalsBounds!.minY + p.equalsBounds!.maxY) / 2;
        ctx.fillText(p.answerText, x, y, Math.max(1, rect.width - x - 8));
      }
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    window.addEventListener('resize', render);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', render);
    };
  }, [recognition.projections]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input,textarea')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        store.redo();
      }
      if (event.key.toLowerCase() === 'p')
        setTool((t) => ({ ...t, mode: 'pen' }));
      if (event.key.toLowerCase() === 'e')
        setTool((t) => ({ ...t, mode: 'pixel-eraser' }));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [store]);
  const exportInk = () => {
    const blob = new Blob([JSON.stringify(store.getSnapshot(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = 'calcink-notebook.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importInk = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 50e6) throw new Error('Notebook file exceeds 50 MB');
      const value = validateDocument(JSON.parse(await file.text()));
      store.replaceDocument(value);
      setNotice('Notebook imported');
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : 'Notebook could not be imported',
      );
    }
    if (fileInput.current) fileInput.current.value = '';
  };
  const offlineReady =
    offlineCached &&
    (recognition.status === 'ready' || recognition.status === 'recognizing');
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="./" aria-label="CalcInk home">
          <span className="brand-mark">
            c<span>ı</span>
          </span>
          CalcInk<span className="brand-tag">THINK ON PAPER</span>
        </a>
        <div className="header-actions">
          <span className={`offline-badge ${offlineReady ? 'ready' : ''}`}>
            <i />
            {offlineReady
              ? 'Offline ready'
              : offlineCached
                ? 'Assets cached'
                : 'On-device notebook'}
          </span>
          <button
            className="help-button"
            onClick={() => setShowHelp(!showHelp)}
          >
            How it works <span>↗</span>
          </button>
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">YOUR EVERYDAY SCRATCHPAD</p>
            <h1>
              A little ink.
              <br />A little <em>clarity.</em>
            </h1>
            <p className="intro-copy">
              Write your math. Finish with an equals sign.
              <br />
              Let the answer find its place.
            </p>
          </div>
          <div className="intro-note">
            <span className="note-spark">✳</span>
            <p>
              All the thinking happens
              <br />
              <strong>right here, on your device.</strong>
            </p>
            <span className="note-underline" />
          </div>
        </section>
        {showHelp && (
          <section className="help-panel">
            <strong>Start with a simple expression</strong>
            <p>
              Write large, separated symbols like 18 + 4 × 3 =. Put each
              equation on its own line. Recognition waits briefly after you lift
              the pen. Use the stroke eraser to remove a whole stroke or the
              pixel eraser to remove a small region. New ink is preserved. Undo
              and redo work with ⌘/Ctrl+Z. Export your notebook to share real
              handwriting samples.
            </p>
            <p>
              This recognizer is still being validated; uncertain ink shows no
              computed answer.
            </p>
          </section>
        )}
        <section className="notebook" aria-label="Handwritten math notebook">
          <div className="notebook-toolbar">
            <div className="tool-group" role="group" aria-label="Drawing tools">
              {(['pen', 'stroke-eraser', 'pixel-eraser'] as const).map(
                (mode, i) => (
                  <button
                    key={mode}
                    className={`tool-button ${tool.mode === mode ? 'selected' : ''}`}
                    aria-label={['Pen', 'Stroke eraser', 'Pixel eraser'][i]}
                    title={['Pen (P)', 'Stroke eraser', 'Pixel eraser (E)'][i]}
                    aria-pressed={tool.mode === mode}
                    onClick={() => setTool({ ...tool, mode })}
                  >
                    <Icon name={['pen', 'erase', 'pixel'][i]} />
                    <span>{['Pen', 'Stroke', 'Pixel'][i]}</span>
                  </button>
                ),
              )}
              <span className="divider" />
              <label className="width-control">
                <span>Width</span>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={tool.width}
                  onChange={(e) =>
                    setTool({ ...tool, width: Number(e.target.value) })
                  }
                  aria-label="Stroke width"
                />
                <span className="width-value">{tool.width}</span>
              </label>
            </div>
            <div className="tool-group">
              <button
                className="icon-button"
                title="Undo"
                aria-label="Undo"
                disabled={!store.canUndo}
                onClick={() => store.undo()}
              >
                <Icon name="undo" />
              </button>
              <button
                className="icon-button"
                title="Redo"
                aria-label="Redo"
                disabled={!store.canRedo}
                onClick={() => store.redo()}
              >
                <Icon name="redo" />
              </button>
              <span className="divider" />
              <button
                className="clear-button"
                onClick={() => store.clear()}
                disabled={!document.strokes.length}
              >
                <Icon name="clear" />
                <span>Clear</span>
              </button>
            </div>
          </div>
          <div className={`paper ${tool.mode}`}>
            <div className="paper-label">
              <span>01</span> UNTITLED NOTEBOOK
            </div>
            {!document.strokes.length && (
              <div className="empty-hint">
                <span className="hint-arrow">↙</span>
                <p>Your next thought starts here.</p>
                <span>Pick up your mouse, stylus, or finger.</span>
              </div>
            )}
            <canvas ref={committed} className="ink-layer" aria-hidden="true" />
            <canvas
              ref={projection}
              className="projection-layer"
              aria-hidden="true"
            />
            <canvas
              ref={active}
              className="active-layer"
              aria-label="Drawing canvas"
              role="img"
              tabIndex={0}
            />
            {!loaded && (
              <div className="loading-paper">Opening your notebook…</div>
            )}
            <div className="paper-corner">MADE FOR YOUR TRAIN OF THOUGHT</div>
          </div>
          <div className="notebook-footer">
            <div className="recognition-status" role="status">
              <i className={recognition.status} />
              <span>{recognition.message}</span>
              {recognition.status === 'error' && (
                <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
              )}
            </div>
            <span className="saved-status">{saveStatus}</span>
          </div>
        </section>
        <section className="below-paper">
          <div className="tip">
            <span>↳</span>
            <p>
              A small tip: leave a little space between symbols.
              <br />
              <span>
                Decimals, negative numbers, and the four basic operations are
                welcome.
              </span>
            </p>
          </div>
          <div className="file-actions">
            <button onClick={exportInk} disabled={!loaded}>
              <Icon name="download" />
              Export ink
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={!loaded}
            >
              <Icon name="upload" />
              Import ink
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                void importInk(e.target.files?.[0]);
              }}
            />
          </div>
        </section>
        {notice && (
          <p className="notice" role="status">
            {notice}
            <button
              onClick={() => setNotice('')}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </p>
        )}
        <div className="recognized-lines" aria-live="polite">
          {recognition.projections.map((p) => (
            <span key={p.equationId}>
              {p.expression}{' '}
              {p.answerText ??
                (p.status === 'uncertain'
                  ? 'Uncertain handwriting'
                  : p.status === 'invalid'
                    ? 'Invalid expression'
                    : '')}
            </span>
          ))}
        </div>
        {debug && (
          <pre className="debug-panel">
            {JSON.stringify(
              {
                strokes: document.strokes.length,
                revision: document.revision,
                queued: recognition.queued,
                lastRecognitionMs: recognition.inferenceMs,
                frameMetrics,
                dpr: devicePixelRatio,
                browser: navigator.userAgent,
              },
              null,
              2,
            )}
          </pre>
        )}
        <footer className="page-footer">
          <span>Quiet tools for curious minds.</span>
          <span>YOUR INK. YOUR DEVICE. YOUR SPACE.</span>
        </footer>
      </main>
    </div>
  );
}
