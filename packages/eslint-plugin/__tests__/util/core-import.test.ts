import type { Rule } from 'eslint';
import { importedFromCore } from '../../src/util/coreImport';

test('rejects a non-identifier before looking up its import', () => {
  expect(
    importedFromCore(
      {} as Rule.RuleContext,
      { type: 'Literal', value: 1 },
      '*',
    ),
  ).toBe(false);
});
