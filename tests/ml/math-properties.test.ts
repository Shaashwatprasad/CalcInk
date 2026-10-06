import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/math';

describe('ML-MATH independent seeded safe-math integration properties', () => {
  it('ML-MATH-001 checks 200 independently calculated precedence outcomes', () => {
    let seed = 0x43494e4b;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed % 101) - 50;
    };
    for (let index = 0; index < 200; index++) {
      const a = next(),
        b = next(),
        c = next();
      expect(evaluateExpression(`${a}+${b}×${c}=`)).toMatchObject({
        status: 'valid',
        value: a + b * c,
      });
    }
  });
  it('ML-MATH-002 seeded malformed input stays bounded and never throws', () => {
    let seed = 20261003;
    const alphabet = '0123456789.+-×÷=()x;[]{}';
    for (let sample = 0; sample < 500; sample++) {
      let source = '';
      for (let i = 0; i < sample % 80; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        source += alphabet[seed % alphabet.length];
      }
      const outcome = evaluateExpression(source);
      expect(['valid', 'invalid', 'incomplete', 'undefined']).toContain(
        outcome.status,
      );
      if (outcome.status === 'valid')
        expect(Number.isFinite(outcome.value)).toBe(true);
    }
  });
  it.each(['2/0=', '2÷0=', '0÷0=', '(-2)/(0)='])(
    'ML-MATH-003 %s is undefined without an exception',
    (source) => {
      expect(evaluateExpression(source)).toMatchObject({
        status: 'undefined',
        reason: 'division-by-zero',
      });
    },
  );
  it.each(['5+', '2×', '0.', '2+3'])(
    'ML-MATH-004 preserved parse behavior %s is distinct from recognition completion',
    (source) => {
      // evaluateExpression accepts terminal-free complete arithmetic; ProjectionStore owns terminal completion.
      const outcome = evaluateExpression(source);
      expect(outcome.status).toBe(
        source === '2+3' || source === '0.' ? 'valid' : 'incomplete',
      );
    },
  );
});
