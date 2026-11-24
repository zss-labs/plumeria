import { RuleTester, type Rule } from 'eslint';
import * as parser from '@typescript-eslint/parser';
import { noUnknownCssProperties } from '../../src/rules/no-unknown-css-properties';
import { sortProperties } from '../../src/rules/sort-properties';
import { validateAtRules } from '../../src/rules/validate-at-rules';
import { validatePseudos } from '../../src/rules/validate-pseudos';
import { validateValues } from '../../src/rules/validate-values';
import { styledRule } from '../../src/util/styledCall';

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const head = `import { styled } from '@plumeria/react';`;

ruleTester.run(
  'styledRule expression detection',
  {
    meta: { schema: [], messages: { found: 'Found a styled rule.' } },
    create(context) {
      return {
        ExpressionStatement({ expression }) {
          const rule = styledRule(context, expression);
          if (rule) context.report({ node: rule, messageId: 'found' });
        },
      };
    },
  } satisfies Rule.RuleModule,
  {
    valid: [
      `${head}\nstyled.div;`,
      'theme.styled.div({});',
      'unbound.div({});',
      `${head}\nstyled.div(existingStyles);`,
    ],
    invalid: [
      {
        code: `import { "styled" as s } from '@plumeria/react';\ns.div({});`,
        errors: [{ messageId: 'found', line: 2, column: 7 }],
      },
    ],
  },
);

const ignored = [
  `import styled from '@emotion/styled';\nstyled.div({ colro: 'gren', ':hovr': {}, '@page': {}, display: 'flex', color: 'red' });`,
  `const styled = { div: (rule: object) => rule };\nstyled.div({ colro: 'gren', ':hovr': {}, '@page': {}, display: 'flex', color: 'red' });`,
  `${head}\nfunction f(styled: any) { return styled.div({ colro: 'gren', ':hovr': {}, '@page': {}, display: 'flex', color: 'red' }); }`,
];

const cases: [string, Rule.RuleModule, string, string][] = [
  [
    'no-unknown-css-properties',
    noUnknownCssProperties,
    `{ colro: 'red' }`,
    `{ ':hover': { colro: 'red' } }`,
  ],
  [
    'validate-values',
    validateValues,
    `{ color: 'gren' }`,
    `{ ':hover': { color: 'gren' } }`,
  ],
  [
    'validate-pseudos',
    validatePseudos,
    `{ ':hovr': { color: 'red' } }`,
    `{ '@media (width >= 640px)': { ':hovr': { color: 'red' } } }`,
  ],
  [
    'validate-at-rules',
    validateAtRules,
    `{ '@page': { color: 'red' } }`,
    `{ ':hover': { '@page': { color: 'red' } } }`,
  ],
];

for (const [name, rule, direct, nested] of cases) {
  ruleTester.run(`${name} on styled`, rule, {
    valid: [
      `${head}\nstyled.div({ color: 'red', ':hover': { color: 'blue' }, '@media (width >= 640px)': { color: 'green' } });`,
      `${head}\nstyled.div({ color: (p: { c: string }) => p.c });`,
      ...ignored,
    ],
    invalid: [
      { code: `${head}\nstyled.div(${direct});`, errors: 1 },
      {
        code: `${head}\nconst Base = styled.div({});\nstyled(Base)(${direct});`,
        errors: 1,
      },
      {
        code: `import { styled as s } from '@plumeria/react';\ns.button(${nested});`,
        errors: 1,
      },
    ],
  });
}

ruleTester.run('sort-properties on styled', sortProperties, {
  valid: [
    `${head}\nstyled.div({ display: 'flex', color: 'red' });`,
    ...ignored,
  ],
  invalid: [
    {
      code: `${head}\nstyled.div({ borderWidth: '1px', borderColor: 'red' });`,
      output: `${head}\nstyled.div({ borderColor: 'red', borderWidth: '1px' });`,
      errors: 1,
    },
    {
      code: `import { styled as s } from '@plumeria/react';\nconst Base = s.div({});\ns(Base)({ ':hover': { borderWidth: '1px', borderColor: 'red' } });`,
      output: `import { styled as s } from '@plumeria/react';\nconst Base = s.div({});\ns(Base)({ ':hover': { borderColor: 'red', borderWidth: '1px' } });`,
      errors: 1,
    },
  ],
});
