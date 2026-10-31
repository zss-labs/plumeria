import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { implementations } from '../compiler-implementations';

const CORE = `import * as css from '@plumeria/core';\n`;

const TOKENS = `${CORE}export const blue = css.createStatic({ '500': '#111111' });
export const bp = css.createStatic({ '500': '@media (max-width: 500px)' });
export const theme = css.createTheme('.dark', { '500': { default: '#444444', theme: '#555555' } });
`;

const IMPORTS = `import { blue, bp, theme } from './tokens';\n`;

type Form = {
  name: string;
  imports?: string;
  head?: (key: string) => string;
  styles: (key: string) => string;
  use?: string;
  expected: RegExp;
};

const FORMS: Form[] = [
  {
    name: 'a createStatic value',
    styles: (key) => `{ base: { color: blue${key} } }`,
    expected: /color: #111111/,
  },
  {
    name: 'a namespace read',
    imports: `import * as t from './tokens';\n`,
    styles: (key) => `{ base: { color: t.blue${key} } }`,
    expected: /color: #111111/,
  },
  {
    name: 'a createStatic value of the same module',
    head: () => `const local = css.createStatic({ '500': '#111111' });\n`,
    styles: (key) => `{ base: { color: local${key} } }`,
    expected: /color: #111111/,
  },
  {
    name: 'a createTheme variable',
    styles: (key) => `{ base: { color: theme${key} } }`,
    expected: /color: var\(--/,
  },
  {
    name: 'a computed key',
    styles: (key) => `{ base: { [bp${key}]: { padding: 7 } } }`,
    expected: /@media \(max-width: 500px\)[\s\S]*padding: 7px/,
  },
  {
    name: 'an interpolation',
    styles: (key) => `{ base: { border: \`1px solid \${blue${key}}\` } }`,
    expected: /border: 1px solid #111111/,
  },
  {
    name: 'a function style',
    styles: (key) =>
      `{ base: (m: string) => ({ color: blue${key}, margin: m }) }`,
    use: `card.base('1px')`,
    expected: /color: #111111/,
  },
  {
    name: 'a createStatic value reading another',
    head: (key) => `const again = css.createStatic({ a: blue${key} });\n`,
    styles: () => `{ base: { color: again.a } }`,
    expected: /color: #111111/,
  },
  {
    name: 'a createTheme value',
    head: (key) =>
      `const ink = css.createTheme('.ink', { a: { default: blue${key}, theme: '#999999' } });\n`,
    styles: () => `{ base: { color: ink.a } }`,
    expected: /#111111/,
  },
  {
    name: 'a keyframes value',
    head: (key) =>
      `const fade = css.keyframes({ from: { color: blue${key} }, to: { color: '#999999' } });\n`,
    styles: () => `{ base: { animationName: fade, animationDuration: '1s' } }`,
    expected: /#111111/,
  },
];

const READS: [string, string, string][] = [
  ['a number', '[500]', ''],
  ['a parenthesized number', '[(500)]', ''],
  ['a number with a type', '[500 as number]', ''],
  ['another spelling of the number', '[0x1f4]', ''],
  ['a const number', '[k]', 'const k = 500;\n'],
  ['a const string', '[k]', `const k = '500';\n`],
];

const elementOf = (code: string) => code.match(/<div[^>]*\/>/)?.[0];

describe.each(implementations)('$name', ({ transformSource, compileCSS }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-numeric-member-key-')),
  );
  let count = 0;

  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

  const project = (files: Record<string, string>) => {
    const cwd = path.join(DIR, String(count++));
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, 'package.json'), '{ "name": "app" }');
    fs.writeFileSync(path.join(cwd, 'tokens.ts'), TOKENS);
    for (const [name, source] of Object.entries(files)) {
      fs.writeFileSync(path.join(cwd, name), source);
    }
    return cwd;
  };

  const transform = async (cwd: string, file: string) => {
    const filePath = path.join(cwd, file);
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

  const sheet = (cwd: string) =>
    compileCSS({ cwd, include: ['app.tsx'], exclude: [] });

  const declarations = (form: Form, key: string, constant = '') =>
    `${CORE}${form.imports ?? IMPORTS}${constant}${form.head?.(key) ?? ''}`;

  const inOneFile = async (form: Form, key: string, constant?: string) => {
    const cwd = project({
      'app.tsx': `${declarations(form, key, constant)}const card = css.create(${form.styles(key)});
export const App = () => <div classStyle={${form.use ?? 'card.base'}} />;
`,
    });
    return {
      element: elementOf(await transform(cwd, 'app.tsx')),
      css: sheet(cwd),
    };
  };

  const acrossFiles = async (form: Form, key: string, constant?: string) => {
    const cwd = project({
      'card.ts': `${declarations(form, key, constant)}export const card = css.create(${form.styles(key)});
`,
      'app.tsx': `import { card } from './card';
export const App = () => <div classStyle={${form.use ?? 'card.base'}} />;
`,
    });
    await transform(cwd, 'card.ts');
    return {
      element: elementOf(await transform(cwd, 'app.tsx')),
      css: sheet(cwd),
    };
  };

  describe.each(FORMS)('$name', (form) => {
    it('compiles the quoted key the others are held to', async () => {
      for (const compile of [inOneFile, acrossFiles]) {
        const { element, css } = await compile(form, `['500']`);
        expect(element).toMatch(/className=\{"x/);
        expect(css).toMatch(form.expected);
      }
    });

    it.each(READS)(
      'reads %s like the quoted key in one file',
      async (_, key, constant) => {
        expect(await inOneFile(form, key, constant)).toEqual(
          await inOneFile(form, `['500']`),
        );
      },
    );

    it.each(READS)(
      'reads %s like the quoted key across files',
      async (_, key, constant) => {
        expect(await acrossFiles(form, key, constant)).toEqual(
          await acrossFiles(form, `['500']`),
        );
      },
    );
  });

  it('stops the build for a number the object does not hold', async () => {
    for (const declaration of [
      IMPORTS,
      `const blue = css.createStatic({ '500': '#111111' });\n`,
    ]) {
      const cwd = project({
        'app.tsx': `${CORE}${declaration}const card = css.create({ base: { color: blue[999] } });
export const App = () => <div classStyle={card.base} />;
`,
      });
      await expect(transform(cwd, 'app.tsx')).rejects.toThrow(
        /Cannot resolve the value of "color" at build time \(blue\[999\]\)/,
      );
    }
  });

  it('does not read a function parameter as the const it shadows', async () => {
    const cwd = project({
      'card.ts': `${CORE}${IMPORTS}const k = '500';
export const card = css.create({ base: (k: string) => ({ color: blue[k], margin: k }) });
`,
      'app.tsx': `import { card } from './card';
export const App = () => <div classStyle={card.base('1px')} />;
`,
    });
    await transform(cwd, 'app.tsx');
    const css = sheet(cwd);
    expect(css).toMatch(/margin: var\(--/);
    expect(css).not.toContain('#111111');
  });
});
