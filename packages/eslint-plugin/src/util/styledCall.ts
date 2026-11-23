import type { Rule } from 'eslint';
import type { Node, ObjectExpression } from 'estree';
import { variableOf } from './coreImport';

const REACT = '@plumeria/react';

function importedStyled(context: Rule.RuleContext, node: Node): boolean {
  if (node.type !== 'Identifier') return false;
  const variable = variableOf(context, node);
  if (!variable) return false;
  return variable.defs.some((def) => {
    if (def.type !== 'ImportBinding' || def.parent.source.value !== REACT)
      return false;
    const specifier = def.node;
    return (
      specifier.type === 'ImportSpecifier' &&
      (specifier.imported.type === 'Identifier'
        ? specifier.imported.name
        : specifier.imported.value) === 'styled'
    );
  });
}

export function styledRule(
  context: Rule.RuleContext,
  node: Node,
): ObjectExpression | null {
  if (node.type !== 'CallExpression') return null;
  const callee = node.callee;
  const styled =
    callee.type === 'MemberExpression'
      ? !callee.computed && importedStyled(context, callee.object)
      : callee.type === 'CallExpression' &&
        importedStyled(context, callee.callee);
  if (!styled) return null;
  const rule = node.arguments[0];
  return rule?.type === 'ObjectExpression' ? rule : null;
}
