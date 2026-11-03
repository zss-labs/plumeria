import type { Rule, Scope } from 'eslint';
import type { MemberExpression, Node, Program } from 'estree';
import { resolveStyleProp, stylePropSchema } from '../util/style-prop';

const CORE = '@plumeria/core';
const MAX_DEPTH = 4;
const SCRIPT = /\.[cm]?[jt]sx?$/;
const WRAPPERS = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'ParenthesizedExpression',
]);

type CoreNames = { namespaces: Set<string>; uses: Set<string> };

const unwrap = (node: any): any => {
  while (node && WRAPPERS.has(node.type)) node = node.expression;
  return node;
};

const keyOf = (node: MemberExpression): string | null =>
  !node.computed && node.property.type === 'Identifier'
    ? node.property.name
    : node.computed && node.property.type === 'Literal'
      ? String(node.property.value)
      : null;

const propertyKey = (property: any): string | null =>
  property.type !== 'Property' || property.computed
    ? null
    : property.key.type === 'Identifier'
      ? property.key.name
      : property.key.type === 'Literal'
        ? String(property.key.value)
        : null;

const coreNames = (program: Program): CoreNames => {
  const names: CoreNames = { namespaces: new Set(), uses: new Set() };
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    if (statement.source.value !== CORE) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportSpecifier') {
        const imported =
          specifier.imported.type === 'Identifier'
            ? specifier.imported.name
            : String(specifier.imported.value);
        if (imported === 'use') names.uses.add(specifier.local.name);
      } else {
        names.namespaces.add(specifier.local.name);
      }
    }
  }
  return names;
};

const findVariable = (scope: Scope.Scope | null, name: string) => {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return undefined;
};

export const noUseInJsx: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow css.use() in JSX, where the styling prop applies styles',
    },
    schema: stylePropSchema,
    messages: {
      jsx: 'css.use() is for templates that are not JSX. Apply the styles with {{styleProp}} instead.',
    },
  },
  create(context) {
    if (!SCRIPT.test(context.filename)) return {};
    const styleProp = resolveStyleProp(context);
    let names: CoreNames = { namespaces: new Set(), uses: new Set() };

    const isUseCall = (node: any): boolean => {
      node = unwrap(node);
      if (node?.type !== 'CallExpression') return false;
      const callee = node.callee;
      return callee.type === 'MemberExpression'
        ? callee.object.type === 'Identifier' &&
            names.namespaces.has(callee.object.name) &&
            keyOf(callee) === 'use'
        : callee.type === 'Identifier' && names.uses.has(callee.name);
    };

    const carriesUse = (
      node: any,
      member: string | null,
      scope: Scope.Scope,
      depth: number,
    ): boolean => {
      node = unwrap(node);
      if (!node || depth > MAX_DEPTH) return false;
      if (member === null && isUseCall(node)) return true;
      if (node.type === 'MemberExpression') {
        const key = keyOf(node);
        return key !== null && carriesUse(node.object, key, scope, depth + 1);
      }
      if (node.type === 'ObjectExpression') {
        if (member === null) return false;
        return node.properties.some(
          (property: any) =>
            propertyKey(property) === member &&
            carriesUse(property.value, null, scope, depth + 1),
        );
      }
      if (node.type !== 'Identifier') return false;
      const definition = findVariable(scope, node.name)?.defs[0];
      if (
        definition?.type !== 'Variable' ||
        definition.parent?.kind !== 'const' ||
        !(definition.node as any).init
      )
        return false;
      return carriesUse(
        (definition.node as any).init,
        member,
        context.sourceCode.getScope(definition.node),
        depth + 1,
      );
    };

    const references = (node: any, found: Node[]): Node[] => {
      node = unwrap(node);
      if (!node) return found;
      switch (node.type) {
        case 'Identifier':
        case 'MemberExpression':
          found.push(node);
          break;
        case 'ConditionalExpression':
          references(node.consequent, found);
          references(node.alternate, found);
          break;
        case 'LogicalExpression':
        case 'BinaryExpression':
          references(node.left, found);
          references(node.right, found);
          break;
        case 'ArrayExpression':
          node.elements.forEach((element: any) => references(element, found));
          break;
        case 'TemplateLiteral':
          node.expressions.forEach((expression: any) =>
            references(expression, found),
          );
          break;
        case 'ObjectExpression':
          node.properties.forEach((property: any) =>
            references(
              property.type === 'SpreadElement'
                ? property.argument
                : property.value,
              found,
            ),
          );
          break;
        case 'CallExpression':
          node.arguments.forEach((argument: any) =>
            references(argument, found),
          );
          break;
        case 'SpreadElement':
          references(node.argument, found);
          break;
      }
      return found;
    };

    const inJsx = (node: Node) =>
      context.sourceCode
        .getAncestors(node)
        .some(
          (ancestor: any) =>
            ancestor.type === 'JSXElement' || ancestor.type === 'JSXFragment',
        );

    const report = (node: Node) =>
      context.report({ node, messageId: 'jsx', data: { styleProp } });

    const checkContainer = (expression: any) => {
      if (!expression || expression.type === 'JSXEmptyExpression') return;
      const scope = context.sourceCode.getScope(expression);
      for (const reference of references(expression, [])) {
        if (carriesUse(reference, null, scope, 0)) report(reference);
      }
    };

    return {
      Program(node: Program) {
        names = coreNames(node);
      },
      CallExpression(node) {
        if (isUseCall(node) && inJsx(node)) report(node);
      },
      JSXExpressionContainer(node: any) {
        checkContainer(node.expression);
      },
      JSXSpreadAttribute(node: any) {
        checkContainer(node.argument);
      },
    } as Rule.RuleListener;
  },
};
