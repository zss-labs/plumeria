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

export type Wrapped =
  | { fn: any }
  | { name: string }
  | { source: string; name: string }
  | 'ambiguous';

const unwrapParens = (node: any): any =>
  node?.type === 'ParenthesisExpression' ? unwrapParens(node.expression) : node;

type React = { lazy: string[]; namespaces: string[] };

const NO_REACT: React = { lazy: [], namespaces: [] };

function reactOf(ast: Module): React {
  const react: React = { lazy: [], namespaces: [] };
  for (const node of ast.body as any[]) {
    if (
      node.type !== 'ImportDeclaration' ||
      node.source.value !== 'react' ||
      node.typeOnly
    )
      continue;
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        if (!spec.isTypeOnly && (spec.imported ?? spec.local).value === 'lazy')
          react.lazy.push(spec.local.value);
      } else {
        react.namespaces.push(spec.local.value);
      }
    }
  }
  return react;
}

function isLazy(callee: any, react: React): boolean {
  const node = unwrapParens(callee);
  if (node?.type === 'Identifier') return react.lazy.includes(node.value);
  return (
    node?.type === 'MemberExpression' &&
    node.property.type === 'Identifier' &&
    node.property.value === 'lazy' &&
    node.object.type === 'Identifier' &&
    react.namespaces.includes(node.object.value)
  );
}

function returned(fn: any): any {
  const node = unwrapParens(fn);
  if (
    node?.type !== 'ArrowFunctionExpression' &&
    node?.type !== 'FunctionExpression'
  )
    return undefined;
  if (node.body?.type !== 'BlockStatement') return unwrapParens(node.body);
  const [statement, ...rest] = node.body.stmts;
  return statement?.type === 'ReturnStatement' && rest.length === 0
    ? unwrapParens(statement.argument)
    : undefined;
}

const importSource = (node: any): string | undefined => {
  const call = unwrapParens(node);
  return call?.type === 'CallExpression' &&
    call.callee.type === 'Import' &&
    call.arguments[0]?.expression.type === 'StringLiteral'
    ? call.arguments[0].expression.value
    : undefined;
};

function picked(pick: any): string | undefined {
  const params = unwrapParens(pick)?.params;
  const module = params?.length === 1 ? (params[0].pat ?? params[0]) : null;
  if (module?.type !== 'Identifier') return undefined;
  const object = returned(pick);
  if (object?.type !== 'ObjectExpression' || object.properties.length !== 1)
    return undefined;
  const [entry] = object.properties;
  const key = entry.key;
  return entry.type === 'KeyValueProperty' &&
    (key.type === 'Identifier' || key.type === 'StringLiteral') &&
    key.value === 'default' &&
    entry.value.type === 'MemberExpression' &&
    entry.value.object.type === 'Identifier' &&
    entry.value.object.value === module.value &&
    entry.value.property.type === 'Identifier'
    ? entry.value.property.value
    : undefined;
}

function loaded(node: any): { source: string; name: string } | undefined {
  const direct = importSource(node);
  if (direct !== undefined) return { source: direct, name: 'default' };
  if (
    node?.type !== 'CallExpression' ||
    node.callee.type !== 'MemberExpression' ||
    node.callee.property.type !== 'Identifier' ||
    node.callee.property.value !== 'then' ||
    node.arguments.length !== 1
  )
    return undefined;
  const source = importSource(node.callee.object);
  const name = source && picked(node.arguments[0].expression);
  return source && name ? { source, name } : undefined;
}

function wrappedComponent(call: any, react: React): Wrapped | undefined {
  if (isLazy(call.callee, react)) {
    const loader = call.arguments[0];
    return loader && !loader.spread
      ? loaded(returned(loader.expression))
      : undefined;
  }
  const functions: any[] = [];
  const names: Wrapped[] = [];
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
      const inner = wrappedComponent(node, react);
      if (inner === 'ambiguous') return inner;
      if (inner && 'fn' in inner) functions.push(inner.fn);
      else if (inner) names.push(inner);
    } else if (node?.type === 'Identifier' && /^\p{Lu}/u.test(node.value)) {
      names.push({ name: node.value });
    }
  }
  if (functions.length === 1) return { fn: functions[0] };
  if (functions.length === 0 && names.length === 1) return names[0];
  if (functions.length === 0 && names.length === 0) return undefined;
  return 'ambiguous';
}

function componentFunctionOf(node: any): any {
  if (isFunctionNode(node)) return node;
  if (node?.type !== 'CallExpression') return undefined;
  const found = wrappedComponent(node, NO_REACT);
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
  const react = reactOf(ast);
  const found: Array<{ name: string; node: any; wrapped: Wrapped }> = [];
  for (const statement of ast.body as any[]) {
    if (statement.type === 'ExportDefaultExpression') {
      const wrapped =
        statement.expression.type === 'CallExpression'
          ? wrappedComponent(statement.expression, react)
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
      const wrapped = wrappedComponent(declarator.init, react);
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
