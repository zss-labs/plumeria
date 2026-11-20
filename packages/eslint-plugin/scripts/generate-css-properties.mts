import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const output = path.join(
  import.meta.dirname,
  '..',
  'src',
  'util',
  'cssPropertyData.ts',
);

const core = path.join(
  import.meta.dirname,
  '..',
  '..',
  'core',
  'package.json',
);
const require = createRequire(core);
const source = fs.readFileSync(require.resolve('cssdefs/index.d.ts'), 'utf8');

const body = source.match(/^export type CSSDefs = Readonly<\{\n([\s\S]*?)^\}>;/m);
if (!body) throw new Error('CSSDefs was not found in cssdefs/index.d.ts');

const names = [...body[1].matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*)\?:/gm)].map(
  (match) => match[1],
);
names.sort();

fs.writeFileSync(
  output,
  `const cssPropertyData = [\n${names.map((name) => `  '${name}',`).join('\n')}\n];\n\nexport { cssPropertyData };\n`,
);

console.log(`${names.length} properties written to ${output}`);
