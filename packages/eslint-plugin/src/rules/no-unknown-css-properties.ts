/**
 * @fileoverview Disallow unknown CSS properties
 */

import type { ObjectExpression, ImportSpecifier } from 'estree';
import type { Rule } from 'eslint';
import { styleObjectFromValue } from '../util/styleObject';
import { styledRule } from '../util/styledCall';
import { cssPropertyData } from '../util/cssPropertyData';

const knownProperties = new Set(cssPropertyData);

function camelCaseCandidate(name: string): string | null {
  if (!name.includes('-')) return null;
  const camel = name.replace(/-([a-z])/g, (_, char: string) =>
    char.toUpperCase(),
  );
  const candidate = name.startsWith('-ms-') ? `ms${camel.slice(2)}` : camel;
  return knownProperties.has(candidate) ? candidate : null;
}

const positionTryProperties = new Set([
  'positionAnchor',
  'positionArea',
  'inset',
  'insetBlock',
  'insetBlockStart',
  'insetBlockEnd',
  'insetInline',
  'insetInlineStart',
  'insetInlineEnd',
  'top',
  'right',
  'bottom',
  'left',
  'placeSelf',
  'alignSelf',
  'justifySelf',
  'inlineSize',
  'minInlineSize',
  'maxInlineSize',
  'width',
  'minWidth',
  'maxWidth',
  'blockSize',
  'minBlockSize',
  'maxBlockSize',
  'height',
  'minHeight',
  'maxHeight',
  'margin',
  'marginBlock',
  'marginBlockStart',
  'marginBlockEnd',
  'marginInline',
  'marginInlineStart',
  'marginInlineEnd',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
]);

export const noUnknownCssProperties: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow unknown CSS properties in camelCase within css.create, css.keyframes, css.viewTransitionClass, and css.positionTry',
    },
    messages: {
      unknownProperty: "Unknown CSS property '{{ name }}'.",
      kebabCaseProperty:
        "Use '{{ camel }}' for '{{ name }}' in Plumeria styles.",
      unknownNestedProperty:
        "Unknown CSS property '{{ name }}'. Nested selectors start with ':', '[' or '@'.",
      positionTryProperty:
        "'{{ name }}' cannot be used in css.positionTry. @position-try only accepts inset, margin, sizing and self-alignment properties, positionAnchor and positionArea.",
    },
    schema: [],
  },

  create(context) {
    const plumeriaAliases: Record<string, string> = {};

    return {
      ImportDeclaration(node) {
        if (node.source.value === '@plumeria/core') {
          node.specifiers.forEach((specifier) => {
            if (
              specifier.type === 'ImportNamespaceSpecifier' ||
              specifier.type === 'ImportDefaultSpecifier'
            ) {
              plumeriaAliases[specifier.local.name] = 'NAMESPACE';
            } else {
              const spec = specifier as ImportSpecifier;
              const importedName =
                spec.imported.type === 'Identifier'
                  ? spec.imported.name
                  : String(spec.imported.value);
              plumeriaAliases[specifier.local.name] = importedName;
            }
          });
        }
      },
      CallExpression(node) {
        const styled = styledRule(context, node);
        if (styled) {
          checkStyleObject(styled, true);
          return;
        }
        let isCssProperties = false;
        let isPositionTry = false;
        let isCreate = false;
        if (node.callee.type === 'MemberExpression') {
          if (
            node.callee.object.type === 'Identifier' &&
            plumeriaAliases[node.callee.object.name] === 'NAMESPACE'
          ) {
            const propertyName =
              node.callee.property.type === 'Identifier'
                ? node.callee.property.name
                : null;
            if (
              propertyName === 'create' ||
              propertyName === 'keyframes' ||
              propertyName === 'viewTransitionClass' ||
              propertyName === 'positionTry'
            ) {
              isCssProperties = true;
              isPositionTry = propertyName === 'positionTry';
              isCreate = propertyName === 'create';
            }
          }
        } else if (node.callee.type === 'Identifier') {
          const alias = plumeriaAliases[node.callee.name];
          if (
            alias === 'create' ||
            alias === 'keyframes' ||
            alias === 'viewTransitionClass' ||
            alias === 'positionTry'
          ) {
            isCssProperties = true;
            isPositionTry = alias === 'positionTry';
            isCreate = alias === 'create';
          }
        }

        if (isCssProperties) {
          node.arguments.forEach((arg) => {
            if (arg.type === 'ObjectExpression') {
              if (isPositionTry) {
                checkPositionTry(arg);
                return;
              }
              arg.properties.forEach((prop) => {
                if (prop.type !== 'Property') return;
                const style = styleObjectFromValue(prop.value);
                if (style) checkStyleObject(style, isCreate);
              });
            }
          });
        }
      },
    };

    function checkPositionTry(node: ObjectExpression) {
      node.properties.forEach((prop) => {
        if (prop.type !== 'Property') return;
        let keyName: string;
        if (!prop.computed) {
          keyName =
            prop.key.type === 'Identifier'
              ? prop.key.name
              : String((prop.key as any).value);
        } else if (
          prop.key.type === 'Literal' &&
          typeof prop.key.value === 'string'
        ) {
          keyName = prop.key.value;
        } else {
          return;
        }
        if (positionTryProperties.has(keyName)) return;
        const candidate = camelCaseCandidate(keyName);
        const camel =
          candidate && positionTryProperties.has(candidate) ? candidate : null;
        context.report({
          node: prop.key,
          messageId: camel
            ? 'kebabCaseProperty'
            : candidate ||
                /^[:[@]|^--/.test(keyName) ||
                knownProperties.has(keyName)
              ? 'positionTryProperty'
              : 'unknownProperty',
          data: {
            name: keyName,
            camel: camel ?? '',
          },
        });
      });
    }

    function checkStyleObject(node: ObjectExpression, isCreate: boolean) {
      node.properties.forEach((prop) => {
        if (prop.type === 'Property') {
          if (prop.value.type === 'ObjectExpression') {
            checkStyleObject(prop.value, isCreate);
          }

          let isCheckable = false;
          let keyName = '';

          if (!prop.computed) {
            isCheckable = true;
            keyName =
              prop.key.type === 'Identifier'
                ? prop.key.name
                : String((prop.key as any).value);
          } else if (
            prop.key.type === 'Literal' &&
            typeof prop.key.value === 'string'
          ) {
            isCheckable = true;
            keyName = prop.key.value;
          }

          if (isCheckable) {
            if (
              !keyName.startsWith(':') &&
              !keyName.startsWith('[') &&
              !keyName.startsWith('@') &&
              !keyName.startsWith('--')
            ) {
              if (!knownProperties.has(keyName)) {
                const camel = camelCaseCandidate(keyName);
                context.report({
                  node: prop.key,
                  messageId: camel
                    ? 'kebabCaseProperty'
                    : isCreate && prop.value.type === 'ObjectExpression'
                      ? 'unknownNestedProperty'
                      : 'unknownProperty',
                  data: {
                    name: keyName,
                    camel: camel ?? '',
                  },
                });
              }
            }
          }
        }
      });
    }
  },
};
