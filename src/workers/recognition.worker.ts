/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import { groupEquations, groupSymbols } from '../recognition/grouping';
import { MODEL_VERSION, validateManifest } from '../recognition/manifest';
import type { ModelManifest } from '../recognition/manifest';
import {
  PREPROCESSING_VERSION,
  rasterizeSymbol,
} from '../recognition/preprocess';
import { isWorkerRequest } from '../recognition/protocol';
import type {
  InkDocument,
  RecognitionJob,
  RecognitionResult,
  SymbolPrediction,
  WorkerResponse,
} from '../shared/types';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const base = import.meta.env.DEV
  ? new URL(import.meta.env.BASE_URL, scope.location.origin)
  : new URL('../', scope.location.href);
let session: ort.InferenceSession | undefined;
let manifest: ModelManifest | undefined;
let initialization: Promise<void> | undefined;
let running = false;
let pendingDocument: InkDocument | undefined;
let groupingTimer: ReturnType<typeof setTimeout> | undefined;
const queue = new Map<string, RecognitionJob>();
const send = (response: WorkerResponse) => scope.postMessage(response);
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function scores(value: ort.Tensor): number[] {
  if (value.type !== 'float32' || value.data.length !== 16)
    throw new Error(
      'Model output does not match audited 16-class float32 probabilities',
    );
  const values = Array.from(value.data as Float32Array);
  if (
    values.some((x) => !Number.isFinite(x) || x < 0 || x > 1.001) ||
    Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 0.01
  )
    throw new Error('Invalid model probabilities');
  return values;
}
async function infer(data: Float32Array): Promise<number[]> {
  if (!session || !manifest) throw new Error('Recognizer not initialized');
  const tensor = new ort.Tensor('float32', data, manifest.input.shape);
  let outputs: ort.InferenceSession.OnnxValueMapType | undefined;
  try {
    outputs = await session.run({ [manifest.input.name]: tensor });
    return scores(outputs[manifest.output.name] as ort.Tensor);
  } finally {
    tensor.dispose();
    if (outputs)
      Object.values(outputs).forEach((output) => {
        if (output instanceof ort.Tensor) output.dispose();
      });
  }
}
async function initialize(): Promise<void> {
  if (
    typeof OffscreenCanvas === 'undefined' ||
    !new OffscreenCanvas(1, 1).getContext('2d')
  )
    throw new Error(
      'Worker OffscreenCanvas is required for recognition. Drawing remains available.',
    );
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL('runtime/', base).href;
  const response = await fetch(new URL('models/manifest.json', base), {
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(`Manifest fetch failed (${response.status})`);
  manifest = validateManifest(await response.json());
  const modelResponse = await fetch(
    new URL(`models/${manifest.onnx.file}`, base),
    { cache: 'no-store' },
  );
  if (!modelResponse.ok)
    throw new Error(`Model fetch failed (${modelResponse.status})`);
  const buffer = await modelResponse.arrayBuffer();
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  if (
    digest !== manifest.onnx.sha256 ||
    buffer.byteLength !== manifest.onnx.bytes
  )
    throw new Error('Model integrity verification failed');
  session = await ort.InferenceSession.create(buffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  if (
    session.inputNames[0] !== manifest.input.name ||
    session.outputNames[0] !== manifest.output.name
  )
    throw new Error('Model tensor names disagree with manifest');
  await infer(new Float32Array(7500).fill(1));
  send({
    type: 'READY',
    modelVersion: MODEL_VERSION,
    preprocessingVersion: PREPROCESSING_VERSION,
    backend: 'wasm',
  });
}
async function recognize(job: RecognitionJob): Promise<RecognitionResult> {
  const start = performance.now();
  let preprocessingMs = 0,
    inferenceMs = 0;
  const symbols: SymbolPrediction[] = [];
  if (
    job.modelVersion !== MODEL_VERSION ||
    job.preprocessingVersion !== PREPROCESSING_VERSION
  )
    throw new Error('Recognition version mismatch');
  const preprocessStart = performance.now();
  const groups = groupSymbols(job.strokes);
  preprocessingMs += performance.now() - preprocessStart;
  for (const group of groups) {
    const p = performance.now();
    const raster = rasterizeSymbol(group, job.erasures, job.bounds);
    preprocessingMs += performance.now() - p;
    if (!raster.visible) continue;
    const i = performance.now();
    const probabilities = await infer(raster.data);
    inferenceMs += performance.now() - i;
    const topK = probabilities
      .map((score, index) => ({
        label: manifest!.output.canonicalLabels[index],
        score,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    symbols.push({ ...topK[0], topK, bounds: group.bounds });
  }
  const uncertain = symbols.some(
    (s) => s.score < 0.65 || s.score - s.topK[1].score < 0.15,
  );
  return {
    ...job,
    type: 'RESULT',
    symbols,
    expression: symbols.map((s) => s.label).join(''),
    bounds: job.bounds,
    status: uncertain ? 'uncertain' : 'recognized',
    backend: 'wasm',
    timings: {
      preprocessingMs,
      inferenceMs,
      totalMs: performance.now() - start,
    },
  };
}
async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await initialization;
    while (queue.size) {
      const [key, job] = queue.entries().next().value!;
      queue.delete(key);
      try {
        send(await recognize(job));
      } catch (error) {
        send({
          ...job,
          type: 'RESULT',
          symbols: [],
          expression: '',
          status: 'error',
          error: errorText(error),
          timings: { preprocessingMs: 0, inferenceMs: 0, totalMs: 0 },
          backend: 'wasm',
        });
      }
    }
  } finally {
    running = false;
  }
}
scope.onmessage = (event: MessageEvent<unknown>) => {
  if (!isWorkerRequest(event.data)) {
    send({ type: 'ERROR', error: 'Invalid worker request' });
    return;
  }
  const request = event.data;
  if (request.type === 'INIT') {
    initialization ??= initialize().catch(async (error) => {
      await session?.release();
      session = undefined;
      send({ type: 'ERROR', error: errorText(error) });
    });
    return;
  }
  if (request.type === 'GROUP') {
    // Snapshot requests coalesce independently of inference jobs. The supervisor
    // rejects GROUPS whose document identity/generation/revision is no longer current.
    if (
      pendingDocument?.documentId === request.document.documentId &&
      pendingDocument.generation === request.document.generation &&
      pendingDocument.revision > request.document.revision
    )
      return;
    pendingDocument = request.document;
    groupingTimer ??= setTimeout(() => {
      groupingTimer = undefined;
      const document = pendingDocument!;
      pendingDocument = undefined;
      try {
        send({
          type: 'GROUPS',
          documentId: document.documentId,
          generation: document.generation,
          documentRevision: document.revision,
          groups: groupEquations(document),
        });
      } catch (error) {
        send({
          type: 'ERROR',
          error: `Equation grouping failed: ${errorText(error)}`,
        });
      }
    }, 0);
    return;
  }
  if (!initialization) {
    send({ type: 'ERROR', error: 'INIT is required before recognition' });
    return;
  }
  // Coalesce each equation independently while preserving Map insertion order fairness.
  queue.set(
    `${request.documentId}:${request.generation}:${request.equationId}`,
    request,
  );
  void drain();
};
