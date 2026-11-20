import { RuleTester } from 'eslint';
import { noInnerCall } from '../../src/rules/no-inner-call';

const ruleTester = new RuleTester();

const settings = {
  ecmaVersion: 2021,
};

ruleTester.run('no-inner-call', noInnerCall, {
  valid: [
    {
      code: "import { variants as legacy } from '@plumeria/core'; function f() { legacy({}); }",
    },

    // Retired APIs are outside this rule; do not suggest using them differently.
    {
      code: `import * as css from '@plumeria/core'; const func = function() { css.variants(); };`,
    },

    {
      code: `import * as css from '@plumeria/core'; css.create();`,
      settings,
    },
    {
      code: `import * as css from '@plumeria/core'; css.createStatic();`,
      settings,
    },
    {
      code: `import * as css from '@plumeria/core'; css.createTheme();`,
      settings,
    },
    {
      code: `import * as css from '@plumeria/core'; css.keyframes();`,
      settings,
    },
    {
      code: `import * as css from '@plumeria/core'; css.viewTransitionClass();`,
      settings,
    },
    {
      code: `import * as css from '@plumeria/core'; css.variants();`,
      settings,
    },
    {
      code: `import css from '@plumeria/core'; css.create();`,
      settings,
    },
    {
      code: `import * as React from 'react'; function f() { React.useState(); }`,
      settings,
    },
    {
      code: `import { useState } from 'react'; function f() { useState(); }`,
      settings,
    },
    {
      code: `function f() { console.log(); }`,
      settings,
    },
    {
      code: `function f() { foo.bar.baz(); }`,
      settings,
    },
  ],
  invalid: [
    {
      code: `import * as css from '@plumeria/core'; const create = () => { css.create(); }`,
      errors: [
        {
          message:
            'Move css.create() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import css from '@plumeria/core'; function f() { css.create(); }`,
      errors: [
        {
          message:
            'Move css.create() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import { "create" as c } from '@plumeria/core'; function f() { c(); }`,
      errors: [
        {
          message:
            'Move c() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import { create } from '@plumeria/core'; function f() { create(); }`,
      errors: [
        {
          message:
            'Move create() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import * as style from '@plumeria/core'; function f() { style.create(); }`,
      errors: [
        {
          message:
            'Move style.create() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import { keyframes } from '@plumeria/core'; (() => { keyframes(); })();`,
      errors: [
        {
          message:
            'Move keyframes() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import * as css from '@plumeria/core'; (() => { css.viewTransitionClass(); })();`,
      errors: [
        {
          message:
            'Move css.viewTransitionClass() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import * as css from '@plumeria/core'; (() => { css.positionTry({ top: 0 }); })();`,
      errors: [
        {
          message:
            'Move css.positionTry() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import * as css from '@plumeria/core'; (() => { css.varType({ syntax: '*' }); })();`,
      errors: [
        {
          message:
            'Move css.varType() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import { createStatic } from '@plumeria/core'; function consts() { createStatic(); }`,
      errors: [
        {
          message:
            'Move createStatic() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import * as css from '@plumeria/core'; function theme() { css.createTheme(); }`,
      errors: [
        {
          message:
            'Move css.createTheme() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import * as css from '@plumeria/core'; const arrow = () => { css.keyframes(); };`,
      errors: [
        {
          message:
            'Move css.keyframes() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
    {
      code: `import * as css from '@plumeria/core'; const func = function() { css.create(); };`,
      errors: [
        {
          message:
            'Move css.create() to module scope and reference the result inside the function.',
        },
      ],
      settings,
    },
  ],
});
