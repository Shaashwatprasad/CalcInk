import type { Evaluation } from '../shared/types';

/** Shared V1 limits and numeric policy; all execution stays deterministic and local. */
export const MATH_LIMITS = {
  characters: 4096,
  tokens: 512,
  nesting: 64,
} as const;
export type ArithmeticAst =
  | { type: 'number'; value: number }
  | { type: 'identifier'; name: 'x' }
  | { type: 'unary'; operator: '+' | '-'; operand: ArithmeticAst }
  | {
      type: 'binary';
      operator: '+' | '-' | '*' | '/';
      left: ArithmeticAst;
      right: ArithmeticAst;
    };
export type MathAst =
  | ArithmeticAst
  | { type: 'assignment'; name: 'x'; value: ArithmeticAst };
export type MathEnvironment = Readonly<{ x?: number }>;
export type MathEvaluation =
  | Evaluation
  | { status: 'unbound'; name: 'x' }
  | { status: 'variable-defined'; name: 'x'; value: number; display: string };
export type ParseOutcome =
  | Extract<Evaluation, { status: 'invalid' | 'incomplete' }>
  | {
      status: 'parsed';
      ast: MathAst;
      normalizedText: string;
      terminalEquals: boolean;
      dependencies: 'x'[];
    };
type Token = {
  kind: 'number' | 'x' | '=' | '+' | '-' | '*' | '/' | '(' | ')';
  location: number;
  value?: number;
  spelling: string;
};
class SyntaxFailure extends Error {
  constructor(
    readonly outcome: Extract<Evaluation, { status: 'invalid' | 'incomplete' }>,
  ) {
    super('Expression could not be parsed');
  }
}
function invalid(code: string, location: number): never {
  throw new SyntaxFailure({ status: 'invalid', code, location });
}
function incomplete(): never {
  throw new SyntaxFailure({ status: 'incomplete' });
}
function tokenize(text: string, variables: boolean): Token[] {
  const tokens: Token[] = [];
  let equals = false;
  for (let index = 0; index < text.length; ) {
    const character = text[index];
    if (/\s/u.test(character)) {
      index++;
      continue;
    }
    if (equals) invalid('unexpected-after-equals', index);
    if (character === '=' && !variables) {
      equals = true;
      index++;
      continue;
    }
    if (tokens.length >= MATH_LIMITS.tokens) invalid('too-many-tokens', index);
    if (/[0-9.]/u.test(character)) {
      const location = index;
      let decimals = 0,
        digits = 0;
      while (index < text.length && /[0-9.]/u.test(text[index])) {
        if (text[index] === '.') {
          if (++decimals > 1) invalid('duplicate-decimal', index);
        } else digits++;
        index++;
      }
      if (digits === 0) {
        if (index === text.trimEnd().length) incomplete();
        invalid('missing-decimal-digits', location);
      }
      const spelling = text.slice(location, index);
      tokens.push({
        kind: 'number',
        value: Number(spelling),
        location,
        spelling,
      });
      continue;
    }
    const canonical =
      ({ '×': '*', '÷': '/', '−': '-' } as Record<string, string>)[character] ??
      character;
    if (
      !['+', '-', '*', '/', '(', ')'].includes(canonical) &&
      !(variables && (canonical === 'x' || canonical === '='))
    )
      invalid('unknown-token', index);
    tokens.push({
      kind: canonical as Token['kind'],
      location: index++,
      spelling: canonical,
    });
  }
  return tokens;
}
/** JavaScript binary numbers, rendered to twelve significant digits. */
export function formatNumber(value: number): string {
  return Number(value.toPrecision(12)).toString();
}

/** One parser for V1 numeric compatibility and V2 notebook arithmetic/assignment. */
export function parseMath(text: string, variables = true): ParseOutcome {
  if (text.length > MATH_LIMITS.characters)
    return {
      status: 'invalid',
      code: 'too-long',
      location: MATH_LIMITS.characters,
    };
  try {
    const tokens = tokenize(text, variables);
    let index = 0;
    const assignment =
      variables && tokens[0]?.kind === 'x' && tokens[1]?.kind === '=';
    if (assignment) index = 2;
    const primary = (depth: number): ArithmeticAst => {
      const token = tokens[index];
      if (!token) incomplete();
      if (depth > MATH_LIMITS.nesting) invalid('too-deep', token.location);
      if (token.kind === '+' || token.kind === '-') {
        index++;
        return {
          type: 'unary',
          operator: token.kind,
          operand: primary(depth + 1),
        };
      }
      if (token.kind === 'number') {
        index++;
        return { type: 'number', value: token.value! };
      }
      if (token.kind === 'x') {
        index++;
        return { type: 'identifier', name: 'x' };
      }
      if (token.kind === '(') {
        index++;
        const value = sum(depth + 1),
          close = tokens[index];
        if (!close) incomplete();
        if (close.kind !== ')')
          invalid('expected-closing-parenthesis', close.location);
        index++;
        return value;
      }
      return invalid('expected-operand', token.location);
    };
    const product = (depth: number): ArithmeticAst => {
      let value = primary(depth);
      while (tokens[index]?.kind === '*' || tokens[index]?.kind === '/') {
        const operator = tokens[index++].kind as '*' | '/';
        value = {
          type: 'binary',
          operator,
          left: value,
          right: primary(depth),
        };
      }
      return value;
    };
    const sum = (depth: number): ArithmeticAst => {
      let value = product(depth);
      while (tokens[index]?.kind === '+' || tokens[index]?.kind === '-') {
        const operator = tokens[index++].kind as '+' | '-';
        value = {
          type: 'binary',
          operator,
          left: value,
          right: product(depth),
        };
      }
      return value;
    };
    const value = sum(0);
    let terminalEquals = !variables && text.trimEnd().endsWith('=');
    if (variables && tokens[index]?.kind === '=') {
      index++;
      terminalEquals = true;
      if (tokens[index])
        invalid('unexpected-after-equals', tokens[index].location);
    }
    if (tokens[index]) invalid('unexpected-token', tokens[index].location);
    const ast: MathAst = assignment
      ? { type: 'assignment', name: 'x', value }
      : value;
    return {
      status: 'parsed',
      ast,
      normalizedText: variables
        ? tokens.map((token) => token.spelling).join('')
        : tokens.map((token) => token.spelling).join('') +
          (terminalEquals ? '=' : ''),
      terminalEquals,
      dependencies: dependenciesOf(ast),
    };
  } catch (error) {
    if (error instanceof SyntaxFailure) return error.outcome;
    throw error;
  }
}

/** Iterative AST walk preserves long flat V1 expressions and bounds external AST work. */
function dependenciesOf(ast: MathAst): 'x'[] {
  const pending: MathAst[] = [ast];
  let count = 0,
    depends = false;
  while (pending.length) {
    if (++count > MATH_LIMITS.tokens) invalid('too-many-tokens', 0);
    const node = pending.pop()!;
    if (node.type === 'identifier') depends = true;
    else if (node.type === 'assignment') pending.push(node.value);
    else if (node.type === 'unary') pending.push(node.operand);
    else if (node.type === 'binary') pending.push(node.left, node.right);
  }
  return depends ? ['x'] : [];
}
export function evaluateAST(
  ast: MathAst,
  environment: MathEnvironment = {},
): MathEvaluation {
  try {
    if (ast.type === 'assignment' && dependenciesOf(ast).length)
      return { status: 'invalid', code: 'cyclic-definition', location: 0 };
    const root = ast.type === 'assignment' ? ast.value : ast;
    const stack: { node: ArithmeticAst; finish: boolean }[] = [
      { node: root, finish: false },
    ];
    const values: number[] = [];
    let count = 0,
      undefinedReason: string | undefined;
    const finite = (value: number) => {
      if (!Number.isFinite(value)) undefinedReason ??= 'non-finite-result';
      return value;
    };
    while (stack.length) {
      const { node, finish } = stack.pop()!;
      if (!finish && ++count > MATH_LIMITS.tokens)
        invalid('too-many-tokens', 0);
      if (node.type === 'number') values.push(finite(node.value));
      else if (node.type === 'identifier') {
        if (!Object.hasOwn(environment, 'x') || environment.x === undefined)
          return { status: 'unbound', name: 'x' };
        values.push(finite(environment.x));
      } else if (!finish) {
        stack.push({ node, finish: true });
        if (node.type === 'unary')
          stack.push({ node: node.operand, finish: false });
        else
          stack.push(
            { node: node.right, finish: false },
            { node: node.left, finish: false },
          );
      } else if (node.type === 'unary') {
        const value = values.pop()!;
        values.push(node.operator === '-' ? -value : value);
      } else {
        const right = values.pop()!,
          left = values.pop()!;
        if (node.operator === '/' && right === 0)
          undefinedReason ??= 'division-by-zero';
        values.push(
          finite(
            node.operator === '+'
              ? left + right
              : node.operator === '-'
                ? left - right
                : node.operator === '*'
                  ? left * right
                  : left / right,
          ),
        );
      }
    }
    if (undefinedReason)
      return {
        status: 'undefined',
        reason: undefinedReason,
        display: 'Undefined',
      };
    const value = values[0],
      display = formatNumber(value);
    return ast.type === 'assignment'
      ? { status: 'variable-defined', name: 'x', value, display }
      : { status: 'valid', value, display };
  } catch (error) {
    if (error instanceof SyntaxFailure) return error.outcome;
    throw error;
  }
}
/** Original numeric-only contract: x stays unsupported; terminal '=' remains optional. */
export function evaluateExpression(text: string): Evaluation {
  const parsed = parseMath(text, false);
  if (parsed.status !== 'parsed') return parsed;
  const outcome = evaluateAST(parsed.ast);
  if (outcome.status === 'unbound' || outcome.status === 'variable-defined')
    return { status: 'invalid', code: 'unknown-token', location: 0 };
  return outcome;
}

export interface NotebookEntry {
  id: string;
  text: string;
  state: 'recognized' | 'pending' | 'uncertain' | 'error';
}
export type NotebookOutcome =
  | MathEvaluation
  | {
      status: 'pending';
      reason?: 'definition-not-current';
      definitionId?: string;
    }
  | { status: 'uncertain' }
  | { status: 'unavailable'; reason: 'recognition-error' };
export interface NotebookResult {
  id: string;
  outcome: NotebookOutcome;
  ast: MathAst | null;
  normalizedText: string | null;
  dependencies: 'x'[];
  context: {
    x: number | null;
    definitionId: string | null;
    definesX: boolean;
    invalidatesX: boolean;
    blockedBy: string | null;
  };
}
/** Caller supplies deterministic reading order. Every call rebuilds the notebook environment. */
export function evaluateNotebook(entries: readonly NotebookEntry[]): {
  entries: NotebookResult[];
  environment: { x?: number };
  definitionId: string | null;
} {
  const environment: { x?: number } = {};
  let definitionId: string | null = null,
    blockedBy: string | null = null;
  const results: NotebookResult[] = [];
  for (const entry of entries) {
    const potentialDefinition =
      /^\s*x\s*=/u.test(entry.text) ||
      (entry.state !== 'recognized' &&
        (/^\s*x\s*$/u.test(entry.text) || !entry.text.trim()));
    const before = {
      x: environment.x ?? null,
      definitionId,
      definesX: potentialDefinition,
      invalidatesX: false,
      blockedBy,
    };
    const parsed = entry.state === 'recognized' ? parseMath(entry.text) : null;
    const definesX =
      potentialDefinition ||
      (parsed?.status === 'parsed' && parsed.ast.type === 'assignment');
    let outcome: NotebookOutcome;
    if (definesX) {
      delete environment.x;
      definitionId = null;
      blockedBy = entry.state === 'recognized' ? null : entry.id;
      before.invalidatesX = true;
    }
    if (entry.state !== 'recognized')
      outcome =
        entry.state === 'pending'
          ? { status: 'pending' }
          : entry.state === 'uncertain'
            ? { status: 'uncertain' }
            : { status: 'unavailable', reason: 'recognition-error' };
    else if (!parsed || parsed.status !== 'parsed')
      outcome = parsed ?? { status: 'incomplete' };
    else if (parsed.ast.type !== 'assignment' && !parsed.terminalEquals)
      outcome = { status: 'incomplete' };
    else if (!definesX && parsed.dependencies.length && blockedBy)
      outcome = {
        status: 'pending',
        reason: 'definition-not-current',
        definitionId: blockedBy,
      };
    else {
      outcome = evaluateAST(parsed.ast, environment);
      if (outcome.status === 'variable-defined') {
        environment.x = outcome.value;
        definitionId = entry.id;
        blockedBy = null;
      }
    }
    results.push({
      id: entry.id,
      outcome,
      ast: parsed?.status === 'parsed' ? parsed.ast : null,
      normalizedText:
        parsed?.status === 'parsed' ? parsed.normalizedText : null,
      dependencies: parsed?.status === 'parsed' ? parsed.dependencies : [],
      context: { ...before, definesX },
    });
  }
  return { entries: results, environment, definitionId };
}
