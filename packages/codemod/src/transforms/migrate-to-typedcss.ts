/**
 * @fileoverview Move a codebase from Plumeria to typedcss
 */

import type { Rule } from 'eslint';

const PACKAGES: Record<string, string> = {
  '@plumeria/core': '@typedcss/css',
  '@plumeria/unplugin': '@typedcss/unplugin',
  '@plumeria/next-plugin': '@typedcss/next-plugin',
  '@plumeria/eslint-plugin': '@typedcss/eslint-plugin',
};

const SCOPE = '@plumeria/';
const PLUGIN = '@plumeria/next-plugin';
const RENAMES: Record<string, string> = { withPlumeria: 'withTypedCSS' };

export function toTypedCSS(source: string): string | null {
  if (!source.startsWith(SCOPE)) return null;
  const [name, ...rest] = source.slice(SCOPE.length).split('/');
  const target = PACKAGES[SCOPE + name];
  if (!target) return null;
  return [target, ...rest].join('/');
}

export const migrateToTypedCSS: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Rewrite Plumeria imports and plugins to typedcss',
    },
    fixable: 'code',
    messages: {
      source: 'Import "{{to}}" instead of "{{from}}".',
      rename: 'Rename "{{from}}" to "{{to}}".',
    },
    schema: [],
  },

  create(context) {
    const rewriteSource = (node: any) => {
      if (!node || node.type !== 'Literal' || typeof node.value !== 'string') {
        return;
      }
      const to = toTypedCSS(node.value);
      if (!to) return;
      const quote = node.raw[0];
      context.report({
        node,
        messageId: 'source',
        data: { from: node.value, to },
        fix: (fixer) => fixer.replaceText(node, `${quote}${to}${quote}`),
      });
    };

    const rename = (node: any, from: string, to: string) =>
      context.report({
        node,
        messageId: 'rename',
        data: { from, to },
        fix: (fixer) => fixer.replaceText(node, to),
      });

    const renameSpecifiers = (node: any) => {
      if (node.source?.value !== PLUGIN) return;
      for (const specifier of node.specifiers ?? []) {
        const imported =
          specifier.type === 'ImportSpecifier'
            ? specifier.imported
            : specifier.type === 'ExportSpecifier'
              ? specifier.local
              : null;
        if (imported?.type !== 'Identifier') continue;
        const to = RENAMES[imported.name];
        if (!to) continue;
        const from = imported.name;
        rename(imported, from, to);
        if (specifier.type !== 'ImportSpecifier') continue;
        if (specifier.local.name !== from) continue;
        const [variable] = context.sourceCode.getDeclaredVariables(specifier);
        for (const reference of variable.references) {
          rename(reference.identifier, from, to);
        }
      }
    };

    return {
      ImportDeclaration(node: any) {
        renameSpecifiers(node);
        rewriteSource(node.source);
      },
      ExportNamedDeclaration(node: any) {
        renameSpecifiers(node);
        rewriteSource(node.source);
      },
      ExportAllDeclaration(node: any) {
        rewriteSource(node.source);
      },
      ImportExpression(node: any) {
        rewriteSource(node.source);
      },
      TSImportType(node: any) {
        rewriteSource(node.argument?.literal ?? node.argument);
      },
      CallExpression(node: any) {
        if (node.callee.type !== 'Identifier') return;
        if (node.callee.name !== 'require') return;
        rewriteSource(node.arguments[0]);
      },
      VariableDeclarator(node: any) {
        const init = node.init;
        if (init?.type !== 'CallExpression') return;
        if (init.callee.type !== 'Identifier') return;
        if (init.callee.name !== 'require') return;
        if (init.arguments[0]?.value !== PLUGIN) return;
        if (node.id.type !== 'ObjectPattern') return;
        const variables = context.sourceCode.getDeclaredVariables(node);
        for (const property of node.id.properties) {
          if (property.type !== 'Property' || property.computed) continue;
          if (property.key.type !== 'Identifier') continue;
          const from = property.key.name;
          const to = RENAMES[from];
          if (!to) continue;
          if (!property.shorthand) {
            rename(property.key, from, to);
            continue;
          }
          if (property.value.type !== 'Identifier') continue;
          rename(property, from, to);
          const variable = variables.find((v: any) => v.name === from);
          for (const reference of variable?.references ?? []) {
            if (reference.init) continue;
            rename(reference.identifier, from, to);
          }
        }
      },
    };
  },
};
