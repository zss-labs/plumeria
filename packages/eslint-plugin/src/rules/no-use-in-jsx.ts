import type { Rule } from 'eslint';
import { resolveStyleProp, stylePropSchema } from '../util/style-prop';
import { callsCore } from '../util/coreImport';

const JSX_FILE = /\.[jt]sx$/;

export const noUseInJsx: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow css.use() in .jsx and .tsx files, where the styling prop applies styles',
    },
    schema: stylePropSchema,
    messages: {
      jsx: 'css.use() is for templates that are not JSX. Apply the styles with {{styleProp}} instead.',
    },
  },
  create(context) {
    if (!JSX_FILE.test(context.filename)) return {};
    const styleProp = resolveStyleProp(context);
    return {
      CallExpression(node) {
        if (callsCore(context, node, 'use'))
          context.report({ node, messageId: 'jsx', data: { styleProp } });
      },
    };
  },
};
