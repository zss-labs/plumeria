import type { Module } from '@swc/core';

export const MODULE_SITE = -1;

export type DeclSite = {
  at: number;
  bodyEnd?: number;
  afterDirective?: boolean;
  module?: boolean;
};

export const insertions = (
  site: DeclSite,
  names: string[],
): Array<[number, string]> => {
  const list = names.join(', ');
  if (site.bodyEnd !== undefined)
    return [
      [site.at, `{ let ${list}; return `],
      [site.bodyEnd, '; }'],
    ];
  if (site.module && site.at === 0) return [[site.at, `var ${list};\n`]];
  if (site.module) return [[site.at, `\nvar ${list};`]];
  if (site.afterDirective) return [[site.at, `\nlet ${list};`]];
  return [[site.at, ` let ${list};`]];
};

const directiveEnd = (statements: any[]): number | undefined => {
  let end: number | undefined;
  for (const statement of statements) {
    if (
      statement.type !== 'ExpressionStatement' ||
      statement.expression.type !== 'StringLiteral'
    )
      break;
    end = statement.span.end;
  }
  return end;
};

const isFunction = (node: any) =>
  node.type === 'Constructor' ||
  node.type === 'GetterProperty' ||
  node.type === 'SetterProperty' ||
  (node.type !== 'ArrowFunctionExpression' &&
    Array.isArray(node.params) &&
    'generator' in node &&
    'async' in node);

const paramsOf = (node: any): any[] =>
  node.type === 'SetterProperty' ? [node.param] : (node.params ?? []);

const walk = (node: any, visit: (node: any) => void) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (node.span) visit(node);
  for (const key in node) if (key !== 'span') walk(node[key], visit);
};

export const collectDeclSites = (
  ast: Module,
  source: string,
  offset: number,
): Map<number, DeclSite> => {
  const sites = new Map<number, DeclSite>();
  const body = (block: any): DeclSite => {
    const end = directiveEnd(block.stmts);
    return end === undefined
      ? { at: block.span.start + 1 - offset }
      : { at: end - offset, afterDirective: true };
  };
  const directive = directiveEnd(ast.body);
  const hashbang = source.startsWith('#!')
    ? Buffer.byteLength(source.split(/[\r\n]/, 1)[0])
    : undefined;
  sites.set(MODULE_SITE, {
    at: directive !== undefined ? directive - offset : (hashbang ?? 0),
    module: true,
  });
  walk(ast, (node) => {
    if (node.type === 'StaticBlock') {
      const first = node.body.stmts[0];
      if (first) sites.set(node.span.start, { at: first.span.start - offset });
    } else if (node.type === 'ArrowFunctionExpression') {
      sites.set(
        node.span.start,
        node.body.type === 'BlockStatement'
          ? body(node.body)
          : {
              at: node.body.span.start - offset,
              bodyEnd: node.body.span.end - offset,
            },
      );
    } else if (isFunction(node) && node.body) {
      sites.set(node.span.start, body(node.body));
    }
  });
  return sites;
};

type Scope = { start: number; end: number; site: number | null };

export const collectSiteScopes = (
  ast: Module,
): ((position: number) => number | null) => {
  const scopes: Scope[] = [];
  walk(ast, (node) => {
    const own = (site: number | null) =>
      scopes.push({ start: node.span.start, end: node.span.end, site });
    if (
      node.type === 'ClassProperty' ||
      node.type === 'PrivateProperty' ||
      node.type === 'AutoAccessor'
    )
      return own(null);
    if (node.type === 'StaticBlock') return own(node.span.start);
    if (node.type !== 'ArrowFunctionExpression' && !isFunction(node)) return;
    own(node.span.start);
    const params = paramsOf(node).filter(Boolean);
    if (params.length)
      scopes.push({
        start: params[0].span.start,
        end: params[params.length - 1].span.end,
        site: null,
      });
  });
  return (position) => {
    let inner: Scope | undefined;
    for (const scope of scopes) {
      if (position < scope.start || position >= scope.end) continue;
      if (
        !inner ||
        scope.start > inner.start ||
        (scope.start === inner.start && scope.end < inner.end)
      )
        inner = scope;
    }
    return inner ? inner.site : MODULE_SITE;
  };
};

const NAMES = new Set(['key', 'property', 'label', 'imported', 'exported']);

export const usesReservedName = (ast: Module): boolean => {
  let found = false;
  const visit = (node: any, parent: any, field: string) => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parent, field);
      return;
    }
    if (
      node.type === 'Identifier' &&
      !(NAMES.has(field) && parent?.type !== 'AssignmentPatternProperty') &&
      !(field === 'name' && parent?.type === 'JSXAttribute') &&
      String(node.value).startsWith('__plumeria_')
    ) {
      found = true;
      return;
    }
    for (const key in node) if (key !== 'span') visit(node[key], node, key);
  };
  visit(ast, null, '');
  return found;
};
