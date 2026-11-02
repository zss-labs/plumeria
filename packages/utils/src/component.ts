import type { Module } from '@swc/core';

const rendersStyle = (node: any): boolean => {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(rendersStyle);
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true;
  const callee = node.type === 'CallExpression' ? node.callee : undefined;
  if (
    (callee?.type === 'Identifier' && callee.value === 'use') ||
    (callee?.type === 'MemberExpression' &&
      callee.property?.type === 'Identifier' &&
      callee.property.value === 'use')
  )
    return true;
  return Object.keys(node).some(
    (key) => key !== 'span' && rendersStyle(node[key]),
  );
};

const isFunctionNode = (node: any) =>
  node?.type === 'FunctionDeclaration' ||
  node?.type === 'FunctionExpression' ||
  node?.type === 'ArrowFunctionExpression';

export type Wrapped = { fn: any } | { name: string } | 'ambiguous';

function wrappedComponent(call: any): Wrapped | undefined {
  const functions: any[] = [];
  const names: string[] = [];
  for (const arg of call.arguments ?? []) {
    const node = arg.expression;
    if (
      (node?.type === 'ArrowFunctionExpression' ||
        node?.type === 'FunctionExpression') &&
      node.params.some((p: any) => (p.pat ?? p).type !== 'RestElement') &&
      rendersStyle(node)
    ) {
      functions.push(node);
    } else if (node?.type === 'CallExpression') {
      const inner = wrappedComponent(node);
      if (inner === 'ambiguous') return inner;
      if (inner && 'fn' in inner) functions.push(inner.fn);
      else if (inner) names.push(inner.name);
    } else if (node?.type === 'Identifier' && /^\p{Lu}/u.test(node.value)) {
      names.push(node.value);
    }
  }
  if (functions.length === 1) return { fn: functions[0] };
  if (functions.length === 0 && names.length === 1) return { name: names[0] };
  if (functions.length === 0 && names.length === 0) return undefined;
  return 'ambiguous';
}

function componentFunctionOf(node: any): any {
  if (isFunctionNode(node)) return node;
  if (node?.type !== 'CallExpression') return undefined;
  const found = wrappedComponent(node);
  return found && found !== 'ambiguous' && 'fn' in found ? found.fn : undefined;
}

export function componentFunctions(
  ast: Module,
): Array<{ name: string; fn: any }> {
  const found: Array<{ name: string; fn: any }> = [];
  for (const statement of ast.body as any[]) {
    const node =
      statement.type === 'ExportDeclaration'
        ? statement.declaration
        : statement.type === 'ExportDefaultDeclaration'
          ? statement.decl
          : statement.type === 'ExportDefaultExpression'
            ? statement.expression
            : statement;
    if (isFunctionNode(node)) {
      found.push({ name: node.identifier?.value ?? 'default', fn: node });
    } else if (node?.type === 'CallExpression') {
      const fn = componentFunctionOf(node);
      if (fn) found.push({ name: 'default', fn });
    } else if (node?.type === 'VariableDeclaration') {
      for (const declarator of node.declarations) {
        if (declarator.id.type !== 'Identifier') continue;
        const fn = componentFunctionOf(declarator.init);
        if (fn) found.push({ name: declarator.id.value, fn });
      }
    }
  }
  return found;
}

export function wrappedBindings(
  ast: Module,
): Array<{ name: string; node: any; wrapped: Wrapped }> {
  const found: Array<{ name: string; node: any; wrapped: Wrapped }> = [];
  for (const statement of ast.body as any[]) {
    if (statement.type === 'ExportDefaultExpression') {
      const wrapped =
        statement.expression.type === 'CallExpression'
          ? wrappedComponent(statement.expression)
          : undefined;
      if (wrapped)
        found.push({ name: 'default', node: statement.expression, wrapped });
      continue;
    }
    const declaration =
      statement.type === 'ExportDeclaration'
        ? statement.declaration
        : statement;
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const declarator of declaration.declarations) {
      if (
        declarator.id.type !== 'Identifier' ||
        declarator.init?.type !== 'CallExpression'
      )
        continue;
      const wrapped = wrappedComponent(declarator.init);
      if (wrapped)
        found.push({
          name: declarator.id.value,
          node: declarator.init,
          wrapped,
        });
    }
  }
  return found;
}
