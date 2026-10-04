import type { CSSProperties } from 'react';
import type { InkTool } from '../render/mountInk';

export type DrawingKind = 'pen' | 'pencil' | 'highlighter';
export interface PaperSettings {
  pattern: 'None' | 'Dots' | 'Grid' | 'Ruled' | 'Ruled wide';
  spacing: number;
  intensity: number;
  infinite: boolean;
}
export const defaultPaper: PaperSettings = {
  pattern: 'Dots',
  spacing: 22,
  intensity: 0.18,
  infinite: true,
};
const penColors = [
  ['Auto', '#252D38'],
  ['Black', '#252D38'],
  ['Soft white', '#E4E7EB'],
  ['Blue', '#5275AE'],
  ['Red', '#BD485D'],
];
const markerColors = [
  ['Yellow', '#FFE66B'],
  ['Green', '#DDF7A7'],
  ['Blue', '#AFE0F3'],
  ['Pink', '#F4B6D0'],
  ['Purple', '#D3B0ED'],
  ['Orange', '#FFD3A1'],
];

export function DrawingOptions({
  tool,
  onChange,
}: {
  tool: InkTool;
  onChange: (next: InkTool) => void;
}) {
  const marker = tool.kind === 'highlighter';
  return (
    <>
      <div className="option-modes">
        {(['pen', 'pencil', 'highlighter'] as const).map((kind) => (
          <button
            key={kind}
            aria-label={
              kind === 'pen'
                ? 'Pen mode'
                : kind === 'pencil'
                  ? 'Pencil mode'
                  : 'Highlighter mode'
            }
            aria-pressed={tool.kind === kind}
            onClick={() =>
              onChange({
                ...tool,
                mode: 'pen',
                kind,
                recognitionEligible: kind !== 'highlighter',
                opacity: kind === 'highlighter' ? 0.3 : 1,
                width: kind === 'highlighter' ? 12 : Math.min(8, tool.width),
                color: kind === 'highlighter' ? '#FFE66B' : '#252D38',
                colorMode: kind === 'highlighter' ? 'explicit' : 'auto',
              })
            }
          >
            {kind === 'pen'
              ? 'Pen'
              : kind === 'pencil'
                ? 'Pencil'
                : 'Highlighter'}
          </button>
        ))}
      </div>
      <svg
        className="stroke-preview"
        viewBox="0 0 110 24"
        aria-hidden="true"
        style={{
          color: tool.colorMode === 'auto' ? 'var(--ink)' : tool.color,
          opacity: tool.opacity,
        }}
      >
        <path
          d="M5 12 Q18 1 31 12 T57 12 T83 12 T105 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={Math.min(12, tool.width)}
          strokeLinecap="round"
        />
      </svg>
      <div
        className="swatches"
        role="group"
        aria-label={marker ? 'Highlighter colours' : 'Ink colours'}
      >
        {(marker ? markerColors : penColors).map(([name, color]) => (
          <button
            key={name}
            className="swatch"
            aria-label={name}
            aria-pressed={
              name === 'Auto'
                ? tool.colorMode === 'auto'
                : tool.colorMode !== 'auto' &&
                  tool.color.toLowerCase() === color.toLowerCase()
            }
            title={name}
            style={
              {
                '--swatch': name === 'Auto' ? 'var(--ink)' : color,
              } as CSSProperties
            }
            onClick={() =>
              onChange({
                ...tool,
                color,
                colorMode: name === 'Auto' ? 'auto' : 'explicit',
              })
            }
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      <label className="option-range">
        Stroke width{' '}
        <input
          aria-label="Stroke width"
          type="range"
          min={marker ? 4 : 1}
          max={marker ? 40 : 8}
          step="1"
          value={tool.width}
          onChange={(e) => onChange({ ...tool, width: Number(e.target.value) })}
        />
        <output>{tool.width}</output>
      </label>
      {marker ? (
        <label className="option-range">
          Opacity{' '}
          <input
            aria-label="Opacity"
            type="range"
            min="0.1"
            max="0.7"
            step="0.1"
            value={tool.opacity ?? 0.3}
            onChange={(e) =>
              onChange({ ...tool, opacity: Number(e.target.value) })
            }
          />
          <output>{Math.round((tool.opacity ?? 0.3) * 100)}%</output>
        </label>
      ) : (
        <label className="option-check">
          <input
            aria-label="Pressure"
            type="checkbox"
            checked={tool.pressureEnabled ?? false}
            onChange={(e) =>
              onChange({ ...tool, pressureEnabled: e.target.checked })
            }
          />
          Pressure
        </label>
      )}
    </>
  );
}

export function EraserOptions({
  tool,
  onChange,
}: {
  tool: InkTool;
  onChange: (next: InkTool) => void;
}) {
  return (
    <>
      {(['stroke-eraser', 'pixel-eraser'] as const).map((mode) => (
        <label className="option-check" key={mode}>
          <input
            type="radio"
            name="erase-mode"
            checked={tool.mode === mode}
            onChange={() => onChange({ ...tool, mode })}
          />
          {mode === 'stroke-eraser' ? 'Whole stroke' : 'Partial erase'}
        </label>
      ))}
      <svg className="erase-preview" viewBox="0 0 90 24" aria-hidden="true">
        <path d="M4 12H86" stroke="var(--ink)" strokeWidth="5" />
        <circle
          cx="45"
          cy="12"
          r={Math.min(11, tool.eraserRadius / 2)}
          fill="var(--surface)"
          stroke="var(--secondary)"
          strokeDasharray="2 2"
        />
      </svg>
      <label className="option-range">
        Eraser radius{' '}
        <input
          aria-label="Eraser radius"
          type="range"
          min="2"
          max="24"
          value={tool.eraserRadius}
          onChange={(e) =>
            onChange({ ...tool, eraserRadius: Number(e.target.value) })
          }
        />
        <output>{tool.eraserRadius}</output>
      </label>
    </>
  );
}

export function PaperOptions({
  paper,
  onChange,
}: {
  paper: PaperSettings;
  onChange: (next: PaperSettings) => void;
}) {
  return (
    <>
      <h2>Paper</h2>
      <div className="option-modes">
        {(['None', 'Dots', 'Grid', 'Ruled', 'Ruled wide'] as const).map(
          (pattern) => (
            <label key={pattern} className="option-check">
              <input
                type="radio"
                name="paper-pattern"
                checked={paper.pattern === pattern}
                onChange={() => onChange({ ...paper, pattern })}
              />
              {pattern}
            </label>
          ),
        )}
      </div>
      <label className="option-range">
        Pattern spacing{' '}
        <input
          aria-label="Spacing"
          type="range"
          min="12"
          max="40"
          value={paper.spacing}
          onChange={(e) =>
            onChange({ ...paper, spacing: Number(e.target.value) })
          }
        />
        <output>{paper.spacing}</output>
      </label>
      <label className="option-range">
        Pattern intensity{' '}
        <input
          aria-label="Intensity"
          type="range"
          min="0.05"
          max="0.4"
          step="0.05"
          value={paper.intensity}
          onChange={(e) =>
            onChange({ ...paper, intensity: Number(e.target.value) })
          }
        />
      </label>
      <label className="option-check">
        <input
          aria-label="Infinite canvas"
          type="checkbox"
          checked={paper.infinite}
          onChange={(e) => onChange({ ...paper, infinite: e.target.checked })}
        />
        Infinite canvas
      </label>
    </>
  );
}

export function paperStyle(paper: PaperSettings, zoom: number): CSSProperties {
  const color = `color-mix(in srgb, var(--text) ${paper.intensity * 100}%, transparent)`;
  const image =
    paper.pattern === 'None'
      ? 'none'
      : paper.pattern === 'Dots'
        ? `radial-gradient(${color} 1px, transparent 1px)`
        : paper.pattern === 'Grid'
          ? `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`
          : `linear-gradient(${color} 1px, transparent 1px)`;
  const size =
    paper.spacing * zoom * (paper.pattern === 'Ruled wide' ? 1.6 : 1);
  return { backgroundImage: image, backgroundSize: `${size}px ${size}px` };
}
