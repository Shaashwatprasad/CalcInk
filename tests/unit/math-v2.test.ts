import { describe, expect, it } from 'vitest';
import {
  evaluateAST,
  evaluateExpression,
  evaluateNotebook,
  parseMath,
  MATH_LIMITS,
  type NotebookEntry,
} from '../../src/math';
const entry = (
  id: string,
  text: string,
  state: NotebookEntry['state'] = 'recognized',
): NotebookEntry => ({ id, text, state });
const outcomes = (rows: NotebookEntry[]) =>
  evaluateNotebook(rows).entries.map((row) => row.outcome);
describe('pure V2 notebook math', () => {
  it('parses canonical typed structure with independent precedence and dependencies', () => {
    expect(parseMath(' −x + 2×3 = ')).toEqual({
      status: 'parsed',
      normalizedText: '-x+2*3=',
      terminalEquals: true,
      dependencies: ['x'],
      ast: {
        type: 'binary',
        operator: '+',
        left: {
          type: 'unary',
          operator: '-',
          operand: { type: 'identifier', name: 'x' },
        },
        right: {
          type: 'binary',
          operator: '*',
          left: { type: 'number', value: 2 },
          right: { type: 'number', value: 3 },
        },
      },
    });
  });
  it('accepts assignment without requiring another terminal equals', () => {
    expect(outcomes([entry('def', 'x=2'), entry('use', 'x+6=')])).toEqual([
      { status: 'variable-defined', name: 'x', value: 2, display: '2' },
      { status: 'valid', value: 8, display: '8' },
    ]);
  });
  it('rebuilds dependencies for definition edits and removal without outside state', () => {
    const original = [entry('def', 'x=2'), entry('use', 'x+6=')];
    expect(outcomes(original)[1]).toMatchObject({ value: 8 });
    expect(outcomes([entry('def', 'x=5'), original[1]])[1]).toMatchObject({
      value: 11,
    });
    expect(outcomes([original[1]])[0]).toEqual({
      status: 'unbound',
      name: 'x',
    });
    expect(outcomes(original)[1]).toMatchObject({ value: 8 });
  });
  it('later definitions replace binding only for later uses; no forward lookup', () => {
    expect(
      outcomes([
        entry('early', 'x+6='),
        entry('a', 'x=2'),
        entry('middle', 'x+6='),
        entry('b', 'x=5'),
        entry('late', 'x+6='),
      ]),
    ).toEqual([
      { status: 'unbound', name: 'x' },
      { status: 'variable-defined', name: 'x', value: 2, display: '2' },
      { status: 'valid', value: 8, display: '8' },
      { status: 'variable-defined', name: 'x', value: 5, display: '5' },
      { status: 'valid', value: 11, display: '11' },
    ]);
  });
  it.each(['x=', 'x=2+', 'x=no', 'x=2/0', 'x=x+1'])(
    'invalid or incomplete definition %s clears older binding',
    (text) => {
      const results = outcomes([
        entry('old', 'x=9'),
        entry('new', text),
        entry('use', 'x+1='),
      ]);
      expect(results[1].status).not.toBe('variable-defined');
      expect(results[2]).toEqual({ status: 'unbound', name: 'x' });
    },
  );
  it('a self-reference is cyclic even when an older x value is available', () => {
    expect(
      evaluateAST(
        {
          type: 'assignment',
          name: 'x',
          value: { type: 'identifier', name: 'x' },
        },
        { x: 99 },
      ),
    ).toEqual({ status: 'invalid', code: 'cyclic-definition', location: 0 });
  });
  it.each(['pending', 'uncertain', 'error'] as const)(
    '%s potential definition blocks later x until recomputed',
    (state) => {
      const notebook = evaluateNotebook([
        entry('old', 'x=9'),
        entry('dirty', 'x=2', state),
        entry('use', 'x+1='),
      ]);
      expect(notebook.environment).toEqual({});
      expect(notebook.entries[2].outcome).toEqual({
        status: 'pending',
        reason: 'definition-not-current',
        definitionId: 'dirty',
      });
      expect(notebook.entries[2].context.blockedBy).toBe('dirty');
      expect(
        outcomes([
          entry('old', 'x=9'),
          entry('dirty', 'x=2'),
          entry('use', 'x+1='),
        ])[2],
      ).toMatchObject({ value: 3 });
    },
  );
  it('unknown empty pending row conservatively blocks, but known arithmetic pending row preserves x', () => {
    expect(
      outcomes([
        entry('old', 'x=9'),
        entry('dirty', '', 'pending'),
        entry('use', 'x+1='),
      ])[2].status,
    ).toBe('pending');
    expect(
      outcomes([
        entry('old', 'x=9'),
        entry('dirty', '2+3=', 'pending'),
        entry('use', 'x+1='),
      ])[2],
    ).toMatchObject({ value: 10 });
  });
  it('a later valid definition recovers from blocked earlier definition', () => {
    expect(
      outcomes([
        entry('dirty', 'x=2', 'uncertain'),
        entry('new', 'x=5'),
        entry('use', 'x+1='),
      ])[2],
    ).toMatchObject({ value: 6 });
  });
  it('returns source definition context and avoids mutating caller entries/environment', () => {
    const rows = Object.freeze([
      Object.freeze(entry('def', 'x=2')),
      Object.freeze(entry('use', 'x+6=')),
    ]);
    const result = evaluateNotebook(rows);
    expect(result.entries[1]).toMatchObject({
      dependencies: ['x'],
      normalizedText: 'x+6=',
      context: {
        x: 2,
        definitionId: 'def',
        definesX: false,
        invalidatesX: false,
      },
    });
    result.environment.x = 100;
    expect(evaluateNotebook(rows).environment).toEqual({ x: 2 });
    const env = Object.freeze({ x: 3 });
    expect(evaluateAST({ type: 'identifier', name: 'x' }, env)).toMatchObject({
      value: 3,
    });
  });
  it('requires terminal completion for ordinary notebook arithmetic but preserves V1 optional equals', () => {
    expect(outcomes([entry('a', '2+3')])).toEqual([{ status: 'incomplete' }]);
    expect(evaluateExpression('2+3')).toMatchObject({ value: 5 });
    expect(evaluateExpression('x=2')).toEqual({
      status: 'invalid',
      code: 'unknown-token',
      location: 0,
    });
    expect(
      outcomes([
        entry('def', 'x=9'),
        entry('incomplete-use', 'x'),
        entry('use', 'x+1='),
      ])[2],
    ).toMatchObject({ value: 10 });
  });
  it.each(['x=1=2', 'x==', '2=3', 'x=(2))', 'x=globalThis.alert(1)', 'x=1;2'])(
    'rejects malformed/injected notebook source %s',
    (text) => {
      expect(outcomes([entry('bad', text)])[0].status).toBe('invalid');
    },
  );
  it('reuses limits, keeps syntax priority, supports finite unary math and long flat arithmetic', () => {
    expect(parseMath('x=' + '1'.repeat(MATH_LIMITS.characters))).toMatchObject({
      status: 'invalid',
      code: 'too-long',
    });
    expect(parseMath('x=' + '-'.repeat(66) + '1')).toMatchObject({
      status: 'invalid',
      code: 'too-deep',
    });
    expect(outcomes([entry('a', 'x=7/0+')])[0]).toEqual({
      status: 'incomplete',
    });
    expect(
      outcomes([entry('a', 'x=−3'), entry('b', '−x×2=')])[1],
    ).toMatchObject({ value: 6 });
    expect(evaluateExpression(Array(250).fill('1').join('+'))).toMatchObject({
      status: 'valid',
      value: 250,
    });
    expect(outcomes([entry('a', 'x=' + '9'.repeat(309))])[0]).toMatchObject({
      status: 'undefined',
      reason: 'non-finite-result',
    });
  });
});
