import type { Evaluation } from '../shared/types';

/** Resource limits apply before parsing, including to malformed expressions. */
export const MATH_LIMITS = {
  characters: 4096,
  tokens: 512,
  nesting: 64,
} as const;

type Token = {
  kind: 'number' | '+' | '-' | '*' | '/' | '(' | ')';
  location: number;
  value?: number;
};
class SyntaxFailure extends Error {
  constructor(readonly outcome: Evaluation) {
    super('Expression could not be parsed');
  }
}

function invalid(code: string, location: number): never {
  throw new SyntaxFailure({ status: 'invalid', code, location });
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let equals = false;
  for (let index = 0; index < text.length; ) {
    const character = text[index];
    if (/\s/u.test(character)) {
      index++;
      continue;
    }
    if (equals) invalid('unexpected-after-equals', index);
    if (character === '=') {
      equals = true;
      index++;
      continue;
    }
    if (tokens.length >= MATH_LIMITS.tokens) invalid('too-many-tokens', index);
    if (/[0-9.]/u.test(character)) {
      const location = index;
      let decimals = 0;
      let digits = 0;
      while (index < text.length && /[0-9.]/u.test(text[index])) {
        if (text[index] === '.') {
          decimals++;
          if (decimals > 1) invalid('duplicate-decimal', index);
        } else digits++;
        index++;
      }
      if (digits === 0) {
        if (index === text.trimEnd().length)
          throw new SyntaxFailure({ status: 'incomplete' });
        invalid('missing-decimal-digits', location);
      }
      tokens.push({
        kind: 'number',
        value: Number(text.slice(location, index)),
        location,
      });
      continue;
    }
    const canonical =
      ({ '×': '*', '÷': '/', '−': '-' } as Record<string, string>)[character] ??
      character;
    if (
      canonical !== '+' &&
      canonical !== '-' &&
      canonical !== '*' &&
      canonical !== '/' &&
      canonical !== '(' &&
      canonical !== ')'
    ) {
      invalid('unknown-token', index);
    }
    tokens.push({ kind: canonical, location: index++ });
  }
  return tokens;
}

/** JavaScript binary numbers, rendered to twelve significant digits. */
export function formatNumber(value: number): string {
  return Number(value.toPrecision(12)).toString();
}

/** Evaluate arithmetic without executing source code or consulting external services. */
export function evaluateExpression(text: string): Evaluation {
  if (text.length > MATH_LIMITS.characters)
    return {
      status: 'invalid',
      code: 'too-long',
      location: MATH_LIMITS.characters,
    };
  try {
    const tokens = tokenize(text);
    let index = 0;
    let undefinedReason: string | undefined;
    const finite = (value: number): number => {
      if (!Number.isFinite(value)) undefinedReason ??= 'non-finite-result';
      return value;
    };
    const primary = (depth: number): number => {
      const token = tokens[index];
      if (!token) throw new SyntaxFailure({ status: 'incomplete' });
      if (depth > MATH_LIMITS.nesting) invalid('too-deep', token.location);
      if (token.kind === '+' || token.kind === '-') {
        index++;
        const value = primary(depth + 1);
        return token.kind === '-' ? -value : value;
      }
      if (token.kind === 'number') {
        index++;
        return finite(token.value!);
      }
      if (token.kind === '(') {
        index++;
        const value = sum(depth + 1);
        const close = tokens[index];
        if (!close) throw new SyntaxFailure({ status: 'incomplete' });
        if (close.kind !== ')')
          invalid('expected-closing-parenthesis', close.location);
        index++;
        return value;
      }
      return invalid('expected-operand', token.location);
    };
    const product = (depth: number): number => {
      let value = primary(depth);
      while (tokens[index]?.kind === '*' || tokens[index]?.kind === '/') {
        const operation = tokens[index++].kind;
        const right = primary(depth);
        if (operation === '/' && right === 0)
          undefinedReason ??= 'division-by-zero';
        value = finite(operation === '*' ? value * right : value / right);
      }
      return value;
    };
    const sum = (depth: number): number => {
      let value = product(depth);
      while (tokens[index]?.kind === '+' || tokens[index]?.kind === '-') {
        const operation = tokens[index++].kind;
        const right = product(depth);
        value = finite(operation === '+' ? value + right : value - right);
      }
      return value;
    };
    const value = sum(0);
    if (tokens[index]) invalid('unexpected-token', tokens[index].location);
    if (undefinedReason)
      return {
        status: 'undefined',
        reason: undefinedReason,
        display: 'Undefined',
      };
    return { status: 'valid', value, display: formatNumber(value) };
  } catch (error) {
    if (error instanceof SyntaxFailure) return error.outcome;
    throw error;
  }
}
