import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  sourcePackages,
  transformSource,
  compileCSS,
  scanAll,
  resolveImportPath,
} from '../index';

// sourcePackages hands bundlers the list the resolver already holds, so the
// list a bundler reads and the one the compiler resolves through stay one.
const DIR = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-source-packages-')),
);
let count = 0;

const write = (base: string, files: Record<string, string>) => {
  for (const [name, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(base, name)), { recursive: true });
    fs.writeFileSync(path.join(base, name), source);
  }
};

const touch = (file: string) => {
  const later = new Date(Date.now() + 5000 * ++count);
  fs.utimesSync(file, later, later);
};

const setup = (dependencies: Record<string, string>) => {
  const cwd = path.join(DIR, String(count++));
  write(cwd, {
    'package.json': JSON.stringify({ name: 'app', dependencies }),
    'app.tsx': `import * as css from '@plumeria/core';
import { colors } from 'ui-kit/colors';
const styles = css.create({ main: { color: colors.navy } });
export const App = () => <div sx={styles.main} />;
`,
  });
  write(path.join(cwd, 'node_modules/ui-kit'), {
    'package.json': JSON.stringify({
      name: 'ui-kit',
      exports: {
        '.': { plumeria: './src/index.ts', default: './dist/index.js' },
        './*': { plumeria: './src/*.ts', default: './dist/*.js' },
      },
    }),
    'src/index.ts': `export * from './colors';\n`,
    'src/colors.ts': `import * as css from '@plumeria/core';
export const colors = css.createStatic({ navy: '#001f3f' });
`,
  });
  write(path.join(cwd, 'node_modules/plain'), {
    'package.json': JSON.stringify({ name: 'plain', exports: './index.js' }),
  });
  return cwd;
};

afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

it('lists the packages that export Plumeria source', () => {
  const cwd = setup({ 'ui-kit': '1.0.0', plain: '1.0.0' });
  const pkg = path.join(cwd, 'node_modules/ui-kit');

  expect(sourcePackages(cwd)).toEqual([
    {
      name: 'ui-kit',
      dir: pkg,
      exports: {
        '.': { plumeria: './src/index.ts', default: './dist/index.js' },
        './*': { plumeria: './src/*.ts', default: './dist/*.js' },
      },
      sourceDirs: [path.join(pkg, 'src')],
    },
  ]);
});

it('returns an empty list without a manifest', () => {
  expect(sourcePackages(path.join(DIR, 'missing'))).toEqual([]);
});

it('follows a dependency added to the app manifest', () => {
  const cwd = setup({ plain: '1.0.0' });
  expect(sourcePackages(cwd)).toEqual([]);

  const manifest = path.join(cwd, 'package.json');
  fs.writeFileSync(
    manifest,
    JSON.stringify({ name: 'app', dependencies: { 'ui-kit': '1.0.0' } }),
  );
  touch(manifest);

  expect(sourcePackages(cwd).map((pkg) => pkg.name)).toEqual(['ui-kit']);
});

it('follows an exports change in a listed package', () => {
  const cwd = setup({ 'ui-kit': '1.0.0' });
  expect(sourcePackages(cwd)).toHaveLength(1);

  const manifest = path.join(cwd, 'node_modules/ui-kit/package.json');
  fs.writeFileSync(
    manifest,
    JSON.stringify({ name: 'ui-kit', exports: './dist/index.js' }),
  );
  touch(manifest);

  expect(sourcePackages(cwd)).toEqual([]);
});

it('keeps resolving for the scanned root after listing another root', () => {
  const app = setup({ 'ui-kit': '1.0.0' });
  const other = setup({ plain: '1.0.0' });
  const importer = path.join(app, 'app.tsx');
  const colors = path.join(app, 'node_modules/ui-kit/src/colors.ts');

  scanAll(app);
  expect(resolveImportPath('ui-kit/colors', importer)).toBe(colors);

  expect(sourcePackages(other)).toEqual([]);
  scanAll(app);
  expect(resolveImportPath('ui-kit/colors', importer)).toBe(colors);
});

// Listing the packages after an exports change refreshes the list before the
// next scan sees it, so the refresh itself has to reach that scan.
it.each([false, true])(
  'recompiles with an exports change the list picked up first (transform: %s)',
  async (transform) => {
    const cwd = path.join(DIR, String(count++));
    const pkg = path.join(cwd, 'node_modules/ui-kit');
    const filePath = path.join(cwd, 'app.tsx');
    const exportsTo = (entry: string) => {
      const manifest = path.join(pkg, 'package.json');
      fs.writeFileSync(
        manifest,
        JSON.stringify({
          name: 'ui-kit',
          exports: { '.': { plumeria: entry } },
        }),
      );
      touch(manifest);
    };
    write(cwd, {
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: { 'ui-kit': '1.0.0' },
      }),
      'app.tsx': `import * as css from '@plumeria/core';
import { colors } from 'ui-kit';
const styles = css.create({ main: { color: colors.ink } });
export const App = () => <div sx={styles.main} />;
`,
    });
    write(pkg, {
      'src/red.ts': `import * as css from '@plumeria/core';
export const colors = css.createStatic({ ink: '#ab1234' });
`,
      'src/blue.ts': `import * as css from '@plumeria/core';
export const colors = css.createStatic({ ink: '#12ab34' });
`,
    });
    exportsTo('./src/red.ts');
    const compile = async () => {
      if (transform) {
        await transformSource({
          source: fs.readFileSync(filePath, 'utf-8'),
          moduleId: filePath,
          filePath,
          root: cwd,
          cwd,
          isDev: true,
        });
      }
      return compileCSS({ cwd, include: ['app.tsx'], exclude: [] });
    };
    expect(await compile()).toContain('#ab1234');

    exportsTo('./src/blue.ts');
    expect(sourcePackages(cwd)).toHaveLength(1);

    const css = await compile();
    expect(css).toContain('#12ab34');
    expect(css).not.toContain('#ab1234');
  },
);

it('keeps resolving through the list a bundler read first', async () => {
  const cwd = setup({ 'ui-kit': '1.0.0' });
  expect(sourcePackages(cwd)).toHaveLength(1);

  const filePath = path.join(cwd, 'app.tsx');
  await transformSource({
    source: fs.readFileSync(filePath, 'utf-8'),
    moduleId: filePath,
    filePath,
    root: cwd,
    cwd,
    isDev: false,
  });

  expect(compileCSS({ cwd, include: ['app.tsx'], exclude: [] })).toContain(
    '#001f3f',
  );
  expect(sourcePackages(cwd).map((pkg) => pkg.name)).toEqual(['ui-kit']);
});
