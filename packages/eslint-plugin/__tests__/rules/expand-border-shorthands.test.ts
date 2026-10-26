import { Linter, RuleTester } from 'eslint';
import { kebabToCamelCase } from 'zss-engine';
import { expandBorderShorthands } from '../../src/rules/expand-border-shorthands';
import { sortProperties } from '../../src/rules/sort-properties';
import { BORDER_BUNDLES } from '../../src/util/borderShorthand';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
});

const wrap = (body: string) => `
import * as css from '@plumeria/core';
const styles = css.create({
  box: {
${body}
  }
});
`;

ruleTester.run('expand-border-shorthands', expandBorderShorthands, {
  valid: [
    {
      code: `
        import css from '@plumeria/core';
        const dynamic = 'borderTop';
        css.unknown({ box: { borderTop: '1px solid red' } });
        css['create']({ box: { borderTop: '1px solid red' } });
        css.create(null, { box: 1 }, { ...other });
        (function () {})();
        localFunction();
        css.create({
          ...other,
          box: {
            ...other,
            [dynamic]: '1px solid red',
            borderTopWidth: '1px'
          }
        });
      `,
    },
    {
      code: wrap(
        `    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'red',
    borderWidth: 2,
    borderBlockWidth: 5,
    borderRadius: 4,
    color: 'red'`,
      ),
    },
    {
      code: `
        import * as css from 'not-plumeria';
        css.create({ box: { borderTop: '1px solid red' } });
      `,
    },
    {
      code: `
        import { create, keyframes as frames, viewTransitionClass } from '@plumeria/core';
        create({ box: { borderWidth: 1 } });
        frames({ from: { borderStyle: 'solid' } });
        viewTransitionClass({ old: { borderColor: 'red' } });
      `,
    },
  ],
  invalid: [
    {
      code: `
        import { create as make } from '@plumeria/core';
        make({ box: { 'borderRight': "thin dotted blue" } });
      `,
      output: `
        import { create as make } from '@plumeria/core';
        make({ box: { borderRightColor: "blue",
                      borderRightStyle: "dotted",
                      borderRightWidth: "thin" } });
      `,
      errors: [{ messageId: 'expand', data: { name: 'borderRight' } }],
    },
    {
      code: `
        import { 'viewTransitionClass' as transition } from '@plumeria/core';
        transition({ old: { ['borderInlineEnd']: value } });
      `,
      errors: [{ messageId: 'opaque', data: { name: 'borderInlineEnd' } }],
    },
    {
      code: `
        import css from '@plumeria/core';
        css.keyframes({
          from: {
            '@media (forced-colors: active)': {
              borderBlockStart: 'medium solid CanvasText'
            }
          }
        });
      `,
      output: `
        import css from '@plumeria/core';
        css.keyframes({
          from: {
            '@media (forced-colors: active)': {
              borderBlockStartColor: 'CanvasText',
              borderBlockStartStyle: 'solid',
              borderBlockStartWidth: 'medium'
            }
          }
        });
      `,
      errors: [{ messageId: 'expand', data: { name: 'borderBlockStart' } }],
    },
    {
      code: wrap(`    borderTop: '1px solid red'`),
      output: wrap(
        `    borderTopColor: 'red',
    borderTopStyle: 'solid',
    borderTopWidth: '1px'`,
      ),
      errors: [{ messageId: 'expand', data: { name: 'borderTop' } }],
    },
    {
      /**
       * The shorthand resets what it omits, so the expansion has to write the
       * initial value of every component the author left out.
       */
      code: wrap(`    borderBlock: 'solid'`),
      output: wrap(
        `    borderBlockColor: 'currentColor',
    borderBlockStyle: 'solid',
    borderBlockWidth: 'medium'`,
      ),
      errors: [{ messageId: 'expand', data: { name: 'borderBlock' } }],
    },
    {
      code: wrap(`    border: '2px dashed rgb(0 0 0 / 50%)'`),
      output: wrap(
        `    borderColor: 'rgb(0 0 0 / 50%)',
    borderStyle: 'dashed',
    borderWidth: '2px'`,
      ),
      errors: [{ messageId: 'expand', data: { name: 'border' } }],
    },
    {
      code: wrap(`    borderInlineStart: 'red 1px'`),
      output: wrap(
        `    borderInlineStartColor: 'red',
    borderInlineStartStyle: 'none',
    borderInlineStartWidth: '1px'`,
      ),
      errors: [{ messageId: 'expand', data: { name: 'borderInlineStart' } }],
    },
    {
      code: wrap(`    borderTop: 'var(--edge)'`),
      errors: [{ messageId: 'opaque', data: { name: 'borderTop' } }],
    },
    {
      code: wrap(`    borderBottom: 'inherit'`),
      errors: [{ messageId: 'opaque', data: { name: 'borderBottom' } }],
    },
    {
      code: wrap(`    borderLeft: '1px solid var(--edge-color)'`),
      output: wrap(
        `    borderLeftColor: 'var(--edge-color)',
    borderLeftStyle: 'solid',
    borderLeftWidth: '1px'`,
      ),
      errors: [{ messageId: 'expand', data: { name: 'borderLeft' } }],
    },
    {
      code: wrap('    borderLeft: `1px solid ${colors.edge}`'),
      output: wrap(
        `    borderLeftColor: colors.edge,
    borderLeftStyle: 'solid',
    borderLeftWidth: '1px'`,
      ),
      errors: [{ messageId: 'expand', data: { name: 'borderLeft' } }],
    },
    {
      code: wrap('    borderRight: `${width}px solid red`'),
      output: wrap(
        `    borderRightColor: 'red',
    borderRightStyle: 'solid',
    borderRightWidth: \`\${width}px\``,
      ),
      errors: [{ messageId: 'expand', data: { name: 'borderRight' } }],
    },
    {
      code: wrap('    borderTop: `solid ${color}`'),
      errors: [{ messageId: 'opaque', data: { name: 'borderTop' } }],
    },
    {
      code: `
        import { keyframes } from '@plumeria/core';
        keyframes({
          from: {
            borderLeft: '1px solid red'
          }
        });
      `,
      output: `
        import { keyframes } from '@plumeria/core';
        keyframes({
          from: {
            borderLeftColor: 'red',
            borderLeftStyle: 'solid',
            borderLeftWidth: '1px'
          }
        });
      `,
      errors: [{ messageId: 'expand', data: { name: 'borderLeft' } }],
    },
  ],
});

describe('expand-border-shorthands with sort-properties', () => {
  const linter = new Linter({ configType: 'flat' });
  const config = (rule: string): Linter.Config[] => [
    {
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      plugins: {
        plumeria: {
          rules: {
            'expand-border-shorthands': expandBorderShorthands,
            'sort-properties': sortProperties,
          },
        },
      },
      rules: { [`plumeria/${rule}`]: 'error' },
    },
  ];

  it.each(BORDER_BUNDLES.map(kebabToCamelCase))(
    'leaves %s sorted after a single expansion',
    (name) => {
      const { output } = linter.verifyAndFix(
        wrap(`    display: 'flex',
    ${name}: '1px solid red',
    borderRadius: '12px',`),
        config('expand-border-shorthands'),
      );

      expect(output).toContain(`${name}Color: 'red',
    ${name}Style: 'solid',
    ${name}Width: '1px',
    borderRadius: '12px',`);
      expect(linter.verify(output, config('sort-properties'))).toEqual([]);
    },
  );
});
