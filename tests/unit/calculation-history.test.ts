import { describe, expect, it } from 'vitest';
import { CalculationHistory } from '../../src/projection/history';
import type { EquationProjection } from '../../src/projection';

const projection = (
  id: string,
  revision = 1,
  answer = '2',
): EquationProjection => ({
  equationId: id,
  equationRevision: revision,
  expression: '1+1=',
  status: 'valid',
  answerText: answer,
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
});
describe('calculation history', () => {
  it('keeps one record per equation and orders only completed changes newest first', () => {
    const history = new CalculationHistory();
    const first = projection('first'),
      second = projection('second');
    expect(
      history.update('doc', [first, second]).records.map((r) => r.id),
    ).toEqual(['second', 'first']);
    const edited = projection('first', 2, '3');
    const result = history.update('doc', [edited, second]);
    expect(result.records.map((r) => r.id)).toEqual(['first', 'second']);
    expect(result.current).toBe(edited);
    expect(history.update('doc', [edited, { ...second }]).records).toEqual(
      result.records,
    );
  });
  it('removes pending/deleted/cleared records, restores completed undo and isolates notebooks', () => {
    const history = new CalculationHistory(),
      done = projection('line');
    history.update('a', [done]);
    expect(
      history.update('a', [
        { ...done, status: 'pending', answerText: undefined },
      ]).records,
    ).toEqual([]);
    expect(history.update('a', [done]).records[0].id).toBe('line');
    expect(history.update('a', []).records).toEqual([]);
    expect(history.update('a', [done]).records).toHaveLength(1);
    expect(history.update('b', []).current).toBeUndefined();
    expect(history.update('a', []).records).toEqual([]);
  });
});
