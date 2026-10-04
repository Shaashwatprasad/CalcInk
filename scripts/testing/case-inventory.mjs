import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function testFiles(directory, suffix) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? testFiles(path, suffix)
        : path.endsWith(suffix)
          ? [path]
          : [];
    })
    .sort();
}

/** Source-derived selected browser cases, independent of child-runner claims. */
export function browserCaseInventory(directory, includeV2 = false) {
  const inventory = [];
  for (const path of testFiles(directory, '.spec.ts')) {
    const tree = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'test'
      ) {
        const title = node.arguments[0];
        if (!title || !ts.isStringLiteral(title))
          throw new Error(`Browser test needs static identity: ${path}`);
        if (includeV2 || !title.text.includes('@v2-required'))
          inventory.push(title.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  if (!inventory.length || new Set(inventory).size !== inventory.length)
    throw new Error(
      'Selected browser case identities are missing or ambiguous',
    );
  return inventory.sort();
}

export function deterministicCaseInventory(directories) {
  return directories
    .flatMap((directory) => testFiles(directory, '.test.ts'))
    .map((path) => {
      const declarations = [];
      const tree = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node) => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const plain =
            ts.isIdentifier(callee) && ['it', 'test'].includes(callee.text);
          const parameterized =
            ts.isCallExpression(callee) &&
            ts.isPropertyAccessExpression(callee.expression) &&
            ts.isIdentifier(callee.expression.expression) &&
            ['it', 'test'].includes(callee.expression.expression.text) &&
            callee.expression.name.text === 'each';
          if (plain || parameterized) {
            const title = node.arguments[0];
            if (!title || !ts.isStringLiteral(title))
              throw new Error(
                `Deterministic test needs static identity: ${path}`,
              );
            let table = parameterized ? callee.arguments[0] : undefined;
            while (
              table &&
              (ts.isAsExpression(table) ||
                ts.isParenthesizedExpression(table) ||
                ts.isSatisfiesExpression(table))
            )
              table = table.expression;
            if (
              parameterized &&
              (!table || !ts.isArrayLiteralExpression(table))
            )
              throw new Error(
                `Parameterized case inventory needs a literal table: ${path}`,
              );
            declarations.push({
              title: title.text,
              minimum: parameterized ? table.elements.length : 1,
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
      if (!declarations.length)
        throw new Error(`No deterministic cases declared: ${path}`);
      return { path, declarations };
    });
}

export function validateDeterministicInventory(data, inventory) {
  for (const file of inventory) {
    const actual = (data.testResults ?? []).find((result) =>
      result.name.endsWith(`/${file.path}`),
    );
    if (!actual)
      return `Required deterministic test file missing: ${file.path}`;
    const identities = (actual.assertionResults ?? []).map(
      (item) => item.fullName ?? item.title,
    );
    if (new Set(identities).size !== identities.length)
      return `Duplicate deterministic case identity: ${file.path}`;
    for (const declaration of file.declarations) {
      const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matcher = new RegExp(
        '^' +
          declaration.title
            .split(/%[sdifjo#]|\$[\w.]+/u)
            .map(escape)
            .join('.*') +
          '$',
        'su',
      );
      const matches = (actual.assertionResults ?? []).filter((result) =>
        matcher.test(result.title),
      );
      if (matches.length < declaration.minimum)
        return `Required deterministic cases missing: ${file.path}: ${declaration.title}`;
    }
  }
}

export function canonicalCaseInventory(path) {
  const tree = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const inventory = [];
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(tree) === 'checks' &&
      ts.isObjectLiteralExpression(node.initializer)
    )
      inventory.push(
        ...node.initializer.properties.map((property) => {
          if (!ts.isPropertyAssignment(property))
            throw new Error('Canonical checks require explicit identities');
          return property.name.getText(tree).replace(/^['"]|['"]$/g, '');
        }),
      );
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!inventory.length || new Set(inventory).size !== inventory.length)
    throw new Error('Canonical check inventory missing or ambiguous');
  return inventory.sort();
}
