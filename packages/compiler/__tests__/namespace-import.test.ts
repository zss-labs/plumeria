// A namespace import reads the same exports a named import does, so every
// case here compiles twice, once through `import { x }` and once through
// `import * as t`, and both builds have to come out the same.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { implementations } from '../compiler-implementations';

const TOKENS = `import * as css from '@plumeria/core';
export const blue = css.createStatic({ '500': '#3b82f6' });
export const theme = css.createTheme('.dark', { ink: { default: 'black', theme: 'white' } });
export const spin = css.keyframes({ to: { transform: 'rotate(360deg)' } });
export const vt = css.viewTransitionClass({ old: { opacity: 0 }, new: { opacity: 1 } });
export const above = css.positionTry({ positionArea: 'top' });
export const n = Math.random();
export const styles = css.create({
  card: { padding: 12 },
  accent: { color: 'red' },
  box: (size: number) => ({ width: size }),
});
`;

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'app',
    dependencies: { 'theme-pkg': '1.0.0' },
  }),
  'tokens.ts': TOKENS,
  'barrel.ts': `export * from './tokens';\n`,
  'Leaf.tsx': `import * as css from '@plumeria/core';
export const Leaf = ({ styleArray }: { styleArray?: css.Style }) => (
  <div classStyle={styleArray} />
);
`,
  'node_modules/theme-pkg/package.json': JSON.stringify({
    name: 'theme-pkg',
    exports: { '.': { plumeria: './src/index.ts' } },
  }),
  'node_modules/theme-pkg/src/index.ts': TOKENS,
};

type Ref = (name: string) => string;

const CASES: Array<[string, string, string[], (r: Ref) => string]> = [
  [
    'a createStatic value',
    './tokens',
    ['blue'],
    (r) => `const s = css.create({ a: { color: ${r('blue')}[500] } });
export const A = () => <div classStyle={s.a} />;`,
  ],
  [
    'a createTheme variable',
    './tokens',
    ['theme'],
    (r) => `const s = css.create({ a: { color: ${r('theme')}.ink } });
export const A = () => <div classStyle={s.a} />;`,
  ],
  [
    'a keyframes name',
    './tokens',
    ['spin'],
    (
      r,
    ) => `const s = css.create({ a: { animation: \`\${${r('spin')}} 1s linear infinite\` } });
export const A = () => <div classStyle={s.a} />;`,
  ],
  [
    'a viewTransitionClass name',
    './tokens',
    ['vt'],
    (
      r,
    ) => `const s = css.create({ a: { viewTransitionClass: \`\${${r('vt')}}\` } });
export const A = () => <div classStyle={s.a} />;`,
  ],
  [
    'a positionTry name',
    './tokens',
    ['above'],
    (
      r,
    ) => `const s = css.create({ a: { positionTryFallbacks: \`\${${r('above')}}, flip-inline\` } });
export const A = () => <div classStyle={s.a} />;`,
  ],
  [
    'a css.create style on classStyle',
    './tokens',
    ['styles'],
    (r) => `export const A = () => <div classStyle={${r('styles')}.card} />;`,
  ],
  [
    'css.create styles in a conditional array',
    './tokens',
    ['styles'],
    (r) => `export const A = ({ on }: { on: boolean }) => (
  <div classStyle={[${r('styles')}.card, on && ${r('styles')}.accent]} />
);`,
  ],
  [
    'a css.create style through css.use',
    './tokens',
    ['styles'],
    (r) =>
      `export const A = () => <div className={css.use(${r('styles')}.card)} />;`,
  ],
  [
    'a dynamic css.create style',
    './tokens',
    ['styles'],
    (r) =>
      `export const A = () => <div classStyle={${r('styles')}.box(10)} />;`,
  ],
  [
    'a css.create style passed to a component prop',
    './tokens',
    ['styles'],
    (r) => `import { Leaf } from './Leaf';
export const A = () => <Leaf styleArray={${r('styles')}.card} />;`,
  ],
  [
    'a value re-exported through export *',
    './barrel',
    ['blue', 'styles'],
    (r) => `const s = css.create({ a: { color: ${r('blue')}[500] } });
export const A = () => <div classStyle={[s.a, ${r('styles')}.card]} />;`,
  ],
  [
    'a package exposing the plumeria condition',
    'theme-pkg',
    ['blue', 'spin', 'styles'],
    (
      r,
    ) => `const s = css.create({ a: { color: ${r('blue')}[500], animation: \`\${${r('spin')}} 1s\` } });
export const A = () => <div classStyle={[s.a, ${r('styles')}.card]} />;`,
  ],
];

describe.each(implementations)('$name', ({ transformSource, compileCSS }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-namespace-import-')),
  );
  let count = 0;

  const write = (app: string) => {
    const cwd = path.join(DIR, String(count++));
    for (const [name, source] of Object.entries({ ...FILES, 'app.tsx': app })) {
      fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
      fs.writeFileSync(path.join(cwd, name), source);
    }
    return cwd;
  };

  const transform = (cwd: string) => {
    const filePath = path.join(cwd, 'app.tsx');
    return transformSource({
      source: fs.readFileSync(filePath, 'utf8'),
      moduleId: filePath,
      filePath,
      root: cwd,
      cwd,
      isDev: false,
    });
  };

  const build = async (app: string) => {
    const cwd = write(app);
    const { code } = await transform(cwd);
    return {
      code: code.replace(
        /^import .* from '(\.\/tokens|\.\/barrel|theme-pkg)';$/gm,
        '',
      ),
      sheet: compileCSS({ cwd, include: ['app.tsx'], exclude: [] }),
    };
  };

  // Kept first: the TypeScript implementation starts this file with nothing
  // scanned, as a process does whose first transform reads a namespace.
  it('reads a namespace before anything was scanned', async () => {
    const { code, sheet } = await build(`import * as css from '@plumeria/core';
import * as t from './tokens';
const s = css.create({ a: { color: t.blue[500] } });
export const A = () => <div classStyle={s.a} />;
`);
    expect(code).toContain('className={"');
    expect(sheet).toContain('#3b82f6');
  });

  it.each(CASES)('reads %s', async (_, source, names, body) => {
    const named = await build(`import * as css from '@plumeria/core';
import { ${names.join(', ')} } from '${source}';
${body((name) => name)}
`);
    const namespace = await build(`import * as css from '@plumeria/core';
import * as t from '${source}';
${body((name) => `t.${name}`)}
`);
    expect(namespace).toEqual(named);
    expect(namespace.code).not.toContain('t.');
  });

  it('rejects an export the namespace does not have', async () => {
    await expect(
      build(`import * as css from '@plumeria/core';
import * as t from './tokens';
const s = css.create({ a: { color: t.nope } });
export const A = () => <div classStyle={s.a} />;
`),
    ).rejects.toThrow(/Cannot resolve/);
  });

  it('names an unresolvable namespace read as written', async () => {
    const cwd = write(`import * as css from '@plumeria/core';
import * as t from './tokens';
const s = css.create({ a: { width: t.n } });
export const A = () => <div classStyle={s.a} />;
`);
    await expect(transform(cwd)).rejects.toThrow('(t.n)');
  });

  it('names a spread namespace style as written', async () => {
    const cwd = write(`import * as css from '@plumeria/core';
import * as t from './tokens';
export const A = () => <div classStyle={[...t.styles.card]} />;
`);
    await expect(transform(cwd)).rejects.toThrow('"...t.styles.card"');
    expect(() =>
      compileCSS({ cwd, include: ['app.tsx'], exclude: [] }),
    ).toThrow('"...t.styles.card"');
  });

  it('leaves a local binding that shadows the namespace alone', async () => {
    const { code, sheet } = await build(`import * as css from '@plumeria/core';
import * as t from './tokens';
const s = css.create({ a: { color: t.blue[500] } });
export const A = ({ t }: { t: { blue: string } }) => (
  <p classStyle={s.a}>{t.blue}</p>
);
`);
    expect(code).toContain('{t.blue}');
    expect(sheet).toContain('#3b82f6');
  });
});
