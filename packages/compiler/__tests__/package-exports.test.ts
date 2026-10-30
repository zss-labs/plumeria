import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ transformSource, compileCSS }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-package-exports-')),
  );
  let count = 0;

  const TOKENS = {
    'package.json': JSON.stringify({
      name: 'tw-tokens',
      exports: {
        '.': { plumeria: './src/index.ts', default: './dist/index.js' },
        './colors': {
          plumeria: './src/colors.ts',
          default: './dist/colors.js',
        },
      },
    }),
    'src/index.ts': `export * from './colors';
export { card } from './card';
export { theme } from './theme';
`,
    'src/colors.ts': `import * as css from '@plumeria/core';
export const colors = css.createStatic({ navy: '#001f3f' });
`,
    'src/card.ts': `import * as css from '@plumeria/core';
export const card = css.create({ base: { padding: 12 } });
`,
    'src/theme.ts': `import * as css from '@plumeria/core';
export const theme = css.createTheme('.dark', { ink: { default: 'black', theme: 'white' } });
`,
  };

  const UNMARKED = {
    'package.json': JSON.stringify({
      name: 'plain-tokens',
      exports: { '.': { default: './src/index.ts' } },
    }),
    'src/index.ts': `import * as css from '@plumeria/core';
export const colors = css.createStatic({ navy: '#001f3f' });
`,
  };

  const WILD = {
    'package.json': JSON.stringify({
      name: 'wild-tokens',
      exports: {
        './*': { plumeria: './src/*.ts', default: './dist/*.js' },
        './tokens/*': {
          plumeria: './src/brand-tokens/*.ts',
          default: './dist/brand-tokens/*.js',
        },
      },
    }),
    'src/colors.ts': `import * as css from '@plumeria/core';
export const colors = css.createStatic({ navy: '#001f3f' });
`,
    'src/tokens/brand/colors.ts': `import * as css from '@plumeria/core';
export const colors = css.createStatic({ navy: '#abcdef' });
`,
    'src/brand-tokens/brand/colors.ts': `import * as css from '@plumeria/core';
export const colors = css.createStatic({ navy: '#654321' });
`,
  };

  const setup = (
    app: string,
    {
      dependencies = {
        'tw-tokens': '1.0.0',
        'plain-tokens': '1.0.0',
        'wild-tokens': '1.0.0',
      },
      linked = false,
    }: { dependencies?: Record<string, string>; linked?: boolean } = {},
  ) => {
    const cwd = path.join(DIR, String(count++));
    const write = (base: string, files: Record<string, string>) => {
      for (const [name, source] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(base, name)), { recursive: true });
        fs.writeFileSync(path.join(base, name), source);
      }
    };
    write(cwd, {
      'package.json': JSON.stringify({ name: 'app', dependencies }),
      'app.tsx': app,
    });
    if (linked) {
      const store = path.join(
        cwd,
        'node_modules/.pnpm/tw-tokens@1.0.0/node_modules/tw-tokens',
      );
      write(store, TOKENS);
      fs.symlinkSync(store, path.join(cwd, 'node_modules/tw-tokens'), 'dir');
    } else {
      write(path.join(cwd, 'node_modules/tw-tokens'), TOKENS);
    }
    write(path.join(cwd, 'node_modules/plain-tokens'), UNMARKED);
    write(path.join(cwd, 'node_modules/wild-tokens'), WILD);
    return cwd;
  };

  const transform = async (cwd: string) => {
    const filePath = path.join(cwd, 'app.tsx');
    const { code } = await transformSource({
      source: fs.readFileSync(filePath, 'utf-8'),
      moduleId: filePath,
      filePath,
      root: cwd,
      cwd,
      isDev: false,
    });
    return code;
  };

  const css = (cwd: string) =>
    compileCSS({ cwd, include: ['app.tsx'], exclude: [] });

  it('reads a createStatic value from a package', async () => {
    const cwd = setup(`import * as css from '@plumeria/core';
import { colors } from 'tw-tokens';
const styles = css.create({ main: { color: colors.navy } });
export const App = () => <div classStyle={styles.main} />;
`);
    const code = await transform(cwd);
    expect(code).not.toContain("from 'tw-tokens'");
    expect(css(cwd)).toContain('#001f3f');
  });

  it('reads a css.create style from a package', async () => {
    const cwd = setup(`import { card } from 'tw-tokens';
export const App = () => <div classStyle={card.base} />;
`);
    const code = await transform(cwd);
    expect(code).not.toContain('classStyle');
    expect(code).not.toContain("from 'tw-tokens'");
    expect(css(cwd)).toMatch(/padding:\s*12px/);
  });

  it('reads a createTheme variable from a package', async () => {
    const cwd = setup(`import * as css from '@plumeria/core';
import { theme } from 'tw-tokens';
const styles = css.create({ main: { color: theme.ink } });
export const App = () => <div classStyle={styles.main} />;
`);
    await transform(cwd);
    expect(css(cwd)).toMatch(/color:\s*var\(--[^)]*ink\)/);
  });

  it('reads a subpath export', async () => {
    const cwd = setup(`import * as css from '@plumeria/core';
import { colors } from 'tw-tokens/colors';
const styles = css.create({ main: { color: colors.navy } });
export const App = () => <div classStyle={styles.main} />;
`);
    await transform(cwd);
    expect(css(cwd)).toContain('#001f3f');
  });

  it('reads a package linked from a pnpm store', async () => {
    const cwd = setup(
      `import * as css from '@plumeria/core';
import { colors } from 'tw-tokens';
const styles = css.create({ main: { color: colors.navy } });
export const App = () => <div classStyle={styles.main} />;
`,
      { linked: true },
    );
    await transform(cwd);
    expect(css(cwd)).toContain('#001f3f');
  });

  it('does not read a package without the plumeria condition', async () => {
    const cwd = setup(`import * as css from '@plumeria/core';
import { colors } from 'plain-tokens';
const styles = css.create({ main: { color: colors.navy } });
export const App = () => <div classStyle={styles.main} />;
`);
    await expect(transform(cwd)).rejects.toThrow(/Cannot resolve the value/);
  });

  it('does not read a package the app does not depend on', async () => {
    const cwd = setup(
      `import * as css from '@plumeria/core';
import { colors } from 'tw-tokens';
const styles = css.create({ main: { color: colors.navy } });
export const App = () => <div classStyle={styles.main} />;
`,
      { dependencies: {} },
    );
    await expect(transform(cwd)).rejects.toThrow(/Cannot resolve the value/);
  });

  it('follows a package that pnpm relinked to another version', async () => {
    const cwd = setup(
      `import * as css from '@plumeria/core';
import { colors } from 'tw-tokens';
const styles = css.create({ main: { color: colors.navy } });
export const App = () => <div classStyle={styles.main} />;
`,
      { linked: true },
    );
    await transform(cwd);
    expect(css(cwd)).toContain('#001f3f');

    const next = path.join(
      cwd,
      'node_modules/.pnpm/tw-tokens@2.0.0/node_modules/tw-tokens',
    );
    fs.cpSync(
      path.join(
        cwd,
        'node_modules/.pnpm/tw-tokens@1.0.0/node_modules/tw-tokens',
      ),
      next,
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(next, 'src/colors.ts'),
      `import * as css from '@plumeria/core';
export const colors = css.createStatic({ navy: '#123456' });
`,
    );
    fs.rmSync(path.join(cwd, 'node_modules/.pnpm/tw-tokens@1.0.0'), {
      recursive: true,
    });
    fs.unlinkSync(path.join(cwd, 'node_modules/tw-tokens'));
    fs.symlinkSync(next, path.join(cwd, 'node_modules/tw-tokens'), 'dir');

    await transform(cwd);
    expect(css(cwd)).toContain('#123456');
  });

  it('follows an exports change in the package', async () => {
    const cwd = setup(`import * as css from '@plumeria/core';
import { colors } from 'tw-tokens/palette';
const styles = css.create({ main: { color: colors.navy } });
export const App = () => <div classStyle={styles.main} />;
`);
    await expect(transform(cwd)).rejects.toThrow(/Cannot resolve the value/);

    const manifest = path.join(cwd, 'node_modules/tw-tokens/package.json');
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
    pkg.exports['./palette'] = { plumeria: './src/colors.ts' };
    fs.writeFileSync(manifest, JSON.stringify(pkg));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(manifest, later, later);

    await transform(cwd);
    expect(css(cwd)).toContain('#001f3f');
  });

  it.each([
    ['a wildcard subpath', 'wild-tokens/colors', '#001f3f'],
    [
      'a wildcard match across slashes',
      'wild-tokens/tokens/brand/colors',
      '#654321',
    ],
  ])('reads %s', async (_, source, value) => {
    const cwd = setup(`import * as css from '@plumeria/core';
import { colors } from '${source}';
const styles = css.create({ main: { color: colors.navy } });
export const App = () => <div classStyle={styles.main} />;
`);
    await transform(cwd);
    expect(css(cwd)).toContain(value);
  });
});
