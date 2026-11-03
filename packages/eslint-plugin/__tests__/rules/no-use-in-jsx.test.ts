import * as path from 'path';
import { RuleTester } from 'eslint';
import { noUseInJsx } from '../../src/rules/no-use-in-jsx';
import plugin from '../../src';

const TSX = path.join(__dirname, 'App.tsx');
const JSX = path.join(__dirname, 'App.jsx');
const TS = path.join(__dirname, 'style.ts');
const prefix = "import * as css from '@plumeria/core'; ";

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-use-in-jsx', noUseInJsx, {
  valid: [
    // Files that are not .jsx or .tsx keep css.use() for templates.
    { code: prefix + 'export const cls = css.use(a);', filename: TS },
    {
      code: prefix + 'export const cls = css.use(a);',
      filename: path.join(__dirname, 'style.js'),
    },
    {
      code: prefix + 'const el = <div class={css.use(a)} />;',
      filename: path.join(__dirname, 'Page.astro'),
    },
    {
      code: prefix + 'const el = <div classStyle={[a, active && b]} />;',
      filename: TSX,
    },
    // Not imported from @plumeria/core.
    {
      code: "import * as css from 'other'; const el = <div className={css.use(a)} />;",
      filename: TSX,
    },
    { code: 'const el = <div className={css.use(a)} />;', filename: TSX },
    // A parameter that shadows the import is not @plumeria/core.
    {
      code: prefix + 'const f = (css) => <div className={css.use(a)} />;',
      filename: TSX,
    },
    {
      code: "import { use } from '@plumeria/core'; const f = (use) => use(a);",
      filename: TSX,
    },
    // Another export of @plumeria/core.
    {
      code: "import { create } from '@plumeria/core'; const styles = create({});",
      filename: TSX,
    },
    { code: prefix + 'const styles = css.create({});', filename: TSX },
    // A result imported from another module is left to that module.
    {
      code: "import { cls } from './style'; const el = <div className={cls} />;",
      filename: TSX,
    },
  ],
  invalid: [
    {
      code: prefix + 'const el = <div className={css.use(a)} />;',
      filename: TSX,
      errors: [{ messageId: 'jsx', data: { styleProp: 'classStyle' } }],
    },
    {
      code: prefix + 'const el = <div className={css.use(a)} />;',
      filename: JSX,
      options: [{ styleProp: 'sx' }],
      errors: [{ messageId: 'jsx', data: { styleProp: 'sx' } }],
    },
    // Anywhere in the file, whether or not the result reaches JSX.
    {
      code: prefix + 'export const cls = css.use(a);',
      filename: TSX,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code: prefix + 'const n = css.use(a).length;',
      filename: TSX,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code: prefix + "css['use'](a);",
      filename: TSX,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code: "import css from '@plumeria/core'; css.use(a);",
      filename: TSX,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code: "import { use } from '@plumeria/core'; use(a);",
      filename: TSX,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code: "import { use as apply } from '@plumeria/core'; apply(a);",
      filename: TSX,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code:
        prefix +
        'const el = <div className={css.use(a, active && css.use(b))} />;',
      filename: TSX,
      errors: [{ messageId: 'jsx' }, { messageId: 'jsx' }],
    },
  ],
});

describe('no-use-in-jsx config', () => {
  // Opt-in: a component without a Style prop can take styles only through css.use().
  it('is registered but left out of the recommended config', () => {
    expect(plugin.rules['no-use-in-jsx']).toBe(noUseInJsx);
    expect(
      plugin.configs.recommended.rules?.['@plumeria/no-use-in-jsx'],
    ).toBeUndefined();
  });
});
