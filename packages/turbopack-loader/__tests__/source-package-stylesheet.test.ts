// The stylesheet collects a source package's styles from the directories its
// `plumeria` exports point at. Only the user's explicit `exclude` applies to
// those files; the default exclude would drop everything under node_modules.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compileStylesheet } from '../src/index';

const DIR = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-source-package-')),
);
const PKG = path.join(DIR, 'node_modules', 'ui-kit');

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

beforeAll(() => {
  write(
    path.join(DIR, 'package.json'),
    JSON.stringify({ dependencies: { 'ui-kit': '1.0.0' } }),
  );
  write(
    path.join(PKG, 'package.json'),
    JSON.stringify({
      name: 'ui-kit',
      exports: {
        '.': { plumeria: './src/index.ts', default: './dist/index.js' },
      },
    }),
  );
  write(
    path.join(PKG, 'src', 'index.ts'),
    `export { Button } from './Button';\n`,
  );
  write(
    path.join(PKG, 'src', 'Button.tsx'),
    `import * as css from '@plumeria/core';
const styles = css.create({ base: { color: 'rgb(1, 2, 3)' } });
export const Button = () => <button sx={styles.base} />;
`,
  );
  write(
    path.join(PKG, 'src', 'Button.test.tsx'),
    `import * as css from '@plumeria/core';
const styles = css.create({ probe: { color: 'rgb(7, 7, 7)' } });
export const Probe = () => <div sx={styles.probe} />;
`,
  );
});

afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

it('collects every file under the exported source directory by default', () => {
  const css = compileStylesheet({}, DIR);

  expect(css).toContain('rgb(1, 2, 3)');
  expect(css).toContain('rgb(7, 7, 7)');
});

it.each(['**/node_modules/**', 'node_modules/**'])(
  'keeps package styles when exclude carries the broad %s pattern',
  (pattern) => {
    const css = compileStylesheet({ exclude: [pattern, '**/.next/**'] }, DIR);

    expect(css).toContain('rgb(1, 2, 3)');
  },
);

it('honors an explicit exclude that names a path inside node_modules', () => {
  const css = compileStylesheet(
    { exclude: ['**/node_modules/ui-kit/src/**/*.test.tsx'] },
    DIR,
  );

  expect(css).toContain('rgb(1, 2, 3)');
  expect(css).not.toContain('rgb(7, 7, 7)');
});
