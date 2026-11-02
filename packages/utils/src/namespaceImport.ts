import type {
  ImportDeclaration,
  ImportNamespaceSpecifier,
  Module,
} from '@swc/core';
import { exportNames } from './parser';
import { collectReferenceIdentifiers } from './references';
import { resolveImportPath } from './resolver';

const unwrap = (node: any): any => {
  while (node?.type === 'ParenthesisExpression') node = node.expression;
  return node;
};

export function resolveNamespaceMembers(ast: Module, filePath: string): void {
  const targets = new Map<
    string,
    {
      decl: ImportDeclaration;
      specifier: ImportNamespaceSpecifier;
      actualPath: string;
      exports?: Set<string>;
    }
  >();
  for (const statement of ast.body) {
    if (
      statement.type !== 'ImportDeclaration' ||
      statement.typeOnly ||
      statement.source.value === '@plumeria/core'
    )
      continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportNamespaceSpecifier') continue;
      const actualPath = resolveImportPath(statement.source.value, filePath);
      if (actualPath)
        targets.set(specifier.local.value, {
          decl: statement,
          specifier,
          actualPath,
        });
    }
  }
  if (targets.size === 0) return;

  const { names: references } = collectReferenceIdentifiers(ast, {
    runtimeReads: true,
  });
  const exports = (local: string, name: string) => {
    const target = targets.get(local);
    if (!target) return false;
    target.exports ??= new Set(exportNames(target.actualPath));
    return target.exports.has(name);
  };
  const kept = new Set<any>();
  const found: any[] = [];
  const keep = (node: any) => {
    node = unwrap(node);
    if (node?.type === 'MemberExpression') kept.add(node);
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
      case 'OptionalChainingExpression':
        keep(n.base);
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
        if (
          object?.type === 'Identifier' &&
          property?.type === 'Identifier' &&
          references.get(object.span.start) === object.value &&
          exports(object.value, property.value)
        )
          found.push(n);
        break;
      }
    }
    for (const key in n) {
      if (key === 'span') continue;
      walk(n[key]);
    }
  };
  ast.body.forEach(walk);

  const bindings = new Map<string, Set<string>>();
  for (const member of found) {
    if (kept.has(member)) continue;
    const { object, property, span } = member;
    const local: string = object.value;
    const name: string = property.value;
    for (const key of Object.keys(member)) delete member[key];
    Object.assign(member, {
      type: 'Identifier',
      span,
      value: `${local}.${name}`,
      optional: false,
    });
    const names = bindings.get(local) ?? new Set<string>();
    names.add(name);
    bindings.set(local, names);
  }
  for (const [local, names] of bindings) {
    const { decl, specifier } = targets.get(local)!;
    const identifier = (value: string) => ({
      type: 'Identifier' as const,
      span: specifier.local.span,
      value,
      optional: false,
    });
    for (const name of names)
      decl.specifiers.push({
        type: 'ImportSpecifier',
        span: specifier.span,
        local: identifier(`${local}.${name}`),
        imported: identifier(name),
        isTypeOnly: false,
      });
  }
}
