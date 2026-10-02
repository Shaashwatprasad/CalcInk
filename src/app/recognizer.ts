import { boundsIntersect } from '../ink/geometry';
import { isGroupResult } from '../recognition/protocol';
import {
  isRecognitionResult,
  ProjectionStore,
  RecognitionQueue,
} from '../projection';
import type { EquationProjection } from '../projection';
import type { InkStore, InkChange } from '../document/InkStore';
import type {
  EquationGroupData,
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
): () => void {
  const worker = new Worker(
    new URL('../workers/recognition.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const projections = new ProjectionStore();
  const queue = new RecognitionQueue();
  let current = store.getSnapshot();
  projections.reset(current.documentId, current.generation);
  const known = new Map<string, number>();
  let groups: EquationGroupData[] = [];
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
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let groupingTimeout: ReturnType<typeof setTimeout> | undefined;
  const emit = () => {
    if (!disposed)
      onState({
        ...state,
        projections: projections.all(),
        queued: queue.size + (groupingPending ? 1 : 0),
      });
  };
  const fail = (message: string) => {
    versions = undefined;
    worker.terminate();
    queue.reset();
    known.clear();
    groups = [];
    groupingPending = false;
    projections.reset(current.documentId, current.generation);
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
    debounce = setTimeout(() => {
      clearTimeout(groupingTimeout);
      groupingTimeout = setTimeout(
        () => fail('Equation grouping timed out. Your ink is safe.'),
        30000,
      );
      worker.postMessage({ type: 'GROUP', document: store.getSnapshot() });
    }, 220);
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
    groups = result.groups;
    const ids = new Set(groups.map((g) => g.id));
    for (const id of known.keys())
      if (!ids.has(id)) {
        projections.retire(id);
        queue.retire(id);
        known.delete(id);
      }
    for (const group of groups) {
      if (known.get(group.id) === group.revision) continue;
      known.set(group.id, group.revision);
      const job: RecognitionJob = {
        type: 'RECOGNIZE',
        protocolVersion: 1,
        documentId: current.documentId,
        generation: current.generation,
        equationId: group.id,
        equationRevision: group.revision,
        requestId: crypto.randomUUID(),
        ...versions,
        strokes: group.strokes,
        erasures: group.erasures,
        bounds: group.bounds,
      };
      projections.expect(job);
      queue.enqueue(job);
    }
    pump();
  }
  function invalidate(change: InkChange) {
    const affected = new Set([
      ...change.changedStrokeIds,
      ...change.deletedStrokeIds,
    ]);
    const regions = [...change.oldBounds, ...change.newBounds];
    for (const group of groups)
      if (group.strokes.some((s) => affected.has(s.id)))
        regions.push(group.bounds);
    const retired = new Set<string>();
    // A tall replacement can cascade through neighboring lines as their union grows.
    // Compute a conservative closure over already-known line bounds, not raw ink.
    for (const initial of regions) {
      let region = { ...initial };
      let expanded = true;
      const absorbed = new Set<string>();
      while (expanded) {
        expanded = false;
        for (const group of groups) {
          if (absorbed.has(group.id)) continue;
          const height = Math.max(
            24,
            group.bounds.maxY - group.bounds.minY,
            region.maxY - region.minY,
          );
          if (
            !boundsIntersect(
              {
                ...group.bounds,
                minX: -Infinity,
                maxX: Infinity,
                minY: group.bounds.minY - height * 0.6,
                maxY: group.bounds.maxY + height * 0.6,
              },
              region,
            )
          )
            continue;
          absorbed.add(group.id);
          retired.add(group.id);
          expanded = true;
          region = {
            minX: Math.min(region.minX, group.bounds.minX),
            minY: Math.min(region.minY, group.bounds.minY),
            maxX: Math.max(region.maxX, group.bounds.maxX),
            maxY: Math.max(region.maxY, group.bounds.maxY),
          };
        }
      }
    }
    for (const id of retired) {
      projections.retire(id);
      queue.retire(id);
      known.delete(id);
    }
  }
  const unsubscribe = store.subscribe((change) => {
    const document = store.getSnapshot();
    if (
      document.documentId !== current.documentId ||
      document.generation !== current.generation
    ) {
      projections.reset(document.documentId, document.generation);
      for (const id of known.keys()) queue.retire(id);
      known.clear();
      groups = [];
    } else invalidate(change);
    current = document;
    emit();
    requestGrouping();
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
      emit();
    } else if (isGroupResult(data)) applyGroups(data);
    else if (isRecognitionResult(data)) {
      if (queue.complete(data)) {
        clearTimeout(timeout);
        if (data.status === 'error') {
          fail(
            data.error ??
              'Recognition failed. Retry to restart the on-device model.',
          );
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
  return () => {
    disposed = true;
    unsubscribe();
    clearTimeout(debounce);
    clearTimeout(timeout);
    clearTimeout(groupingTimeout);
    worker.terminate();
    queue.reset();
  };
}
