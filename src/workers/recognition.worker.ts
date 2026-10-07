/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import {
  estimateBodySize,
  findFractionLayouts,
  groupEquations,
  symbolGroupingCandidates,
} from '../recognition/grouping';
import type { SymbolGroup } from '../recognition/grouping';
import {
  decodeFraction,
  decodeSymbols,
  geometricSlash,
  plausibleExpression,
  RecognitionCache,
  recognitionCacheKey,
  resolveGroupingCandidates,
} from '../recognition/decode';
import { MODEL_VERSION, validateManifest } from '../recognition/manifest';
import type { ModelManifest } from '../recognition/manifest';
import {
  PREPROCESSING_VERSION,
  rasterizeSymbol,
} from '../recognition/preprocess';
import { isWorkerRequest } from '../recognition/protocol';
import type {
  InkDocument,
  JobIdentity,
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
const predictionCache = new RecognitionCache();
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
function identity(job: RecognitionJob): JobIdentity {
  const {
    protocolVersion,
    documentId,
    generation,
    equationId,
    equationRevision,
    requestId,
    modelVersion,
    preprocessingVersion,
  } = job;
  return {
    protocolVersion,
    documentId,
    generation,
    equationId,
    equationRevision,
    requestId,
    modelVersion,
    preprocessingVersion,
  };
}
async function recognize(job: RecognitionJob): Promise<RecognitionResult> {
  const start = performance.now();
  let preprocessingMs = 0,
    inferenceMs = 0;
  if (
    job.modelVersion !== MODEL_VERSION ||
    job.preprocessingVersion !== PREPROCESSING_VERSION
  )
    throw new Error('Recognition version mismatch');
  const preprocessStart = performance.now();
  const layouts = findFractionLayouts(job.strokes);
  const candidates = symbolGroupingCandidates(job.strokes);
  const bodySize = estimateBodySize(job.strokes);
  preprocessingMs += performance.now() - preprocessStart;
  const masked = (group: SymbolGroup) =>
    job.erasures.some((e) =>
      e.targetStrokeIds.some((id) => group.strokes.some((s) => s.id === id)),
    );
  const classify = async (
    groups: SymbolGroup[],
  ): Promise<SymbolPrediction[]> => {
    const predictions: SymbolPrediction[] = [];
    for (const group of groups) {
      const p = performance.now();
      const key = recognitionCacheKey(
        group,
        job.erasures,
        bodySize,
        manifest!.onnx.sha256,
        PREPROCESSING_VERSION,
      );
      let probabilities = predictionCache.get(key);
      if (!probabilities) {
        const raster = rasterizeSymbol(group, job.erasures, bodySize);
        preprocessingMs += performance.now() - p;
        if (!raster.visible) continue;
        const i = performance.now();
        probabilities = await infer(raster.data);
        inferenceMs += performance.now() - i;
        predictionCache.set(key, probabilities);
      } else preprocessingMs += performance.now() - p;
      const topK = probabilities
        .map((score, index) => ({
          label: manifest!.output.canonicalLabels[index],
          score,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      predictions.push({
        ...topK[0],
        topK,
        bounds: group.bounds,
        strokeIds: [...new Set(group.strokes.map((s) => s.id))],
      });
    }
    // Slash is absent from the CNN vocabulary. Use a strict stroke-geometry rule
    // only between model-supported operands, retaining uncertainty on edited ink.
    for (let index = 1; index < predictions.length - 1; index++) {
      const prediction = predictions[index];
      const group = groups.find((g) =>
        g.strokes.every((s) => prediction.strokeIds?.includes(s.id)),
      );
      if (
        group &&
        !masked(group) &&
        geometricSlash(group, bodySize) &&
        /^[0-9x]$/u.test(predictions[index - 1].label) &&
        /^[0-9x]$/u.test(predictions[index + 1].label)
      ) {
        predictions[index] = {
          ...prediction,
          label: '/',
          score: 0.9,
          topK: [{ label: '/', score: 0.9 }, ...prediction.topK],
        };
      }
    }
    return predictions;
  };
  let decoded: ReturnType<typeof decodeSymbols>;
  if (layouts.length === 1) {
    const layout = layouts[0];
    const numerator = await classify(layout.numerator);
    const denominator = await classify(layout.denominator);
    const remainder = await classify(layout.remainder);
    // Rasterizing the bar checks whether any input remains visible. A targeted
    // partial erase disables confident structural interpretation of original ink.
    const bars = await classify([layout.bar]);
    const bar = bars[0] ?? {
      label: '-',
      score: 0,
      topK: [],
      bounds: layout.bar.bounds,
      strokeIds: layout.bar.strokes.map((s) => s.id),
    };
    decoded = decodeFraction(
      layout,
      numerator,
      denominator,
      remainder,
      {
        ...bar,
        label: '/',
        topK: [{ label: '/', score: bar.score }, ...bar.topK],
      },
      masked(layout.bar) || !bars.length,
    );
  } else {
    const primary = candidates[0];
    decoded = decodeSymbols(await classify(primary.groups));
    if (primary.ambiguous || !plausibleExpression(decoded.expression)) {
      // At most four hypotheses, sharing the effective-input prediction cache.
      // Keep low-confidence or unexamined geometry uncertain; accept only a
      // uniquely confident expression among the bounded supported splits.
      const readings = [decoded];
      for (const candidate of candidates.slice(1))
        readings.push(decodeSymbols(await classify(candidate.groups)));
      if (readings.length > 1 || primary.unresolved)
        decoded = resolveGroupingCandidates(readings, primary.unresolved);
    }
    if (layouts.length > 1) {
      decoded.status = 'uncertain';
      decoded.uncertaintyReasons.push('layout');
    }
  }
  return {
    ...identity(job),
    type: 'RESULT',
    symbols: decoded.symbols,
    expression: decoded.expression,
    bounds: job.bounds,
    status: decoded.status,
    uncertaintyReasons: decoded.uncertaintyReasons,
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
          ...identity(job),
          bounds: job.bounds,
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
