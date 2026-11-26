/**
 * @fileoverview Disallow className and style props when the styling prop is present
 */

import type { Rule, Scope } from 'eslint';
import {
  resolveExport,
  resolveImportPath,
  styledComponents,
} from '@plumeria/compiler';
import { variableOf } from '../util/coreImport';
import { resolveStyleProp, stylePropSchema } from '../util/style-prop';
import { styledRule } from '../util/styledCall';

export const noMixedStylingProps: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow className and style props when the styling prop is present',
    },
    messages: {
      noMixedStylingProps:
        '"{{prop}}" handles both "className" and "style". Avoid mixing them.',
      noStyledStylingProps:
        '"{{name}}" is styled. Pass "{{prop}}" instead of "{{attr}}".',
    },
    schema: stylePropSchema,
  },

  create(context) {
    const styleProp = resolveStyleProp(context);
    // A project that renamed the styling prop to `style` or `className` would
    // otherwise have the rule flag the prop against itself.
    const mixedProps = ['className', 'style'].filter(
      (name) => name !== styleProp,
    );
    const styled = new Set<Scope.Variable>();
    const elements: any[] = [];

    const mixed = (attributes: any[]) =>
      attributes.filter(
        (attr: any) =>
          attr.type === 'JSXAttribute' &&
          attr.name.type === 'JSXIdentifier' &&
          mixedProps.includes(attr.name.name),
      );

    return {
      VariableDeclarator(node: any) {
        if (node.id.type !== 'Identifier' || !node.init) return;
        if (!styledRule(context, node.init)) return;
        for (const variable of context.sourceCode.getDeclaredVariables(node))
          styled.add(variable);
      },
      JSXOpeningElement(node: any) {
        const attributes = node.attributes;
        const hasStyleProp = attributes.some(
          (attr: any) =>
            attr.type === 'JSXAttribute' &&
            attr.name.type === 'JSXIdentifier' &&
            attr.name.name === styleProp,
        );

        if (hasStyleProp) {
          for (const attr of mixed(attributes))
            context.report({
              node: attr,
              messageId: 'noMixedStylingProps',
              data: { prop: styleProp },
            });
          return;
        }
        if (node.name.type === 'JSXIdentifier' && mixed(attributes).length)
          elements.push(node);
      },
      'Program:exit'() {
        const definitions = new Map<string, string[]>();
        const isStyled = (variable: Scope.Variable) => {
          if (styled.has(variable)) return true;
          const definition = variable.defs[0];
          if (definition?.type !== 'ImportBinding') return false;
          const specifier: any = definition.node;
          const exported =
            specifier.type === 'ImportDefaultSpecifier'
              ? 'default'
              : specifier.type === 'ImportSpecifier'
                ? specifier.imported.type === 'Identifier'
                  ? specifier.imported.name
                  : String(specifier.imported.value)
                : null;
          if (exported === null) return false;
          const actualPath = resolveImportPath(
            String((definition.parent as any).source.value),
            context.filename,
          );
          const site = actualPath ? resolveExport(actualPath, exported) : null;
          if (!site) return false;
          let names = definitions.get(site.filePath);
          if (!names) {
            names = styledComponents(site.filePath);
            definitions.set(site.filePath, names);
          }
          return names.includes(site.localName);
        };
        for (const node of elements) {
          const variable = variableOf(context, node.name);
          if (!variable || !isStyled(variable)) continue;
          for (const attr of mixed(node.attributes))
            context.report({
              node: attr,
              messageId: 'noStyledStylingProps',
              data: {
                name: node.name.name,
                prop: styleProp,
                attr: attr.name.name,
              },
            });
        }
      },
    };
  },
};
