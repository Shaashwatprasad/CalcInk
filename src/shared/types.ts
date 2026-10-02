export interface Point {
  x: number;
  y: number;
  timestamp: number;
  pressure?: number;
}
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export interface Stroke {
  id: string;
  points: Point[];
  bounds: Bounds;
  width: number;
  color: string;
}
export interface Erasure {
  id: string;
  targetStrokeIds: string[];
  path: Point[];
  radius: number;
}
export interface InkDocument {
  format: 'calcink-document';
  version: 1;
  documentId: string;
  generation: number;
  revision: number;
  strokes: Stroke[];
  erasures: Erasure[];
}
export type Evaluation =
  | { status: 'valid'; value: number; display: string }
  | { status: 'incomplete' }
  | { status: 'invalid'; code: string; location: number }
  | { status: 'undefined'; reason: string; display: 'Undefined' };
export interface JobIdentity {
  protocolVersion: 1;
  documentId: string;
  generation: number;
  equationId: string;
  equationRevision: number;
  requestId: string;
  modelVersion: string;
  preprocessingVersion: string;
}
export interface SymbolPrediction {
  label: string;
  score: number;
  bounds: Bounds;
  topK: { label: string; score: number }[];
}
export interface RecognitionJob extends JobIdentity {
  type: 'RECOGNIZE';
  strokes: Stroke[];
  erasures: Erasure[];
  bounds: Bounds;
}
export interface RecognitionResult extends JobIdentity {
  type: 'RESULT';
  symbols: SymbolPrediction[];
  expression: string;
  bounds: Bounds;
  status: 'recognized' | 'uncertain' | 'error';
  error?: string;
  timings: { preprocessingMs: number; inferenceMs: number; totalMs: number };
  backend: 'wasm';
}
export interface EquationGroupData {
  id: string;
  revision: number;
  strokes: Stroke[];
  erasures: Erasure[];
  bounds: Bounds;
}
export interface GroupRequest {
  type: 'GROUP';
  document: InkDocument;
}
export interface GroupResult {
  type: 'GROUPS';
  documentId: string;
  generation: number;
  documentRevision: number;
  groups: EquationGroupData[];
}
export type WorkerRequest = RecognitionJob | GroupRequest | { type: 'INIT' };
export type WorkerResponse =
  | GroupResult
  | RecognitionResult
  | {
      type: 'READY';
      modelVersion: string;
      preprocessingVersion: string;
      backend: 'wasm';
    }
  | { type: 'ERROR'; error: string };
