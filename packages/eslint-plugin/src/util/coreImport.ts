import type { Rule, Scope } from 'eslint';
import type { Identifier, MemberExpression, Node } from 'estree';

export const memberName = (node: MemberExpression) =>
  !node.computed && node.property.type === 'Identifier'
    ? node.property.name
    : node.computed && node.property.type === 'Literal'
      ? node.property.value
      : null;

export function variableOf(
  context: Rule.RuleContext,
  node: Identifier,
): Scope.Variable | null {
  let scope: Scope.Scope | null = context.sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

export function importedFromCore(
  context: Rule.RuleContext,
  node: Node,
  name: string,
): boolean {
  if (node.type !== 'Identifier') return false;
  const variable = variableOf(context, node);
  if (!variable) return false;
  return variable.defs.some((def) => {
    if (
      def.type !== 'ImportBinding' ||
      def.parent.source.value !== '@plumeria/core'
    )
      return false;
    const specifier = def.node;
    return name === '*'
      ? specifier.type === 'ImportNamespaceSpecifier' ||
          specifier.type === 'ImportDefaultSpecifier'
      : specifier.type === 'ImportSpecifier' &&
          (specifier.imported.type === 'Identifier'
            ? specifier.imported.name
            : specifier.imported.value) === name;
  });
}

export function callsCore(
  context: Rule.RuleContext,
  node: Node,
  name: string,
): boolean {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  return callee.type === 'MemberExpression'
    ? memberName(callee) === name &&
        importedFromCore(context, callee.object, '*')
    : importedFromCore(context, callee, name);
}
