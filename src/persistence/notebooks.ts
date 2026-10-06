import { openNotebookStorage, validateDocument } from './document';
import type { InkDocument } from '../shared/types';
export interface NotebookRecord {
  id: string;
  name: string;
  document: InkDocument;
}
export interface NotebookLibrary {
  list(): Promise<NotebookRecord[]>;
  active(): Promise<string | undefined>;
  save(record: NotebookRecord, activate?: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  close(): void;
}
/** Separate collection preserves the original V1 database and recovery source. */
export async function openNotebookLibrary(): Promise<NotebookLibrary> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('calcink-notebooks-v2', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('notebooks');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(new Error('Close other notebook tabs to open storage'));
  });
  db.onversionchange = () => db.close();
  let tail: Promise<void> = Promise.resolve();
  const read = async <T>(
    run: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      const tx = db.transaction('notebooks', 'readonly'),
        r = run(tx.objectStore('notebooks'));
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Read aborted'));
    });
  const write = (run: (s: IDBObjectStore) => void) => {
    const next = tail
      .catch(() => {})
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction('notebooks', 'readwrite');
            run(tx.objectStore('notebooks'));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error('Save aborted'));
          }),
      );
    tail = next;
    return next;
  };
  return {
    async list() {
      const rows = (await read((s) => s.getAll())) as unknown[];
      return rows
        .filter(
          (r): r is NotebookRecord =>
            !!r && typeof r === 'object' && 'document' in r,
        )
        .map((r) => {
          if (
            typeof r.id !== 'string' ||
            !r.id ||
            typeof r.name !== 'string' ||
            !r.name.trim() ||
            r.name.length > 120
          )
            throw new Error('Invalid notebook metadata');
          return {
            id: r.id,
            name: r.name,
            document: validateDocument(r.document),
          };
        });
    },
    async active() {
      const id = await read((s) => s.get('active'));
      return typeof id === 'string' ? id : undefined;
    },
    save(record, activate = false) {
      if (!record.id || !record.name.trim() || record.name.length > 120)
        return Promise.reject(new Error('Invalid notebook name'));
      // Snapshot is immutable; serialize/validate once at a committed, coalesced save.
      const copy = {
        id: record.id,
        name: record.name.trim(),
        document: validateDocument(record.document),
      };
      return write((s) => {
        s.put(copy, `notebook:${record.id}`);
        if (activate) s.put(record.id, 'active');
      });
    },
    remove(id) {
      return write((s) => {
        s.delete(`notebook:${id}`);
      });
    },
    close() {
      void tail.finally(() => db.close()).catch(() => {});
    },
  };
}
export async function loadLegacyNotebook(): Promise<InkDocument | undefined> {
  const storage = await openNotebookStorage();
  try {
    return await storage.load();
  } finally {
    storage.close();
  }
}
