import { useEffect, useRef, useState } from 'react';
import { InkStore } from '../document/InkStore';
import {
  loadLegacyNotebook,
  openNotebookLibrary,
} from '../persistence/notebooks';
import type { NotebookLibrary, NotebookRecord } from '../persistence/notebooks';
export function NotebookControls({
  store,
  onStatus,
  onNotice,
  onReady,
  onBusy,
  isDrawing,
}: {
  store: InkStore;
  onStatus: (message: string) => void;
  onNotice: (message: string) => void;
  onReady: () => void;
  onBusy: (busy: boolean) => void;
  isDrawing: () => boolean;
}) {
  const library = useRef<NotebookLibrary | undefined>(undefined),
    current = useRef<NotebookRecord | undefined>(undefined);
  const [records, setRecords] = useState<NotebookRecord[]>([]),
    [name, setName] = useState('Untitled notebook'),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef<NotebookRecord | undefined>(undefined),
    running = useRef<Promise<void> | undefined>(undefined);
  const alive = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbacks = useRef({ onStatus, onNotice, onReady, onBusy, isDrawing });
  callbacks.current = { onStatus, onNotice, onReady, onBusy, isDrawing };
  const flush = async (automatic = false) => {
    clearTimeout(timer.current);
    if (running.current) await running.current;
    const lib = library.current;
    if (!lib) return;
    const work = (async () => {
      while (pending.current) {
        // An earlier IndexedDB write may finish after the next gesture begins.
        // Recheck before each snapshot, including after waiting for a running save.
        if (automatic && callbacks.current.isDrawing()) {
          if (alive.current) scheduleSave();
          break;
        }
        const row = pending.current;
        pending.current = undefined;
        await lib.save(row, true);
        if (
          alive.current &&
          !pending.current &&
          current.current?.id === row.id &&
          store.getSnapshot().revision === row.document.revision
        )
          callbacks.current.onStatus('Saved on this device');
      }
    })();
    running.current = work;
    try {
      await work;
    } finally {
      if (running.current === work) running.current = undefined;
    }
  };
  const scheduleSave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Validation and IndexedDB snapshot copying should wait for pen-up.
      if (callbacks.current.isDrawing()) {
        scheduleSave();
        return;
      }
      void flush(true).catch(() =>
        callbacks.current.onStatus('Save failed · export your ink'),
      );
    }, 120);
  };
  const saveCurrent = () => {
    if (current.current) {
      pending.current = { ...current.current, document: store.getSnapshot() };
      callbacks.current.onStatus('Saving…');
      scheduleSave();
    }
  };
  useEffect(() => {
    alive.current = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const lib = await openNotebookLibrary();
        if (!alive.current) {
          lib.close();
          return;
        }
        library.current = lib;
        let rows = await lib.list();
        const active = await lib.active();
        let row = rows.find((r) => r.id === active) ?? rows[0];
        if (!row) {
          const old = await loadLegacyNotebook();
          row = {
            id: crypto.randomUUID(),
            name: 'Untitled notebook',
            document: old ?? store.getSnapshot(),
          };
          await lib.save(row, true);
          rows = [row];
        }
        if (!alive.current) return;
        current.current = row;
        store.replaceDocument(row.document);
        setName(row.name);
        setRecords(rows);
        callbacks.current.onStatus('Saved on this device');
        unsubscribe = store.subscribe(saveCurrent);
      } catch {
        if (alive.current)
          callbacks.current.onStatus('Storage unavailable · export your ink');
      }
      if (alive.current) callbacks.current.onReady();
    })();
    return () => {
      alive.current = false;
      unsubscribe?.();
      clearTimeout(timer.current);
      void flush()
        .catch(() => {})
        .finally(() => library.current?.close());
    };
    // One collection and subscription per stable store; callbacks are refs.
  }, [store]);
  const act = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    callbacks.current.onBusy(true);
    try {
      await operation();
    } catch (error) {
      callbacks.current.onNotice(
        error instanceof Error ? error.message : 'Notebook operation failed',
      );
    } finally {
      setBusy(false);
      callbacks.current.onBusy(false);
    }
  };
  const refresh = async () => {
    if (library.current) setRecords(await library.current.list());
  };
  const switchTo = async (row: NotebookRecord, create = false) => {
    if (!create && row.id === current.current?.id) {
      setOpen(false);
      return;
    }
    saveCurrent();
    await flush();
    if (!create) {
      const fresh = (await library.current!.list()).find(
        (r) => r.id === row.id,
      );
      if (!fresh) throw new Error('Notebook no longer exists');
      row = fresh;
    }
    await library.current!.save(row, true);
    current.current = row;
    store.replaceDocument(row.document);
    setName(row.name);
    setOpen(false);
    await refresh();
  };
  const rename = () => {
    if (!current.current || !library.current) return;
    const next = name.trim() || 'Untitled notebook';
    if (current.current.name === next) return;
    current.current = { ...current.current, name: next };
    setName(next);
    saveCurrent();
    void flush()
      .then(refresh)
      .catch(() => callbacks.current.onStatus('Save failed · export your ink'));
  };
  return (
    <div className="notebook-controls">
      <input
        aria-label="Notebook name"
        value={name}
        maxLength={120}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onBlur={rename}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            rename();
            e.currentTarget.blur();
          }
        }}
      />
      <button
        disabled={busy || !library.current}
        aria-label="New notebook"
        onClick={() =>
          void act(async () => {
            const row = {
              id: crypto.randomUUID(),
              name: 'Untitled notebook',
              document: new InkStore().getSnapshot(),
            };
            await switchTo(row, true);
          })
        }
      >
        New
      </button>
      <button
        disabled={busy || !library.current}
        aria-label="Open notebook"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Open
      </button>
      <button
        disabled={busy || !library.current || records.length < 2}
        aria-label="Delete notebook"
        onClick={() => setConfirmDelete(true)}
      >
        Delete
      </button>
      {open && (
        <div
          className="notebook-list"
          role="dialog"
          aria-label="Open notebook"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          {records.map((r) => (
            <button
              key={r.id}
              disabled={busy}
              onClick={() => void act(() => switchTo(r))}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
      {confirmDelete && (
        <div
          className="notebook-list"
          role="dialog"
          aria-label="Delete notebook"
        >
          <p>Delete this notebook? Export it first if you need a copy.</p>
          <button onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button
            onClick={() =>
              void act(async () => {
                const old = current.current!;
                const next = records.find((r) => r.id !== old.id)!;
                await switchTo(next);
                await library.current!.remove(old.id);
                setConfirmDelete(false);
                await refresh();
              })
            }
          >
            Delete notebook
          </button>
        </div>
      )}
    </div>
  );
}
