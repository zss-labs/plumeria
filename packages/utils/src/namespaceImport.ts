import { parseSync } from '@swc/core';
import type { ImportDeclaration } from '@swc/core';
import { getLeadingCommentLength } from './ast';
import { exportNames } from './parser';
import { collectReferenceIdentifiers } from './references';
import { resolveImportPath } from './resolver';

export interface NamespaceImport {
  local: string;
  start: number;
  end: number;
  appendedStart: number;
  appendedEnd: number;
  unused: boolean;
  dots: number[];
  bindings: string[];
}

export interface Namespaces {
  source: string;
  originalLength: number;
  separated: boolean;
  imports: NamespaceImport[];
}

const NAMESPACE_IMPORT =
  /import\s*\*\s*as\s+([\p{L}\p{N}_$]+)\s*from\s*(['"])(.*?)\2/gu;

type Target = [path: string, actualPath: string, exports: string[]];

const cache = new Map<
  string,
  { source: string; targets: Target[]; namespaces: Namespaces | undefined }
>();
const LIMIT = 4096;

const sameTargets = (a: Target[], b: Target[]) =>
  a.length === b.length &&
  a.every(
    ([path, actualPath, exports], i) =>
      path === b[i][0] &&
      actualPath === b[i][1] &&
      exports.length === b[i][2].length &&
      exports.every((name, j) => name === b[i][2][j]),
  );

const NAME = '[\\p{L}\\p{N}_$]';

export function asWritten<T>(namespaces: Namespaces | undefined, error: T): T {
  if (!namespaces) return error;
  const restore = (text: string) => {
    for (const { local, bindings } of namespaces.imports)
      for (const binding of bindings) {
        const pattern = new RegExp(
          `(?<!${NAME})${binding.replace(/\$/g, '\\$')}(?!${NAME})`,
          'gu',
        );
        const dotted = `${local}.${binding.slice(local.length + 1)}`;
        text = text.replace(pattern, () => dotted);
      }
    return text;
  };
  if (typeof error === 'string') return restore(error) as T;
  if (error instanceof Error) {
    error.message = restore(error.message);
    if (error.stack) error.stack = restore(error.stack);
  }
  return error;
}

const unwrap = (node: any): any => {
  while (node?.type === 'ParenthesisExpression') node = node.expression;
  return node;
};

export function expandNamespaces(
  filePath: string,
  source: string,
): Namespaces | undefined {
  const targets: Target[] = [];
  for (const [, local, , path] of source.matchAll(NAMESPACE_IMPORT)) {
    if (
      path === '@plumeria/core' ||
      !source.includes(`${local}.`) ||
      targets.some(([seen]) => seen === path)
    )
      continue;
    const actualPath = resolveImportPath(path, filePath);
    if (!actualPath) continue;
    const exports = exportNames(actualPath);
    if (exports.length > 0) targets.push([path, actualPath, exports]);
  }
  if (targets.length === 0) return undefined;
  const cached = cache.get(filePath);
  if (
    cached &&
    cached.source === source &&
    sameTargets(cached.targets, targets)
  )
    return cached.namespaces;
  const namespaces = expand(source, targets);
  if (cache.size >= LIMIT) cache.clear();
  cache.set(filePath, { source, targets, namespaces });
  return namespaces;
}

function expand(source: string, resolved: Target[]): Namespaces | undefined {
  let ast;
  try {
    ast = parseSync(source, {
      syntax: 'typescript',
      tsx: true,
      target: 'es2022',
    });
  } catch {
    return undefined;
  }
  const buffer = Buffer.from(source, 'utf-8');
  const leadingBytes = Buffer.byteLength(
    source.slice(0, getLeadingCommentLength(source)),
    'utf-8',
  );
  const base = ast.span.start - leadingBytes;

  const targets = new Map<
    string,
    { decl: ImportDeclaration; exports: Set<string> }
  >();
  for (const statement of ast.body) {
    if (statement.type !== 'ImportDeclaration' || statement.typeOnly) continue;
    const specifier = statement.specifiers[0];
    if (specifier?.type !== 'ImportNamespaceSpecifier') continue;
    const target = resolved.find(([path]) => path === statement.source.value);
    if (!target) continue;
    targets.set(specifier.local.value, {
      decl: statement,
      exports: new Set(target[2]),
    });
  }
  if (targets.size === 0) return undefined;

  const { names: references } = collectReferenceIdentifiers(ast, {
    runtimeReads: true,
  });
  const kept = new Set<string>();
  const found: Array<{
    local: string;
    name: string;
    object: any;
    key: string;
  }> = [];
  const keyOf = (node: any) => `${node.span.start}:${node.span.end}`;
  const keep = (node: any) => {
    node = unwrap(node);
    if (node?.type === 'MemberExpression') kept.add(keyOf(node));
  };

  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    switch (n.type) {
      case 'CallExpression':
        keep(n.callee);
        break;
      case 'TaggedTemplateExpression':
        keep(n.tag);
        break;
      case 'AssignmentExpression':
      case 'AssignmentPattern':
      case 'ForInStatement':
      case 'ForOfStatement':
        keep(n.left);
        break;
      case 'UpdateExpression':
      case 'RestElement':
        keep(n.argument);
        break;
      case 'UnaryExpression':
        if (n.operator === 'delete') keep(n.argument);
        break;
      case 'ArrayPattern':
        n.elements?.forEach(keep);
        break;
      case 'KeyValuePatternProperty':
        keep(n.value);
        break;
      case 'MemberExpression': {
        const { object, property } = n;
        const target =
          object?.type === 'Identifier' ? targets.get(object.value) : undefined;
        if (
          target &&
          references.get(object.span.start) === object.value &&
          property?.type === 'Identifier' &&
          target.exports.has(property.value)
        ) {
          found.push({
            local: object.value,
            name: property.value,
            object,
            key: keyOf(n),
          });
        }
        break;
      }
    }
    for (const key in n) {
      if (key === 'span') continue;
      walk(n[key]);
    }
  };
  ast.body.forEach(walk);

  const rewritten = new Set<number>();
  const names = new Map<string, string[]>();
  const dots = new Map<string, number[]>();
  const taken = new Map<string, boolean>();
  const isTaken = (binding: string) => {
    let hit = taken.get(binding);
    if (hit === undefined) taken.set(binding, (hit = source.includes(binding)));
    return hit;
  };
  for (const { local, name, object, key } of found) {
    const dot = object.span.end - base;
    if (
      kept.has(key) ||
      buffer[dot] !== 0x2e ||
      buffer.subarray(dot + 1, dot + 1 + Buffer.byteLength(name)).toString() !==
        name ||
      isTaken(`${local}$${name}`)
    ) {
      continue;
    }
    buffer[dot] = 0x24;
    rewritten.add(object.span.start);
    const list = names.get(local) ?? [];
    if (!list.includes(name)) list.push(name);
    names.set(local, list);
    const at = dots.get(local) ?? [];
    at.push(dot);
    dots.set(local, at);
  }
  if (names.size === 0) return undefined;

  let output = buffer.toString('utf-8');
  const originalLength = buffer.length;
  const separated = !output.endsWith('\n');
  if (separated) output += '\n';
  let length = Buffer.byteLength(output);
  const imports: NamespaceImport[] = [];
  const locals = [...names.keys()].sort(
    (a, b) => targets.get(a)!.decl.span.start - targets.get(b)!.decl.span.start,
  );
  for (const local of locals) {
    const { decl } = targets.get(local)!;
    const raw = buffer
      .subarray(decl.source.span.start - base, decl.source.span.end - base)
      .toString('utf-8');
    const specifiers = names
      .get(local)!
      .map((name) => `${name} as ${local}$${name}`)
      .join(', ');
    const statement = `import { ${specifiers} } from ${raw};`;
    output += statement;
    const appendedStart = length;
    length += Buffer.byteLength(statement);
    const unused = [...references].every(
      ([start, name]) => name !== local || rewritten.has(start),
    );
    imports.push({
      local,
      start: decl.span.start - base,
      end: decl.span.end - base,
      appendedStart,
      appendedEnd: length,
      unused,
      dots: dots.get(local)!,
      bindings: names.get(local)!.map((name) => `${local}$${name}`),
    });
  }
  return { source: output, originalLength, separated, imports };
}
