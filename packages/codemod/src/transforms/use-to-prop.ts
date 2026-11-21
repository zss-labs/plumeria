/**
 * @fileoverview Move className={css.use(...)} onto the styling prop
 */

import type { Rule } from 'eslint';

export interface UseToPropOptions {
  prop: string;
}

const CORE = '@plumeria/core';

export const useToProp: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Rewrite className={css.use(...)} to the styling prop',
    },
    fixable: 'code',
    messages: {
      rewrite: 'Rewrite className={css.use(...)} to "{{prop}}".',
      manual:
        'css.use() is not the whole className here. Move it to "{{prop}}" by hand.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          prop: { type: 'string' },
        },
        required: ['prop'],
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const { prop } = context.options[0] as UseToPropOptions;
    const { sourceCode } = context;
    const importOf = (node: any, name: string): any => {
      let scope: any = sourceCode.getScope(node);
      while (scope) {
        const variable = scope.set.get(name);
        if (variable) {
          const def = variable.defs[0];
          if (def?.type !== 'ImportBinding') return null;
          return def.parent.source.value === CORE ? def.node : null;
        }
        scope = scope.upper;
      }
      return null;
    };

    const isUseCall = (node: any): boolean => {
      const { callee } = node;
      if (callee.type === 'Identifier') {
        const specifier = importOf(node, callee.name);
        return (
          specifier?.type === 'ImportSpecifier' &&
          specifier.imported.type === 'Identifier' &&
          specifier.imported.name === 'use'
        );
      }
      if (
        callee.type !== 'MemberExpression' ||
        callee.computed ||
        callee.object.type !== 'Identifier' ||
        callee.property.type !== 'Identifier' ||
        callee.property.name !== 'use'
      ) {
        return false;
      }
      const specifier = importOf(node, callee.object.name);
      return (
        specifier?.type === 'ImportNamespaceSpecifier' ||
        specifier?.type === 'ImportDefaultSpecifier'
      );
    };

    const toValue = (args: any[]): string => {
      const texts = args.map((arg) =>
        arg.type === 'SequenceExpression'
          ? `(${sourceCode.getText(arg)})`
          : sourceCode.getText(arg),
      );
      if (args.length === 1 && args[0].type !== 'SpreadElement') {
        return texts[0];
      }
      return `[${texts.join(', ')}]`;
    };

    const hasProp = (attribute: any): boolean =>
      attribute.parent.attributes.some(
        (other: any) =>
          other.type === 'JSXSpreadAttribute' ||
          (other.type === 'JSXAttribute' &&
            other.name.type === 'JSXIdentifier' &&
            other.name.name === prop),
      );

    const isWholeClassName = (call: any): boolean => {
      const container = call.parent;
      if (container?.type !== 'JSXExpressionContainer') return false;
      const attribute = container.parent;
      return (
        attribute?.type === 'JSXAttribute' &&
        attribute.name.type === 'JSXIdentifier' &&
        attribute.name.name === 'className' &&
        !hasProp(attribute)
      );
    };

    return {
      CallExpression(node: any) {
        if (!isUseCall(node)) return;
        if (!isWholeClassName(node) || node.arguments.length === 0) {
          context.report({ node, messageId: 'manual', data: { prop } });
          return;
        }
        const attribute = node.parent.parent;
        context.report({
          node,
          messageId: 'rewrite',
          data: { prop },
          fix: (fixer) =>
            fixer.replaceText(
              attribute,
              `${prop}={${toValue(node.arguments)}}`,
            ),
        });
      },
    };
  },
};
