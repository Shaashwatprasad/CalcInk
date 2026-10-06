import type { Evaluation } from '../shared/types';

/** Shared V1 limits and numeric policy; all execution stays deterministic and local. */
export const MATH_LIMITS = {
  characters: 4096,
  tokens: 512,
  nesting: 64,
} as const;
export type ArithmeticAst =
  | { type: 'number'; value: number }
  | { type: 'identifier'; name: string }
  | { type: 'unary'; operator: '+' | '-'; operand: ArithmeticAst }
  | {
      type: 'binary';
      operator: '+' | '-' | '*' | '/';
      left: ArithmeticAst;
      right: ArithmeticAst;
    };
export type MathAst =
  | ArithmeticAst
  | { type: 'assignment'; name: string; value: ArithmeticAst };
export type MathEnvironment = Readonly<Record<string, number | undefined>>;
export type MathEvaluation =
  | Evaluation
  | { status: 'unbound'; name: string }
  | {
      status: 'variable-defined';
      name: string;
      value: number;
      display: string;
    };
export type ParseOutcome =
  | Extract<Evaluation, { status: 'invalid' | 'incomplete' }>
  | {
      status: 'parsed';
      ast: MathAst;
      normalizedText: string;
      terminalEquals: boolean;
      dependencies: string[];
    };
type Token = {
  kind: 'number' | 'identifier' | '=' | '+' | '-' | '*' | '/' | '(' | ')';
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
    if (variables && /[A-Za-z_]/u.test(character)) {
      const location = index++;
      while (index < text.length && /[A-Za-z0-9_]/u.test(text[index])) index++;
      tokens.push({
        kind: 'identifier',
        location,
        spelling: text.slice(location, index),
      });
      continue;
    }
    const canonical =
      ({ '×': '*', '÷': '/', '−': '-' } as Record<string, string>)[character] ??
      character;
    if (
      !['+', '-', '*', '/', '(', ')'].includes(canonical) &&
      !(variables && canonical === '=')
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
      variables && tokens[0]?.kind === 'identifier' && tokens[1]?.kind === '=';
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
      if (token.kind === 'identifier') {
        index++;
        return { type: 'identifier', name: token.spelling };
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
      ? { type: 'assignment', name: tokens[0].spelling, value }
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
function dependenciesOf(ast: MathAst): string[] {
  const pending: MathAst[] = [ast];
  let count = 0;
  const names = new Set<string>();
  while (pending.length) {
    if (++count > MATH_LIMITS.tokens) invalid('too-many-tokens', 0);
    const node = pending.pop()!;
    if (node.type === 'identifier') names.add(node.name);
    else if (node.type === 'assignment') pending.push(node.value);
    else if (node.type === 'unary') pending.push(node.operand);
    else if (node.type === 'binary') pending.push(node.left, node.right);
  }
  return [...names].sort();
}
export function evaluateAST(
  ast: MathAst,
  environment: MathEnvironment = {},
): MathEvaluation {
  try {
    if (ast.type === 'assignment' && dependenciesOf(ast).includes(ast.name))
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
        if (
          !Object.hasOwn(environment, node.name) ||
          environment[node.name] === undefined
        )
          return { status: 'unbound', name: node.name };
        values.push(finite(environment[node.name]!));
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
        display:
          undefinedReason === 'division-by-zero'
            ? 'Cannot divide by zero'
            : 'Undefined',
      };
    const value = values[0],
      display = formatNumber(value);
    return ast.type === 'assignment'
      ? { status: 'variable-defined', name: ast.name, value, display }
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
  dependencies: string[];
  /** The concrete preceding definitions this expression reads. */
  bindings: Record<string, string | null>;
  context: {
    x: number | null;
    definitionId: string | null;
    definesX: boolean;
    invalidatesX: boolean;
    blockedBy: string | null;
  };
}
export interface NotebookEvaluation {
  entries: NotebookResult[];
  environment: Record<string, number | undefined>;
  definitionId: string | null;
}
type Binding = { id: string; value?: number; blocked: boolean; key: number };
type CachedEntry = {
  text: string;
  parsed: ParseOutcome | null;
  key: string;
  result: NotebookResult;
  version: number;
};

/** Reading-order reconciliation is cheap; parsing and AST execution are cached per source.
 * Dependency keys identify the concrete preceding definition, including its own inputs.
 * A later redefinition therefore shields its consumers from edits to earlier definitions.
 */
export class NotebookEvaluator {
  private cache = new Map<string, CachedEntry>();
  private version = 0;
  private parseCount = 0;
  private evaluationCount = 0;
  get metrics(): { parseCount: number; evaluationCount: number } {
    return {
      parseCount: this.parseCount,
      evaluationCount: this.evaluationCount,
    };
  }
  resetMetrics(): void {
    this.parseCount = 0;
    this.evaluationCount = 0;
  }
  clear(): void {
    this.cache.clear();
    this.resetMetrics();
  }

  evaluate(entries: readonly NotebookEntry[]): NotebookEvaluation {
    const bindings = new Map<string, Binding>();
    let unknownBlocker: string | null = null;
    const results: NotebookResult[] = [];
    const currentIds = new Set<string>();
    for (const entry of entries) {
      currentIds.add(entry.id);
      const cached = this.cache.get(entry.id);
      let parsed = cached?.text === entry.text ? cached.parsed : null;
      if (entry.state === 'recognized' && !parsed) {
        parsed = parseMath(entry.text);
        this.parseCount++;
      }
      const definitionName =
        /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(entry.text)?.[1] ??
        (entry.state !== 'recognized'
          ? (/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/u.exec(entry.text)?.[1] ?? null)
          : null);
      const dependencies =
        parsed?.status === 'parsed' ? parsed.dependencies : [];
      const reads = dependencies.map((name) => {
        const binding = bindings.get(name);
        return [
          name,
          binding?.id ?? null,
          binding?.key ?? null,
          binding?.value ?? null,
          binding?.blocked ? binding.id : binding ? null : unknownBlocker,
        ];
      });
      const key = JSON.stringify([entry.text, entry.state, reads]);
      const blocked =
        dependencies
          .map((name) => {
            const binding = bindings.get(name);
            return binding?.blocked
              ? binding.id
              : binding
                ? null
                : unknownBlocker;
          })
          .find((id) => id !== null) ?? null;
      let result: NotebookResult;
      if (cached?.key === key) result = cached.result;
      else {
        let outcome: NotebookOutcome;
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
        else if (
          blocked &&
          !(
            parsed.ast.type === 'assignment' &&
            dependencies.includes(parsed.ast.name)
          )
        )
          outcome = {
            status: 'pending',
            reason: 'definition-not-current',
            definitionId: blocked,
          };
        else {
          const environment: Record<string, number | undefined> =
            Object.create(null);
          for (const name of dependencies)
            environment[name] = bindings.get(name)?.value;
          this.evaluationCount++;
          outcome = evaluateAST(parsed.ast, environment);
        }
        const x = dependencies.includes('x') ? bindings.get('x') : undefined;
        result = {
          id: entry.id,
          outcome,
          ast: parsed?.status === 'parsed' ? parsed.ast : null,
          normalizedText:
            parsed?.status === 'parsed' ? parsed.normalizedText : null,
          dependencies,
          bindings: Object.fromEntries(
            dependencies.map((name) => [name, bindings.get(name)?.id ?? null]),
          ),
          context: {
            x: x?.value ?? null,
            definitionId: x?.id ?? null,
            definesX: definitionName === 'x',
            invalidatesX: definitionName === 'x',
            blockedBy: blocked,
          },
        };
      }
      const version = cached?.key === key ? cached.version : ++this.version;
      this.cache.set(entry.id, {
        text: entry.text,
        parsed,
        key,
        result,
        version,
      });
      if (definitionName) {
        const outcome = result.outcome;
        bindings.set(definitionName, {
          id: entry.id,
          key: version,
          value:
            outcome.status === 'variable-defined' ? outcome.value : undefined,
          blocked: entry.state !== 'recognized' || outcome.status === 'pending',
        });
      } else if (entry.state !== 'recognized' && !entry.text.trim()) {
        unknownBlocker = entry.id;
        for (const [name] of bindings)
          bindings.set(name, { id: entry.id, key: version, blocked: true });
      }
      results.push(result);
    }
    for (const id of this.cache.keys())
      if (!currentIds.has(id)) this.cache.delete(id);
    const environment = Object.fromEntries(
      [...bindings]
        .filter(([, b]) => b.value !== undefined)
        .map(([name, b]) => [name, b.value]),
    );
    const x = bindings.get('x');
    return {
      entries: results,
      environment,
      definitionId: x?.value !== undefined ? x.id : null,
    };
  }
}
/** Stateless compatibility API; long-lived callers should retain NotebookEvaluator. */
export function evaluateNotebook(
  entries: readonly NotebookEntry[],
): NotebookEvaluation {
  return new NotebookEvaluator().evaluate(entries);
}
