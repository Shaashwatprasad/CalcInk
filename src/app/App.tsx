import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { mountObjects } from '../render/mountObjects';
import type { ObjectsTool, ObjectsRenderer } from '../render/mountObjects';
import type { Annotation, Selection, XY } from '../shared/types';
import { annotationBounds } from '../document/annotations';
import { ViewportStore } from '../viewport';
import { InkStore } from '../document/InkStore';
import { mountInk } from '../render/mountInk';
import { mountProjection } from '../render/mountProjection';
import type { ProjectionRenderer } from '../render/mountProjection';
import type { InkTool } from '../render/mountInk';
import { NotebookControls } from './NotebookControls';
import { validateDocument } from '../persistence/document';
import { prepareOffline } from '../offline/register';
import { startRecognizer } from './recognizer';
import type { RecognitionState } from './recognizer';
import { CalculationHistory } from '../projection/history';
import { monitorFrames } from '../metrics/frames';
import type { FrameMetrics } from '../metrics/frames';
import { resolveInkColor } from '../ink/geometry';
import {
  DrawingOptions,
  EraserOptions,
  PaperOptions,
  defaultPaper,
  paperStyle,
} from './ToolOptions';
import type { PaperSettings } from './ToolOptions';

function Icon({ name }: { name: string }) {
  const assets: Record<string, string> = {
    pen: 'pen',
    erase: 'eraser',
    undo: 'undo',
    redo: 'redo',
    hand: 'hand',
    theme: 'theme',
    more: 'more',
    select: 'select',
    lasso: 'lasso',
    text: 'text',
    shape: 'shapes',
    region: 'region',
    arrow: 'arrow',
    help: 'help',
  };
  const asset = assets[name];
  if (asset)
    return (
      <span
        className="figma-icon"
        aria-hidden="true"
        style={{
          maskImage: `url(${import.meta.env.BASE_URL}icons/${asset}.svg)`,
          WebkitMaskImage: `url(${import.meta.env.BASE_URL}icons/${asset}.svg)`,
        }}
      />
    );
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
      strokeWidth="1.65"
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
  const [viewport] = useState(() => new ViewportStore());
  const camera = useSyncExternalStore(viewport.subscribe, viewport.getSnapshot);
  const [panMode, setPanMode] = useState<'free' | 'vertical'>('free');
  const panModeRef = useRef(panMode);
  panModeRef.current = panMode;
  const [document, setDocument] = useState(() => store.getSnapshot());
  const [tool, setTool] = useState<InkTool>({
    mode: 'pen',
    width: 3,
    color: '#252d38',
    eraserRadius: 12,
    kind: 'pen',
    colorMode: 'auto',
    opacity: 1,
    pressureEnabled: false,
    recognitionEligible: true,
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('calcink-theme') === 'dark'
        ? 'dark'
        : 'light';
    } catch {
      return 'light';
    }
  });
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [paper, setPaper] = useState<PaperSettings>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem('calcink-paper') ?? 'null',
      ) as PaperSettings | null;
      return value &&
        ['None', 'Dots', 'Grid', 'Ruled', 'Ruled wide'].includes(
          value.pattern,
        ) &&
        Number.isFinite(value.spacing) &&
        value.spacing >= 12 &&
        value.spacing <= 40 &&
        Number.isFinite(value.intensity) &&
        value.intensity >= 0.05 &&
        value.intensity <= 0.4 &&
        typeof value.infinite === 'boolean'
        ? value
        : defaultPaper;
    } catch {
      return defaultPaper;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('calcink-paper', JSON.stringify(paper));
    } catch {
      /* Keep the chosen view usable. */
    }
  }, [paper]);
  const [optionPanel, setOptionPanel] = useState<
    'drawing' | 'eraser' | 'hand' | 'paper' | 'object'
  >();
  const options = useRef<HTMLDivElement>(null);
  const optionTrigger = useRef<HTMLButtonElement | null>(null);
  const [objectMode, setObjectMode] = useState<ObjectsTool['mode']>('inactive');
  const [objectSettings, setObjectSettings] = useState({
    shape: 'rectangle' as 'rectangle' | 'ellipse' | 'line',
    color: '#252D38',
    colorMode: 'auto' as 'auto' | 'explicit',
    strokeWidth: 2,
    fontSize: 20,
  });
  const objectToolRef = useRef<ObjectsTool>({
    ...objectSettings,
    mode: objectMode,
  });
  objectToolRef.current = { ...objectSettings, mode: objectMode };
  const objectsCanvas = useRef<HTMLCanvasElement>(null);
  const objectRenderer = useRef<ObjectsRenderer | undefined>(undefined);
  const [selection, setSelection] = useState<Selection>({
    strokeIds: [],
    objectIds: [],
  });
  const [textEditor, setTextEditor] = useState<{
    point: XY;
    existing?: Extract<Annotation, { kind: 'text' }>;
    text: string;
    math: boolean;
  }>();
  const [allTools, setAllTools] = useState(false);
  const [showResults, setShowResults] = useState(true);
  const showResultsRef = useRef(showResults);
  showResultsRef.current = showResults;
  const recognizer = useRef<ReturnType<typeof startRecognizer> | undefined>(
    undefined,
  );
  const [confirmClear, setConfirmClear] = useState(false);
  const clearTrigger = useRef<HTMLButtonElement>(null);
  const cancelClear = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    window.document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('calcink-theme', theme);
    } catch {
      /* Appearance still works without storage. */
    }
    window.dispatchEvent(new Event('calcink-appearance'));
    projectionRenderer.current?.invalidate();
  }, [theme]);
  useEffect(() => {
    if (!allTools) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element)?.closest?.('.notebook-toolbar'))
        setAllTools(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAllTools(false);
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape);
    };
  }, [allTools]);
  useEffect(() => {
    if (!optionPanel) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !options.current?.contains(target) &&
        !optionTrigger.current?.contains(target)
      )
        setOptionPanel(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOptionPanel(undefined);
        optionTrigger.current?.focus();
      }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape);
    };
  }, [optionPanel]);
  useEffect(() => {
    if (confirmClear) cancelClear.current?.focus();
    return () => {
      if (confirmClear) clearTrigger.current?.focus();
    };
  }, [confirmClear]);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const committed = useRef<HTMLCanvasElement>(null);
  const active = useRef<HTMLCanvasElement>(null);
  const projection = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    const resize = () => {
      const rect = active.current?.getBoundingClientRect();
      if (rect) {
        if (paper.infinite) viewport.setFinitePage();
        else if (viewport.getFinitePage()) viewport.resizeFinitePage(rect);
        else viewport.setFinitePage(rect);
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [loaded, paper.infinite, viewport]);
  const [notebookBusy, setNotebookBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Opening notebook…');
  const [recognition, setRecognition] = useState(initialState);
  const [calculationHistory] = useState(() => new CalculationHistory());
  const calculations = calculationHistory.update(
    document.documentId,
    recognition.projections,
  );
  const [feedbackTab, setFeedbackTab] = useState<'current' | 'history'>(
    'current',
  );
  const [historyLimit, setHistoryLimit] = useState(5);
  useEffect(() => {
    setHistoryLimit(5);
    setFeedbackTab('current');
  }, [document.documentId]);
  const [retry, setRetry] = useState(0);
  const projectionsRef = useRef(recognition.projections);
  projectionsRef.current = recognition.projections;
  const projectionRenderer = useRef<ProjectionRenderer | undefined>(undefined);
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
    if (!loaded || !committed.current || !active.current) return;
    try {
      return mountInk(
        committed.current,
        active.current,
        store,
        () => toolRef.current,
        {
          viewport,
          getPanMode: () => panModeRef.current,
          onInputError: setNotice,
          getInkColor: (stroke) => resolveInkColor(stroke, themeRef.current),
        },
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Drawing could not start');
    }
  }, [store, loaded, viewport]);
  useEffect(() => {
    if (!loaded) return;
    try {
      const controller = startRecognizer(store, setRecognition);
      recognizer.current = controller;
      return () => {
        controller();
        recognizer.current = undefined;
      };
    } catch (e) {
      setRecognition({
        ...initialState,
        status: 'error',
        message: e instanceof Error ? e.message : 'Recognition unavailable',
      });
    }
  }, [store, loaded, retry]);
  useEffect(() => {
    if (!loaded || !objectsCanvas.current) return;
    try {
      const renderer = mountObjects({
        canvas: objectsCanvas.current,
        store,
        viewport,
        getTool: () => objectToolRef.current,
        getTheme: () => themeRef.current,
        getPanMode: () => panModeRef.current,
        onSelection: setSelection,
        onText: (point, existing) =>
          setTextEditor({
            point,
            existing,
            text: existing?.text ?? '',
            math: existing?.math ?? false,
          }),
        onError: setNotice,
      });
      objectRenderer.current = renderer;
      return () => {
        renderer.dispose();
        objectRenderer.current = undefined;
      };
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Annotations could not start',
      );
    }
  }, [store, viewport, loaded]);
  useEffect(() => {
    objectRenderer.current?.invalidate();
  }, [objectMode, objectSettings, theme]);
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
    try {
      const renderer = mountProjection(
        canvas,
        () => (showResultsRef.current ? projectionsRef.current : []),
        viewport,
        () => (themeRef.current === 'dark' ? '#82D8B6' : '#5275AE'),
      );
      projectionRenderer.current = renderer;
      return () => {
        renderer.dispose();
        projectionRenderer.current = undefined;
      };
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Feedback could not start',
      );
    }
  }, [viewport]);
  useEffect(() => {
    projectionRenderer.current?.invalidate();
  }, [recognition.projections, showResults]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (window.document.querySelector('[aria-modal="true"]')) return;
      if (
        (event.target as HTMLElement)?.closest?.(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        store.redo();
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === 'p') {
        setObjectMode('inactive');
        setAllTools(false);
        setOptionPanel(undefined);
        setTool((t) => {
          if (t.mode === 'pen') drawingSettings.current[t.kind ?? 'pen'] = t;
          const saved = drawingSettings.current.pen;
          return saved
            ? { ...saved, mode: 'pen', eraserRadius: t.eraserRadius }
            : {
                ...t,
                mode: 'pen',
                kind: 'pen',
                color: '#252D38',
                colorMode: 'auto',
                opacity: 1,
                recognitionEligible: true,
                pressureEnabled: false,
                width: 3,
              };
        });
      }
      if (event.key.toLowerCase() === 'e') {
        setObjectMode('inactive');
        setAllTools(false);
        setOptionPanel(undefined);
        setTool((t) => {
          if (t.mode === 'pen') drawingSettings.current[t.kind ?? 'pen'] = t;
          return { ...t, mode: 'pixel-eraser' };
        });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [store]);
  const center = () => {
    const rect = active.current?.getBoundingClientRect();
    return { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
  };
  const zoom = (factor: number) => viewport.zoomAt(factor, center());
  const fit = () => {
    const rect = active.current?.getBoundingClientRect();
    const bounds = [
      ...document.strokes.map((s) => s.bounds),
      ...(document.objects ?? []).map(annotationBounds),
    ];
    if (!rect || !bounds.length) return;
    viewport.fitContent(
      {
        minX: Math.min(...bounds.map((b) => b.minX)),
        minY: Math.min(...bounds.map((b) => b.minY)),
        maxX: Math.max(...bounds.map((b) => b.maxX)),
        maxY: Math.max(...bounds.map((b) => b.maxY)),
      },
      rect,
    );
  };
  const changePaper = (next: PaperSettings) => {
    const rect = active.current?.getBoundingClientRect();
    if (rect && !viewport.setFinitePage(next.infinite ? undefined : rect))
      return;
    setPaper(next);
  };
  const drawingSettings = useRef<Record<string, InkTool>>({});
  const chooseDrawing = (
    kind: 'pen' | 'pencil' | 'highlighter',
    trigger: HTMLButtonElement,
  ) => {
    setObjectMode('inactive');
    setAllTools(false);
    if (tool.mode === 'pen') drawingSettings.current[tool.kind ?? 'pen'] = tool;
    const next = drawingSettings.current[kind] ?? {
      ...tool,
      mode: 'pen' as const,
      kind,
      width: kind === 'highlighter' ? 12 : 3,
      color: kind === 'highlighter' ? '#FFE66B' : '#252D38',
      colorMode:
        kind === 'highlighter' ? ('explicit' as const) : ('auto' as const),
      opacity: kind === 'highlighter' ? 0.3 : 1,
      pressureEnabled: false,
      recognitionEligible: kind !== 'highlighter',
    };
    setTool({ ...next, eraserRadius: tool.eraserRadius });
    optionTrigger.current = trigger;
    setOptionPanel(
      optionPanel === 'drawing' && tool.mode === 'pen' && tool.kind === kind
        ? undefined
        : 'drawing',
    );
    active.current?.focus({ preventScroll: true });
  };
  const chooseObject = (
    mode: ObjectsTool['mode'],
    trigger: HTMLButtonElement,
  ) => {
    if (tool.mode === 'pen') drawingSettings.current[tool.kind ?? 'pen'] = tool;
    setObjectMode(mode);
    setAllTools(false);
    optionTrigger.current = trigger;
    setOptionPanel(
      mode === 'select' || mode === 'lasso' ? undefined : 'object',
    );
    objectsCanvas.current?.focus({ preventScroll: true });
  };
  const finishText = () => {
    if (!textEditor) return;
    const text = textEditor.text.trim();
    if (text) {
      const object: Extract<Annotation, { kind: 'text' }> = textEditor.existing
        ? { ...textEditor.existing, text, math: textEditor.math }
        : {
            id: crypto.randomUUID(),
            kind: 'text',
            recognitionEligible: false,
            opacity: 1,
            ...objectSettings,
            x: textEditor.point.x,
            y: textEditor.point.y,
            text,
            math: textEditor.math,
          };
      try {
        if (textEditor.existing) store.updateObject(object.id, object);
        else store.addObject(object);
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : 'Text could not be saved',
        );
        return;
      }
    } else if (textEditor.existing) {
      store.deleteSelection({
        strokeIds: [],
        objectIds: [textEditor.existing.id],
      });
    }
    setTextEditor(undefined);
    objectsCanvas.current?.focus({ preventScroll: true });
  };
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
    <div className="app-shell" data-theme={theme}>
      <header
        className="topbar"
        inert={confirmClear || !!textEditor || notebookBusy}
      >
        <a className="brand" href="./" aria-label="CalcInk home">
          <span className="brand-mark">
            c<span>ı</span>
          </span>
          CalcInk<span className="brand-tag">THINK ON PAPER</span>
        </a>
        <NotebookControls
          store={store}
          onStatus={setSaveStatus}
          onNotice={setNotice}
          onReady={() => setLoaded(true)}
          onBusy={setNotebookBusy}
        />
        <div className="header-actions">
          <button
            className="icon-button"
            title="Undo (⌘/Ctrl+Z)"
            aria-label="Undo"
            disabled={!store.canUndo}
            onClick={() => store.undo()}
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-button"
            title="Redo (⌘/Ctrl+Shift+Z)"
            aria-label="Redo"
            disabled={!store.canRedo}
            onClick={() => store.redo()}
          >
            <Icon name="redo" />
          </button>
          <button
            className="icon-button"
            ref={clearTrigger}
            title="Clear paper"
            aria-label="Clear"
            disabled={!document.strokes.length && !document.objects?.length}
            onClick={() => {
              setOptionPanel(undefined);
              setConfirmClear(true);
            }}
          >
            <Icon name="clear" />
          </button>
          <button
            className="icon-button"
            aria-label="Theme"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            <Icon name="theme" />
          </button>
          <button
            className="zoom-pill"
            aria-label="100%"
            onClick={() => viewport.setZoom100At(center())}
          >
            {Math.round(camera.zoom * 100)}%
          </button>
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
      <main inert={confirmClear || !!textEditor || notebookBusy}>
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
              Supported handwriting: 0–9, +, −, ×, ÷, . and =. Variable x uses
              crossing geometry and explicit correction; other letters are not
              supported by this model.
            </p>
            <p>
              This recognizer is still being validated; uncertain ink shows no
              computed answer.
            </p>
          </section>
        )}
        <section className="notebook" aria-label="Handwritten math notebook">
          <div
            className={`notebook-toolbar ${allTools ? 'tools-expanded' : ''}`}
            role={allTools ? 'dialog' : undefined}
            aria-label={allTools ? 'All tools' : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAllTools(false);
            }}
          >
            <div className="tool-group" role="group" aria-label="Drawing tools">
              {(['select', 'lasso'] as const).map((mode) => (
                <button
                  key={mode}
                  className={`tool-button extended-tool ${objectMode === mode ? 'selected' : ''}`}
                  title={
                    mode === 'select'
                      ? 'Select and move objects'
                      : 'Lasso: encircle, then drag or resize'
                  }
                  aria-label={mode === 'select' ? 'Select' : 'Lasso'}
                  aria-pressed={objectMode === mode}
                  onClick={(e) => chooseObject(mode, e.currentTarget)}
                >
                  <Icon name={mode} />
                </button>
              ))}
              <span className="divider" />
              <button
                className={`tool-button ${objectMode === 'inactive' && tool.mode === 'pen' ? 'selected' : ''}`}
                aria-label="Pen"
                title="Pen (P)"
                aria-pressed={objectMode === 'inactive' && tool.mode === 'pen'}
                onClick={(e) => chooseDrawing('pen', e.currentTarget)}
              >
                <Icon name="pen" />
              </button>
              <button
                className={`tool-button ${objectMode === 'inactive' && tool.mode.endsWith('eraser') ? 'selected' : ''}`}
                title="Eraser (E): whole stroke or partial"
                aria-label="Eraser"
                aria-pressed={
                  objectMode === 'inactive' && tool.mode.endsWith('eraser')
                }
                onClick={(e) => {
                  if (tool.mode === 'pen')
                    drawingSettings.current[tool.kind ?? 'pen'] = tool;
                  setObjectMode('inactive');
                  setTool({
                    ...tool,
                    mode: tool.mode.endsWith('eraser')
                      ? tool.mode
                      : 'pixel-eraser',
                  });
                  optionTrigger.current = e.currentTarget;
                  setOptionPanel(
                    optionPanel === 'eraser' ? undefined : 'eraser',
                  );
                  setAllTools(false);
                  active.current?.focus({ preventScroll: true });
                }}
              >
                <Icon name="erase" />
              </button>
              {(['text', 'shape', 'region', 'arrow'] as const).map((mode) => (
                <button
                  key={mode}
                  className={`tool-button extended-tool ${objectMode === mode ? 'selected' : ''}`}
                  aria-label={
                    {
                      text: 'Text',
                      shape: 'Shapes',
                      region: 'Draw region',
                      arrow: 'Arrow',
                    }[mode]
                  }
                  aria-pressed={objectMode === mode}
                  onClick={(e) => chooseObject(mode, e.currentTarget)}
                >
                  <Icon name={mode} />
                </button>
              ))}
              <span className="divider" />
              <button
                className={`tool-button hand-tool ${objectMode === 'inactive' && tool.mode === 'hand' ? 'selected' : ''}`}
                aria-label="Hand"
                aria-pressed={objectMode === 'inactive' && tool.mode === 'hand'}
                onClick={(e) => {
                  if (tool.mode === 'pen')
                    drawingSettings.current[tool.kind ?? 'pen'] = tool;
                  setObjectMode('inactive');
                  setTool({ ...tool, mode: 'hand' });
                  optionTrigger.current = e.currentTarget;
                  setOptionPanel(optionPanel === 'hand' ? undefined : 'hand');
                  setAllTools(false);
                  active.current?.focus({ preventScroll: true });
                }}
                title="Hand · hold Space to pan"
              >
                <Icon name="hand" />
              </button>
              <button
                className="tool-button extended-tool"
                aria-label="Canvas settings"
                aria-expanded={optionPanel === 'paper'}
                onClick={(e) => {
                  optionTrigger.current = e.currentTarget;
                  setOptionPanel(optionPanel === 'paper' ? undefined : 'paper');
                  setAllTools(false);
                }}
              >
                <Icon name="more" />
              </button>
              <button
                className="tool-button extended-tool"
                aria-label="Help"
                onClick={() => {
                  setShowHelp(!showHelp);
                  setAllTools(false);
                }}
              >
                <Icon name="help" />
              </button>
              <button
                className="tool-button all-tools-toggle"
                aria-label="All tools"
                aria-expanded={allTools}
                onClick={() => {
                  setAllTools(!allTools);
                  setOptionPanel(undefined);
                }}
              >
                <Icon name="more" />
              </button>
            </div>
          </div>
          {optionPanel && (
            <div
              ref={options}
              className={`tool-options ${optionPanel}-options`}
              role="dialog"
              aria-label={
                optionPanel === 'drawing'
                  ? 'Pen options'
                  : optionPanel === 'eraser'
                    ? 'Eraser options'
                    : optionPanel === 'object'
                      ? 'Annotation options'
                      : optionPanel === 'paper'
                        ? 'Canvas settings'
                        : 'Hand options'
              }
            >
              {optionPanel === 'drawing' && (
                <DrawingOptions
                  tool={tool}
                  onChange={(next) => {
                    if (next.kind !== tool.kind) {
                      drawingSettings.current[tool.kind ?? 'pen'] = tool;
                      setTool({
                        ...(drawingSettings.current[next.kind ?? 'pen'] ??
                          next),
                        eraserRadius: tool.eraserRadius,
                      });
                    } else setTool(next);
                  }}
                />
              )}
              {optionPanel === 'eraser' && (
                <EraserOptions tool={tool} onChange={setTool} />
              )}
              {optionPanel === 'paper' && (
                <PaperOptions paper={paper} onChange={changePaper} />
              )}
              {optionPanel === 'object' && (
                <>
                  {objectMode === 'shape' &&
                    (['rectangle', 'ellipse', 'line'] as const).map((shape) => (
                      <button
                        key={shape}
                        aria-pressed={objectSettings.shape === shape}
                        onClick={() =>
                          setObjectSettings({ ...objectSettings, shape })
                        }
                      >
                        {shape[0].toUpperCase() + shape.slice(1)}
                      </button>
                    ))}
                  <label>
                    Colour{' '}
                    <select
                      aria-label="Annotation colour"
                      value={
                        objectSettings.colorMode === 'auto'
                          ? 'auto'
                          : objectSettings.color
                      }
                      onChange={(e) =>
                        setObjectSettings({
                          ...objectSettings,
                          colorMode:
                            e.target.value === 'auto' ? 'auto' : 'explicit',
                          color:
                            e.target.value === 'auto'
                              ? '#252D38'
                              : e.target.value,
                        })
                      }
                    >
                      <option value="auto">Auto</option>
                      <option value="#252D38">Black</option>
                      <option value="#E4E7EB">Soft white</option>
                      <option value="#5275AE">Blue</option>
                      <option value="#BD485D">Red</option>
                    </select>
                  </label>
                  <label>
                    Width{' '}
                    <input
                      aria-label="Annotation width"
                      type="range"
                      min="1"
                      max="8"
                      value={objectSettings.strokeWidth}
                      onChange={(e) =>
                        setObjectSettings({
                          ...objectSettings,
                          strokeWidth: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  {objectMode === 'text' && (
                    <label>
                      Text size{' '}
                      <input
                        aria-label="Text size"
                        type="range"
                        min="12"
                        max="48"
                        value={objectSettings.fontSize}
                        onChange={(e) =>
                          setObjectSettings({
                            ...objectSettings,
                            fontSize: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  )}
                  {objectMode === 'region' && (
                    <span>Draw a dashed boundary around a working area.</span>
                  )}
                </>
              )}
              {optionPanel === 'hand' && (
                <>
                  <label>
                    <input
                      type="radio"
                      name="pan-mode"
                      checked={panMode === 'free'}
                      onChange={() => setPanMode('free')}
                    />
                    Free pan
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="pan-mode"
                      checked={panMode === 'vertical'}
                      onChange={() => setPanMode('vertical')}
                    />
                    Vertical scroll
                  </label>
                  <button aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
                    −
                  </button>
                  <button aria-label="Zoom in" onClick={() => zoom(1.2)}>
                    +
                  </button>
                  <button onClick={() => viewport.reset()}>Reset view</button>
                  <button
                    disabled={
                      !document.strokes.length && !document.objects?.length
                    }
                    onClick={fit}
                  >
                    Fit content
                  </button>
                </>
              )}
            </div>
          )}
          <div
            className={`paper ${tool.mode}`}
            style={{
              backgroundPosition: `${camera.offsetX}px ${camera.offsetY}px`,
              ...paperStyle(paper, camera.zoom),
            }}
          >
            {!document.strokes.length && !document.objects?.length && (
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
            <canvas
              ref={objectsCanvas}
              className="objects-layer"
              aria-label="Annotation canvas"
              role="img"
              tabIndex={objectMode === 'inactive' ? -1 : 0}
              style={{
                pointerEvents: objectMode === 'inactive' ? 'none' : 'auto',
              }}
            />
            {selection.strokeIds.length + selection.objectIds.length > 0 &&
              (objectMode === 'select' || objectMode === 'lasso') && (
                <div className="selection-actions">
                  {selection.objectIds.length === 1 &&
                    !selection.strokeIds.length &&
                    document.objects?.some(
                      (o) =>
                        o.id === selection.objectIds[0] && o.kind === 'text',
                    ) && (
                      <button
                        aria-label="Edit text"
                        onClick={() => objectRenderer.current?.editSelection()}
                      >
                        Edit
                      </button>
                    )}
                  <button
                    aria-label="Duplicate selection"
                    onClick={() =>
                      objectRenderer.current?.setSelection(
                        store.duplicateSelection(selection),
                      )
                    }
                  >
                    Duplicate
                  </button>
                  <button
                    aria-label="Delete selection"
                    onClick={() => {
                      store.deleteSelection(selection);
                      objectRenderer.current?.setSelection({
                        strokeIds: [],
                        objectIds: [],
                      });
                    }}
                  >
                    Delete
                  </button>
                  <span>Drag to move · corner to resize</span>
                </div>
              )}
            {!loaded && (
              <div className="loading-paper">Opening your notebook…</div>
            )}
            <div className="paper-corner">MADE FOR YOUR TRAIN OF THOUGHT</div>
          </div>
          <div className="notebook-footer">
            <div className="recognition-status" role="status">
              <i className={recognition.status} />
              <span>{recognition.message}</span>
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
        {(recognition.projections.length > 0 ||
          recognition.status === 'recognizing' ||
          recognition.status === 'error') && (
          <section
            className="recognition-feedback"
            aria-label="Recognition feedback"
          >
            <div
              className="calculation-tabs"
              role="tablist"
              aria-label="Calculations"
            >
              <button
                role="tab"
                aria-selected={feedbackTab === 'current'}
                onClick={() => setFeedbackTab('current')}
              >
                Current
              </button>
              <button
                role="tab"
                aria-selected={feedbackTab === 'history'}
                onClick={() => setFeedbackTab('history')}
              >
                History ({calculations.records.length})
              </button>
            </div>
            {feedbackTab === 'history' && (
              <div
                className="calculation-history"
                role="tabpanel"
                aria-label="Calculation history"
              >
                {calculations.records.slice(0, historyLimit).map((record) => (
                  <div key={record.id} data-record-id={record.id}>
                    <span>{record.expression}</span>{' '}
                    <strong>{record.answer}</strong>
                  </div>
                ))}
                {!calculations.records.length && (
                  <span>No completed calculations.</span>
                )}
                {calculations.records.length > historyLimit && (
                  <button onClick={() => setHistoryLimit((n) => n + 5)}>
                    Show older calculations
                  </button>
                )}
              </div>
            )}
            <div
              className="recognized-lines"
              aria-live="polite"
              hidden={feedbackTab !== 'current'}
            >
              {(calculations.current ? [calculations.current] : []).map((p) => (
                <div key={p.equationId} data-state={p.status}>
                  <span className="recognized-expression">
                    {p.expression || 'No visible symbols'}
                  </span>{' '}
                  <span>
                    {p.answerText ??
                      (p.status === 'variable-defined'
                        ? 'Defined in this notebook'
                        : p.status === 'unbound'
                          ? `${p.outcome?.status === 'unbound' ? p.outcome.name : 'Variable'} is not defined in this notebook`
                          : p.status === 'uncertain'
                            ? 'Uncertain handwriting · rewrite or choose a crossing'
                            : p.status === 'invalid'
                              ? 'Invalid syntax · check the expression'
                              : p.status === 'undefined'
                                ? p.evaluation?.status === 'undefined'
                                  ? p.evaluation.display
                                  : 'Undefined arithmetic'
                                : p.status === 'pending'
                                  ? 'Recognizing…'
                                  : p.status === 'error' ||
                                      p.status === 'unavailable'
                                    ? 'Recognition unavailable · retry'
                                    : 'Incomplete · finish the expression with =')}
                  </span>
                  {(p.symbols ?? []).map(
                    (symbol, index) =>
                      ['×', 'x'].includes(symbol.label) && (
                        <div className="correction-actions" key={index}>
                          {(p.symbols ?? []).filter((s) =>
                            ['×', 'x'].includes(s.label),
                          ).length > 1 && <small>Crossing {index + 1}</small>}
                          <button
                            onClick={() =>
                              recognizer.current?.correct(
                                p.equationId,
                                'x',
                                index,
                              )
                            }
                          >
                            Variable x
                          </button>
                          <button
                            onClick={() =>
                              recognizer.current?.correct(
                                p.equationId,
                                '×',
                                index,
                              )
                            }
                          >
                            Multiply ×
                          </button>
                        </div>
                      ),
                  )}
                </div>
              ))}
              {!recognition.projections.length && (
                <span>
                  {recognition.status === 'error'
                    ? 'Recognition unavailable · your ink is safe'
                    : 'Recognizing…'}
                </span>
              )}
            </div>
            <div className="feedback-actions">
              <label>
                <input
                  type="checkbox"
                  checked={showResults}
                  onChange={(e) => setShowResults(e.target.checked)}
                />
                Show results
              </label>
              <button
                disabled={!recognition.projections.length}
                aria-label="Copy expression"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(calculations.current?.expression ?? '')
                    .catch(() => setNotice('Clipboard unavailable'));
                }}
              >
                Copy expression
              </button>
              <button
                disabled={!calculations.current?.answerText}
                aria-label="Copy answer"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(calculations.current?.answerText ?? '')
                    .catch(() => setNotice('Clipboard unavailable'));
                }}
              >
                Copy answer
              </button>
              {recognition.status === 'error' && (
                <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
              )}
            </div>
          </section>
        )}
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
      {textEditor && (
        <div className="modal-backdrop">
          <form
            className="clear-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Edit text"
            onSubmit={(e) => {
              e.preventDefault();
              finishText();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                const nodes = [
                  ...e.currentTarget.querySelectorAll<HTMLElement>(
                    'textarea,input,button',
                  ),
                ];
                const i = nodes.indexOf(
                  window.document.activeElement as HTMLElement,
                );
                e.preventDefault();
                nodes[
                  (i + (e.shiftKey ? nodes.length - 1 : 1)) % nodes.length
                ]?.focus();
              }
              if (e.key === 'Escape') {
                setTextEditor(undefined);
                objectsCanvas.current?.focus();
              }
            }}
          >
            <label>
              Text annotation
              <textarea
                autoFocus
                aria-label="Text annotation"
                maxLength={10000}
                value={textEditor.text}
                onChange={(e) =>
                  setTextEditor({ ...textEditor, text: e.target.value })
                }
              />
            </label>
            <label className="typed-math-toggle">
              <input
                type="checkbox"
                checked={textEditor.math}
                onChange={(e) =>
                  setTextEditor({ ...textEditor, math: e.target.checked })
                }
              />
              Calculate as math
            </label>
            <p className="editor-help">
              For math, use a final = or a definition such as total=5. Ordinary
              text stays an annotation.
            </p>
            <button type="button" onClick={() => setTextEditor(undefined)}>
              Cancel
            </button>
            <button type="submit">Done</button>
          </form>
        </div>
      )}
      {confirmClear && (
        <div
          className="modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmClear(false);
              clearTrigger.current?.focus();
            }
          }}
        >
          <div
            className="clear-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Clear paper"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setConfirmClear(false);
                clearTrigger.current?.focus();
              }
              if (event.key === 'Tab') {
                event.preventDefault();
                const buttons =
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button',
                  );
                const index = [...buttons].indexOf(
                  window.document.activeElement as HTMLButtonElement,
                );
                buttons[
                  (index + (event.shiftKey ? buttons.length - 1 : 1)) %
                    buttons.length
                ]?.focus();
              }
            }}
          >
            <h2>Clear paper?</h2>
            <p>You can restore your ink with Undo.</p>
            <button
              ref={cancelClear}
              onClick={() => {
                setConfirmClear(false);
                clearTrigger.current?.focus();
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                store.clear();
                setConfirmClear(false);
                clearTrigger.current?.focus();
              }}
            >
              Clear paper
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
