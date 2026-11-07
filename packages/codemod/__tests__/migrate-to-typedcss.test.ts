import { RuleTester } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';
import {
  migrateToTypedCSS,
  toTypedCSS,
} from '../src/transforms/migrate-to-typedcss';

import type { Linter } from 'eslint';

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser as unknown as Linter.Parser,
  },
});

const source = { messageId: 'source' };
const rename = { messageId: 'rename' };

describe('toTypedCSS', () => {
  it('maps the packages a project depends on to their typedcss names', () => {
    expect(toTypedCSS('@plumeria/core')).toBe('@typedcss/css');
    expect(toTypedCSS('@plumeria/eslint-plugin')).toBe(
      '@typedcss/eslint-plugin',
    );
    expect(toTypedCSS('@plumeria/compiler')).toBeNull();
    expect(toTypedCSS('@plumeria/unplugin/vite')).toBe(
      '@typedcss/unplugin/vite',
    );
    expect(toTypedCSS('@plumeria/next-plugin')).toBe('@typedcss/next-plugin');
    expect(toTypedCSS('plumeria')).toBeNull();
    expect(toTypedCSS('react')).toBeNull();
  });
});

tester.run('migrate-to-typedcss', migrateToTypedCSS, {
  valid: [
    `import * as css from '@typedcss/css';`,
    `import { withTypedCSS } from '@typedcss/next-plugin';`,
    // withPlumeria from elsewhere is not the plugin
    `import { withPlumeria } from './local';
withPlumeria();`,
    `export {};`,
    `export { value } from './local';
export * from './local';
const value = require(name);
const other = factory('@plumeria/core');
const third = object.require('@plumeria/core');
const fourth = object.require;`,
  ],
  invalid: [
    {
      code: `import * as css from '@plumeria/core';
import type { CSSProperties } from "@plumeria/core";`,
      output: `import * as css from '@typedcss/css';
import type { CSSProperties } from "@typedcss/css";`,
      errors: [source, source],
    },
    {
      code: `import typedcss from '@plumeria/unplugin/vite';
export default { plugins: [typedcss()] };`,
      output: `import typedcss from '@typedcss/unplugin/vite';
export default { plugins: [typedcss()] };`,
      errors: [source],
    },
    {
      code: `import { withPlumeria } from '@plumeria/next-plugin';
export default withPlumeria(nextConfig);`,
      output: `import { withTypedCSS } from '@typedcss/next-plugin';
export default withTypedCSS(nextConfig);`,
      errors: [rename, source, rename],
    },
    {
      // an alias keeps its local name
      code: `import { withPlumeria as withCSS } from '@plumeria/next-plugin';
export default withCSS(nextConfig);`,
      output: `import { withTypedCSS as withCSS } from '@typedcss/next-plugin';
export default withCSS(nextConfig);`,
      errors: [rename, source],
    },
    {
      code: `const { withPlumeria } = require('@plumeria/next-plugin');
module.exports = withPlumeria({});`,
      output: `const { withTypedCSS } = require('@typedcss/next-plugin');
module.exports = withTypedCSS({});`,
      errors: [rename, source, rename],
    },
    {
      code: `const { withPlumeria: withCSS } = require('@plumeria/next-plugin');`,
      output: `const { withTypedCSS: withCSS } = require('@typedcss/next-plugin');`,
      errors: [rename, source],
    },
    {
      code: `const css = await import('@plumeria/core');
export * from '@plumeria/core';`,
      output: `const css = await import('@typedcss/css');
export * from '@typedcss/css';`,
      errors: [source, source],
    },
    {
      code: `export { withPlumeria } from '@plumeria/next-plugin';`,
      output: `export { withTypedCSS } from '@typedcss/next-plugin';`,
      errors: [rename, source],
    },
    {
      code: `type Core = import('@plumeria/core');`,
      output: `type Core = import('@typedcss/css');`,
      errors: [source],
    },
    {
      code: `import plugin, { unrelated, 'withPlumeria' as withCSS } from '@plumeria/next-plugin';`,
      output: `import plugin, { unrelated, 'withPlumeria' as withCSS } from '@typedcss/next-plugin';`,
      errors: [source],
    },
    {
      code: `const plugin = require('@plumeria/next-plugin');
const { ...rest } = require('@plumeria/next-plugin');
const { ['withPlumeria']: computed } = require('@plumeria/next-plugin');
const { 'withPlumeria': quoted } = require('@plumeria/next-plugin');
const { unrelated } = require('@plumeria/next-plugin');
const { withPlumeria: { nested } } = require('@plumeria/next-plugin');`,
      output: `const plugin = require('@typedcss/next-plugin');
const { ...rest } = require('@typedcss/next-plugin');
const { ['withPlumeria']: computed } = require('@typedcss/next-plugin');
const { 'withPlumeria': quoted } = require('@typedcss/next-plugin');
const { unrelated } = require('@typedcss/next-plugin');
const { withTypedCSS: { nested } } = require('@typedcss/next-plugin');`,
      errors: [source, source, source, source, source, rename, source],
    },
  ],
});

describe('defensive visitor branches', () => {
  const report = jest.fn();
  const visitors = migrateToTypedCSS.create({
    report,
    sourceCode: { getDeclaredVariables: () => [] },
  } as never) as Record<string, (node: any) => void>;

  beforeEach(() => report.mockClear());

  it('accepts declarations without specifiers and legacy TS import nodes', () => {
    visitors.ImportDeclaration({
      source: {
        type: 'Literal',
        value: '@plumeria/next-plugin',
        raw: "'@plumeria/next-plugin'",
      },
      specifiers: undefined,
    });
    visitors.ExportNamedDeclaration({
      source: { type: 'Literal', value: './local', raw: "'./local'" },
      specifiers: null,
    });
    visitors.TSImportType({
      argument: {
        type: 'Literal',
        value: '@plumeria/core',
        raw: "'@plumeria/core'",
      },
    });
    visitors.TSImportType({ argument: undefined });

    expect(report).toHaveBeenCalledTimes(2);
  });

  it('handles shorthand properties without identifiers or variables', () => {
    visitors.VariableDeclarator({
      init: {
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ value: '@plumeria/next-plugin' }],
      },
      id: {
        type: 'ObjectPattern',
        properties: [
          {
            type: 'Property',
            computed: false,
            shorthand: true,
            key: { type: 'Identifier', name: 'withPlumeria' },
            value: { type: 'Identifier', name: 'withPlumeria' },
          },
          {
            type: 'Property',
            computed: false,
            shorthand: true,
            key: { type: 'Identifier', name: 'withPlumeria' },
            value: { type: 'ObjectPattern', properties: [] },
          },
        ],
      },
    });

    expect(report).toHaveBeenCalledTimes(1);
  });
});
