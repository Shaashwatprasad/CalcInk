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
  /** Missing fields retain V1's explicit-color, opaque, constant-width pen behavior. */
  kind?: 'pen' | 'pencil' | 'highlighter';
  colorMode?: 'auto' | 'explicit';
  opacity?: number;
  pressureEnabled?: boolean;
  recognitionEligible?: boolean;
}
export interface Erasure {
  id: string;
  targetStrokeIds: string[];
  path: Point[];
  radius: number;
}
export interface XY {
  x: number;
  y: number;
}
interface AnnotationStyle {
  id: string;
  recognitionEligible: false;
  color: string;
  colorMode: 'auto' | 'explicit';
  strokeWidth: number;
  opacity: number;
}
export type Annotation = AnnotationStyle &
  (
    | { kind: 'text'; x: number; y: number; fontSize: number; text: string }
    | {
        kind: 'shape';
        shape: 'rectangle' | 'ellipse';
        x: number;
        y: number;
        width: number;
        height: number;
      }
    | {
        kind: 'shape';
        shape: 'line';
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      }
    | { kind: 'region'; x: number; y: number; width: number; height: number }
    | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number }
  );
export interface Selection {
  strokeIds: string[];
  objectIds: string[];
}
export interface InkDocument {
  format: 'calcink-document';
  version: 1 | 2;
  documentId: string;
  generation: number;
  revision: number;
  strokes: Stroke[];
  erasures: Erasure[];
  /** V1 and older V2 notebooks migrate absent annotations to an empty list. */
  objects?: Annotation[];
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
  /** Authoritative source strokes; absent only on legacy/test responses. */
  strokeIds?: string[];
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
  uncertaintyReasons?: (
    | 'crossing'
    | 'confidence'
    | 'layout'
    | 'segmentation'
  )[];
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
