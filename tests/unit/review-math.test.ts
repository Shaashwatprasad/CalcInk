import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/math';

describe('independent math review regressions', () => {
  it('never displays Infinity after rounding a valid finite maximum value', () => {
    const expression = `${BigInt(Number.MAX_VALUE).toString()}=`;
    const result = evaluateExpression(expression);
    expect(result.status).toBe('valid');
    if (result.status !== 'valid')
      throw new Error('Finite literal was not evaluated');
    expect(Number.isFinite(result.value)).toBe(true);
    expect(Number.isFinite(Number(result.display))).toBe(true);
  });
});
