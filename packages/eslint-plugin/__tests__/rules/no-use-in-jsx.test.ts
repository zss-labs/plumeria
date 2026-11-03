import * as path from 'path';
import { RuleTester } from 'eslint';
import { noUseInJsx } from '../../src/rules/no-use-in-jsx';
import plugin from '../../src';

const APP = path.join(__dirname, 'App.tsx');
const prefix = "import * as css from '@plumeria/core'; ";

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-use-in-jsx', noUseInJsx, {
  valid: [
    // css.use() outside JSX stays available for templates.
    { code: prefix + 'export const cls = css.use(a);', filename: APP },
    {
      code: prefix + 'const el = <div classStyle={[a, active && b]} />;',
      filename: APP,
    },
    // A css.use() result that never reaches JSX.
    {
      code:
        prefix + 'const cls = css.use(a); const el = <div title={label} />;',
      filename: APP,
    },
    // Not imported from @plumeria/core.
    {
      code: "import * as css from 'other'; const el = <div className={css.use(a)} />;",
      filename: APP,
    },
    // A result exported from another module is allowed: the module may have had a reason.
    {
      code: "import { cls } from './style'; const el = <div className={cls} />;",
      filename: APP,
    },
    {
      code: "import * as style from './style'; const el = <div className={style.cls} />;",
      filename: APP,
    },
    // Template files are left alone.
    {
      code: prefix + 'const el = <div class={css.use(a)} />;',
      filename: path.join(__dirname, 'Page.astro'),
    },
    // A parameter is not a css.use() result.
    {
      code: prefix + 'const f = (cls) => <div className={cls} />;',
      filename: APP,
    },
    // A reassignable binding is not followed.
    {
      code:
        prefix + 'let cls = css.use(a); const el = <div className={cls} />;',
      filename: APP,
    },
    {
      code:
        prefix +
        'const o = { main: css.use(a) }; const el = <div className={o.other} />;',
      filename: APP,
    },
  ],
  invalid: [
    {
      code: prefix + 'const el = <div className={css.use(a)} />;',
      filename: APP,
      errors: [{ messageId: 'jsx', data: { styleProp: 'classStyle' } }],
    },
    {
      code: prefix + 'const el = <div className={css.use(a)} />;',
      filename: APP,
      options: [{ styleProp: 'sx' }],
      errors: [{ messageId: 'jsx', data: { styleProp: 'sx' } }],
    },
    {
      code: "import { use } from '@plumeria/core'; const el = <div className={use(a)} />;",
      filename: APP,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code:
        prefix +
        'const el = <Ext className={active ? css.use(a) : undefined} />;',
      filename: APP,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code: prefix + 'const el = <div {...{ className: css.use(a) }} />;',
      filename: APP,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code:
        prefix + 'const el = <Toast options={{ className: css.use(a) }} />;',
      filename: APP,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code: prefix + 'const el = <p>{css.use(a)}</p>;',
      filename: APP,
      errors: [{ messageId: 'jsx' }],
    },
    // A local binding that holds a css.use() result.
    {
      code:
        prefix + 'const cls = css.use(a); const el = <div className={cls} />;',
      filename: APP,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code:
        prefix +
        'const cls = css.use(a); const same = cls; const el = <div className={same} />;',
      filename: APP,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code:
        prefix +
        'const o = { main: css.use(a) }; const el = <div className={o.main} />;',
      filename: APP,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code:
        prefix +
        'const cls = css.use(a); const el = <div className={clsx(cls, b)} />;',
      filename: APP,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code:
        prefix +
        'const cls = css.use(a); const el = <div className={`${cls} x`} />;',
      filename: APP,
      errors: [{ messageId: 'jsx' }],
    },
    {
      code:
        prefix +
        'const cls = css.use(a); const el = <div className={cls as string} />;',
      filename: APP,
      errors: [{ messageId: 'jsx' }],
      languageOptions: {
        parser: require('@typescript-eslint/parser'),
      },
    },
  ],
});

describe('no-use-in-jsx config', () => {
  it('is an error in the recommended config', () => {
    expect(plugin.rules['no-use-in-jsx']).toBe(noUseInJsx);
    expect(plugin.configs.recommended.rules?.['@plumeria/no-use-in-jsx']).toBe(
      'error',
    );
  });
});
