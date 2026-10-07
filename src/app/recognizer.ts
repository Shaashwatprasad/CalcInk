import { annotationBounds } from '../document/annotations';
import { EquationTracker } from '../recognition/tracker';
import { isGroupResult } from '../recognition/protocol';
import {
  isRecognitionResult,
  ProjectionStore,
  RecognitionQueue,
} from '../projection';
import type { EquationProjection } from '../projection';
import type { InkStore } from '../document/InkStore';
import type {
  Annotation,
  GroupResult,
  RecognitionJob,
  WorkerResponse,
} from '../shared/types';

export interface RecognitionState {
  status: 'loading' | 'ready' | 'recognizing' | 'error';
  message: string;
  projections: EquationProjection[];
  queued: number;
  inferenceMs: number;
}
export function startRecognizer(
  store: InkStore,
  onState: (state: RecognitionState) => void,
): (() => void) & {
  correct: (
    equationId: string,
    label: 'x' | '×',
    symbolIndex?: number,
  ) => boolean;
} {
  const worker = new Worker(
    new URL('../workers/recognition.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const projections = new ProjectionStore();
  const queue = new RecognitionQueue();
  let current = store.getSnapshot();
  projections.reset(current.documentId, current.generation);
  const known = new Map<string, number>();
  const tracker = new EquationTracker(current);
  const typedVersions = new Map<
    string,
    { object: Annotation; revision: number }
  >();
  let typedObjects: typeof current.objects;
  const syncTyped = (force = false) => {
    if (!force && typedObjects === current.objects) return;
    typedObjects = current.objects;
    const entries = (current.objects ?? []).flatMap((object) => {
      if (object.kind !== 'text' || !object.math) return [];
      const previous = typedVersions.get(object.id);
      const revision =
        previous?.object === object
          ? previous.revision
          : (previous?.revision ?? 0) + 1;
      typedVersions.set(object.id, { object, revision });
      return [
        {
          id: object.id,
          revision,
          text: object.text,
          bounds: annotationBounds(object),
        },
      ];
    });
    const ids = new Set(entries.map((entry) => entry.id));
    for (const id of typedVersions.keys())
      if (!ids.has(id)) typedVersions.delete(id);
    projections.syncTyped(entries);
  };
  syncTyped();
  let versions:
    | { modelVersion: string; preprocessingVersion: string }
    | undefined;
  let state: RecognitionState = {
    status: 'loading',
    message: 'Loading on-device recognition…',
    projections: [],
    queued: 0,
    inferenceMs: 0,
  };
  let disposed = false;
  let groupingPending = false;
  let firstDirtyAt = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let groupingTimeout: ReturnType<typeof setTimeout> | undefined;
  let publishedProjections: EquationProjection[] = [];
  const emit = () => {
    if (!disposed) {
      const next = projections.all();
      if (
        next.length !== publishedProjections.length ||
        next.some(
          (projection, index) => projection !== publishedProjections[index],
        )
      )
        publishedProjections = next;
      onState({
        ...state,
        projections: publishedProjections,
        queued: queue.size + (groupingPending ? 1 : 0),
      });
    }
  };
  const fail = (message: string) => {
    versions = undefined;
    worker.terminate();
    queue.reset();
    known.clear();
    tracker.reset(current);
    groupingPending = false;
    projections.reset(current.documentId, current.generation);
    syncTyped(true);
    state = { ...state, status: 'error', message };
    clearTimeout(timeout);
    clearTimeout(groupingTimeout);
    clearTimeout(debounce);
    emit();
  };
  function pump() {
    if (!versions || disposed) return;
    const job = queue.takeNext();
    const busy = !!job || queue.isRunning || groupingPending;
    const uncertain = projections.all().some((p) => p.status === 'uncertain');
    state = {
      ...state,
      status: busy ? 'recognizing' : 'ready',
      message: busy
        ? 'Reading your ink…'
        : uncertain
          ? 'Some handwriting is uncertain · try separated symbols'
          : 'Ready for handwriting',
    };
    emit();
    if (!job) return;
    clearTimeout(timeout);
    timeout = setTimeout(
      () => fail('Recognition timed out. Your ink is safe; retry when ready.'),
      30000,
    );
    worker.postMessage(job);
  }
  function requestGrouping() {
    if (!versions || disposed) return;
    groupingPending = true;
    emit();
    clearTimeout(debounce);
    firstDirtyAt ||= performance.now();
    debounce = setTimeout(
      () => {
        firstDirtyAt = 0;
        clearTimeout(groupingTimeout);
        groupingTimeout = setTimeout(
          () => fail('Equation grouping timed out. Your ink is safe.'),
          30000,
        );
        worker.postMessage({ type: 'GROUP', document: tracker.request() });
      },
      Math.max(0, Math.min(220, 700 - (performance.now() - firstDirtyAt))),
    );
  }
  function applyGroups(result: GroupResult) {
    current = store.getSnapshot();
    if (
      result.documentId !== current.documentId ||
      result.generation !== current.generation ||
      result.documentRevision !== current.revision ||
      !versions
    )
      return;
    clearTimeout(groupingTimeout);
    groupingPending = false;
    const update = tracker.apply(result);
    if (!update) return;
    projections.batch(() => {
      for (const id of update.retired) {
        projections.retire(id);
        queue.retire(id);
        known.delete(id);
      }
      for (const group of update.changed) {
        known.set(group.id, group.revision);
        const job: RecognitionJob = {
          type: 'RECOGNIZE',
          protocolVersion: 1,
          documentId: current.documentId,
          generation: current.generation,
          equationId: group.id,
          equationRevision: group.revision,
          requestId: crypto.randomUUID(),
          ...versions!,
          strokes: group.strokes,
          erasures: group.erasures,
          bounds: group.bounds,
        };
        projections.expect(job);
        queue.enqueue(job);
      }
    });
    pump();
  }
  const unsubscribe = store.subscribe((change) => {
    const document = store.getSnapshot();
    const sameGeneration =
      document.documentId === current.documentId &&
      document.generation === current.generation;
    current = document;
    projections.batch(() => {
      if (!sameGeneration) {
        projections.reset(document.documentId, document.generation);
        typedVersions.clear();
        typedObjects = undefined;
        for (const id of known.keys()) queue.retire(id);
        known.clear();
        tracker.reset(document);
      } else {
        for (const id of tracker.change(document, change)) {
          projections.invalidate(id);
          queue.retire(id);
          known.delete(id);
        }
      }
      syncTyped();
    });
    // Annotation-only changes refresh an in-flight grouping revision guard, but
    // never retire ink answers or enqueue annotation recognition.
    if ((tracker.dirty || groupingPending) && versions) requestGrouping();
    else emit();
  });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (disposed) return;
    const data = event.data;
    if (
      data?.type === 'READY' &&
      typeof data.modelVersion === 'string' &&
      data.modelVersion &&
      typeof data.preprocessingVersion === 'string' &&
      data.preprocessingVersion &&
      data.backend === 'wasm'
    ) {
      clearTimeout(timeout);
      versions = {
        modelVersion: data.modelVersion,
        preprocessingVersion: data.preprocessingVersion,
      };
      state = { ...state, status: 'ready', message: 'Ready for handwriting' };
      requestGrouping();
    } else if (isGroupResult(data)) applyGroups(data);
    else if (isRecognitionResult(data)) {
      if (queue.complete(data)) {
        clearTimeout(timeout);
        if (
          data.documentId !== current.documentId ||
          data.generation !== current.generation ||
          known.get(data.equationId) !== data.equationRevision
        ) {
          pump();
          return;
        }
        projections.accept(data);
        state.inferenceMs = data.timings.totalMs;
        pump();
      }
    } else if (data?.type === 'ERROR' && typeof data.error === 'string')
      fail(data.error);
    else fail('Recognition returned an unsupported response.');
  };
  worker.onerror = () =>
    fail(
      'Recognition worker could not run. Your notebook still supports drawing.',
    );
  timeout = setTimeout(
    () => fail('Model loading timed out. Retry to start recognition.'),
    60000,
  );
  worker.postMessage({ type: 'INIT' });
  emit();
  const stop = () => {
    disposed = true;
    unsubscribe();
    clearTimeout(debounce);
    clearTimeout(timeout);
    clearTimeout(groupingTimeout);
    worker.terminate();
    queue.reset();
  };
  return Object.assign(stop, {
    correct(equationId: string, label: 'x' | '×', symbolIndex?: number) {
      const changed = projections.correct(equationId, label, symbolIndex);
      if (changed) emit();
      return changed;
    },
  });
}
