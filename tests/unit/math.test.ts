import { describe, expect, it } from 'vitest';
import { evaluateExpression, MATH_LIMITS } from '../../src/math';

describe('deterministic arithmetic', () => {
  it.each([
    ['18+4×3=', '30'],
    ['18+5×3=', '33'],
    ['8÷2×2', '8'],
    ['10−3−2', '5'],
    ['−3+5', '2'],
    ['2×−3', '-6'],
    ['12.5÷2', '6.25'],
    ['0.1+0.2=', '0.3'],
    ['.5+5.', '5.5'],
    ['(18+4)*3', '66'],
    ['2/-(-3)', '0.666666666667'],
    ['3--2', '5'],
    ['-0', '0'],
    [' +12.5 \n / 2 = \t', '6.25'],
    ['1/3', '0.333333333333'],
    ['1234567890123', '1234567890120'],
  ])('evaluates %s as %s', (input, display) => {
    expect(evaluateExpression(input)).toMatchObject({
      status: 'valid',
      display,
    });
  });

  it('retains the numeric value independently from its display rounding', () => {
    expect(evaluateExpression('0.1+0.2')).toEqual({
      status: 'valid',
      value: 0.1 + 0.2,
      display: '0.3',
    });
  });

  it.each(['', ' ', '=', '2+', '2×', '-', '(1+2', '(', '.', '2+ .'])(
    'reports unfinished input %j',
    (input) => {
      expect(evaluateExpression(input)).toEqual({ status: 'incomplete' });
    },
  );

  it.each([
    ['1..2', 'duplicate-decimal', 2],
    ['1=2', 'unexpected-after-equals', 2],
    ['2==', 'unexpected-after-equals', 2],
    ['2+a', 'unknown-token', 2],
    ['2**3', 'expected-operand', 2],
    ['()', 'expected-operand', 1],
    ['2 3', 'unexpected-token', 2],
    ['(2 3)', 'expected-closing-parenthesis', 3],
    ['2)', 'unexpected-token', 1],
    ['. +2', 'missing-decimal-digits', 0],
    ['1e3', 'unknown-token', 1],
    ['2(3)', 'unexpected-token', 1],
  ])('rejects %s with the source location', (input, code, location) => {
    expect(evaluateExpression(input as string)).toEqual({
      status: 'invalid',
      code,
      location,
    });
  });

  it.each(['7÷0=', '0/0', '7/-0', '7/(1-1)'])(
    'displays Undefined for %s',
    (input) => {
      expect(evaluateExpression(input)).toEqual({
        status: 'undefined',
        reason: 'division-by-zero',
        display: 'Undefined',
      });
    },
  );

  it('handles numeric overflow and gives syntax errors priority over arithmetic failures', () => {
    expect(evaluateExpression('9'.repeat(309))).toMatchObject({
      status: 'undefined',
      reason: 'non-finite-result',
    });
    expect(
      evaluateExpression(`${'9'.repeat(200)}*${'9'.repeat(200)}`),
    ).toMatchObject({ status: 'undefined' });
    expect(evaluateExpression('7/0+')).toEqual({ status: 'incomplete' });
    expect(evaluateExpression('7/0)')).toMatchObject({ status: 'invalid' });
  });

  it('rejects excessive input, token counts, parentheses and unary nesting cleanly', () => {
    expect(
      evaluateExpression('1'.repeat(MATH_LIMITS.characters + 1)),
    ).toMatchObject({ status: 'invalid', code: 'too-long' });
    expect(evaluateExpression(Array(300).fill('1').join('+'))).toMatchObject({
      status: 'invalid',
      code: 'too-many-tokens',
    });
    expect(
      evaluateExpression('('.repeat(66) + '1' + ')'.repeat(66)),
    ).toMatchObject({ status: 'invalid', code: 'too-deep' });
    expect(evaluateExpression('-'.repeat(66) + '1')).toMatchObject({
      status: 'invalid',
      code: 'too-deep',
    });
  });

  it('does not execute injected source', () => {
    expect(evaluateExpression('globalThis.alert(1)')).toMatchObject({
      status: 'invalid',
      code: 'unknown-token',
    });
    expect(evaluateExpression('1;2')).toMatchObject({
      status: 'invalid',
      code: 'unknown-token',
    });
  });
});
