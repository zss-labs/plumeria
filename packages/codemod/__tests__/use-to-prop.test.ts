import { RuleTester } from 'eslint';
import { useToProp } from '../src/transforms/use-to-prop';

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
});

const options = [{ prop: 'sx' }];
const imports = "import * as css from '@plumeria/core';\n";

ruleTester.run('use-to-prop', useToProp, {
  valid: [
    {
      code: imports + '<div sx={styles.text} />',
      options,
    },
    {
      code: "import * as css from 'other';\n<div className={css.use(styles.text)} />",
      options,
    },
    {
      code: '<div className={use(styles.text)} />',
      options,
    },
    {
      code:
        imports +
        'function View(css) { return <div className={css.use(x)} />; }',
      options,
    },
  ],
  invalid: [
    {
      code: imports + '<div className={css.use(styles.text)} />',
      output: imports + '<div sx={styles.text} />',
      options,
      errors: [{ messageId: 'rewrite' }],
    },
    {
      code: imports + '<div className={css.use(styles.a, on && styles.b)} />',
      output: imports + '<div sx={[styles.a, on && styles.b]} />',
      options,
      errors: [{ messageId: 'rewrite' }],
    },
    {
      code: imports + '<div className={css.use((a, b), c)} />',
      output: imports + '<div sx={[(a, b), c]} />',
      options,
      errors: [{ messageId: 'rewrite' }],
    },
    {
      code: imports + '<div className={css.use(...list)} />',
      output: imports + '<div sx={[...list]} />',
      options,
      errors: [{ messageId: 'rewrite' }],
    },
    {
      code:
        "import { use as cx } from '@plumeria/core';\n" +
        '<div className={cx(styles.text)} />',
      output:
        "import { use as cx } from '@plumeria/core';\n" +
        '<div classStyle={styles.text} />',
      options: [{ prop: 'classStyle' }],
      errors: [{ messageId: 'rewrite' }],
    },
    {
      code: imports + '<div className={clsx("x", css.use(styles.text))} />',
      output: null,
      options,
      errors: [{ messageId: 'manual' }],
    },
    {
      code: imports + 'const cls = css.use(styles.text);',
      output: null,
      options,
      errors: [{ messageId: 'manual' }],
    },
    {
      code: imports + '<div sx={styles.a} className={css.use(styles.b)} />',
      output: null,
      options,
      errors: [{ messageId: 'manual' }],
    },
    {
      code: imports + '<Box className={css.use(a)} {...{ sx: b }} />',
      output: null,
      options,
      errors: [{ messageId: 'manual' }],
    },
    {
      code: imports + '<Box {...props} className={css.use(a)} />',
      output: null,
      options,
      errors: [{ messageId: 'manual' }],
    },
  ],
});
