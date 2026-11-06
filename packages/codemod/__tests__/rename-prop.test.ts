import { RuleTester } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';
import { renameProp } from '../src/transforms/rename-prop';

import type { Linter } from 'eslint';

const jsxTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
});

const tsTester = new RuleTester({
  languageOptions: {
    parser: tsParser as unknown as Linter.Parser,
  },
});

const options = [{ from: 'styleName', to: 'sx' }];

jsxTester.run('rename-prop (jsx)', renameProp, {
  valid: [
    {
      code: '<div sx={styles.text} />',
      options,
    },
    {
      code: '<div className="text" style={{ color: "red" }} />',
      options,
    },
    {
      // the prop is matched by name, so an already migrated file is a no-op
      code: '<div classStyle={styles.text} />',
      options,
    },
    {
      code: '<svg><use xlink:styleName="#icon" /></svg>',
      options,
    },
    {
      code: "const Card = (props) => <div sx={props['styleName']} />;",
      options,
    },
    {
      code: 'class Card { #styleName; get style() { return this.#styleName; } }',
      options,
    },
    {
      code: 'const { [styleName]: value } = props;',
      options,
    },
    {
      code: "const { 'styleName': value } = props;",
      options,
    },
  ],
  invalid: [
    {
      code: '<div styleName={styles.text} />',
      options,
      output: '<div sx={styles.text} />',
      errors: [{ messageId: 'rename' }],
    },
    {
      code: '<div styleName={styles.text} className="text" />',
      options,
      output: '<div sx={styles.text} className="text" />',
      errors: [{ messageId: 'rename' }],
    },
    {
      // several attributes in one file are all fixed in a single pass
      code: '<><div styleName={styles.a} /><span styleName={styles.b} /></>',
      options,
      output: '<><div sx={styles.a} /><span sx={styles.b} /></>',
      errors: [{ messageId: 'rename' }, { messageId: 'rename' }],
    },
    {
      // from/to are plain arguments, so any pair of names works
      code: '<div classStyle={styles.text} />',
      options: [{ from: 'classStyle', to: 'cx' }],
      output: '<div cx={styles.text} />',
      errors: [{ messageId: 'rename' }],
    },
    {
      // renaming onto a member expression is reported, not rewritten
      code: 'const Card = (props) => <div styleName={props.styleName} />;',
      options,
      output: 'const Card = (props) => <div sx={props.styleName} />;',
      errors: [{ messageId: 'rename' }, { messageId: 'manual' }],
    },
    {
      code: 'const Card = ({ styleName }) => <div styleName={styleName} />;',
      options,
      output: 'const Card = ({ styleName }) => <div sx={styleName} />;',
      errors: [{ messageId: 'manual' }, { messageId: 'rename' }],
    },
  ],
});

tsTester.run('rename-prop (types)', renameProp, {
  valid: [
    {
      // the key alone is not enough — an unrelated interface is left alone
      code: 'interface Row { styleName?: string }',
      options,
    },
    {
      code: 'interface Props { styleName?: Style }',
      options: [{ from: 'styleName', to: 'sx', includeTypes: false }],
    },
    {
      code: 'interface Props { sx?: Style }',
      options,
    },
    {
      code: 'interface Props { styleName }',
      options,
    },
  ],
  invalid: [
    {
      code: 'interface Props { styleName?: Style }',
      options,
      output: 'interface Props { sx?: Style }',
      errors: [{ messageId: 'rename' }],
    },
    {
      // the global augmentation in plumeria.d.ts
      code: 'declare global { namespace React { interface HTMLAttributes<T> { styleName?: Style } } }',
      options,
      output:
        'declare global { namespace React { interface HTMLAttributes<T> { sx?: Style } } }',
      errors: [{ messageId: 'rename' }],
    },
    {
      code: 'interface Props { styleName?: Style | undefined }',
      options,
      output: 'interface Props { sx?: Style | undefined }',
      errors: [{ messageId: 'rename' }],
    },
    {
      code: 'interface Props { styleName?: Plumeria.Style }',
      options,
      output: 'interface Props { sx?: Plumeria.Style }',
      errors: [{ messageId: 'rename' }],
    },
    {
      code: 'const { styleName } = props;',
      options,
      output: null,
      errors: [{ messageId: 'manual' }],
    },
  ],
});
