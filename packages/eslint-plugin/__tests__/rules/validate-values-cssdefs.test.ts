import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { RuleTester } from 'eslint';
import { validateValues } from '../../src/rules/validate-values';

const requireFromCore = createRequire(
  path.join(__dirname, '..', '..', '..', 'core', 'package.json'),
);
const source = fs.readFileSync(
  requireFromCore.resolve('cssdefs/index.d.ts'),
  'utf8',
);

const types = new Map<string, string>();
for (const match of source.matchAll(
  /^(?:export )?type (\w+) =([\s\S]*?);$/gm,
)) {
  types.set(match[1], match[2]);
}

function literals(name: string, seen = new Set<string>()): string[] {
  const body = types.get(name);
  if (body === undefined || seen.has(name)) return [];
  seen.add(name);
  return body
    .replace(/`[^`]*`/g, '')
    .split('|')
    .flatMap((part) => {
      const trimmed = part.trim();
      const literal = trimmed.match(/^'([^']*)'$/);
      if (literal) return [literal[1]];
      return /^\w+$/.test(trimmed) ? literals(trimmed, seen) : [];
    });
}

const body = source.match(
  /^export type CSSDefs = Readonly<\{\n([\s\S]*?)^\}>;/m,
);
const properties = [...body![1].matchAll(/^ {2}(\w+)\?:/gm)].map(
  (match) => match[1],
);

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
  },
});

ruleTester.run(
  'validate-values accepts every cssdefs literal',
  validateValues,
  {
    valid: properties.flatMap((property) => {
      const values = [...new Set(literals(property))];
      if (values.length === 0) return [];
      const styles = values
        .map((value, i) => `s${i}: { ${property}: ${JSON.stringify(value)} }`)
        .join(', ');
      return [
        {
          name: property,
          code: `import * as css from '@plumeria/core'; css.create({ ${styles} });`,
        },
      ];
    }),
    invalid: [],
  },
);
