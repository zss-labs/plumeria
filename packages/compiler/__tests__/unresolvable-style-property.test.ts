import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_STYLE_PROP } from '@plumeria/utils';
import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ transformSource }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-key-')),
  );
  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

  fs.writeFileSync(path.join(DIR, 'package.json'), '{ "name": "app" }');
  fs.writeFileSync(
    path.join(DIR, 'constants.ts'),
    `export const MOBILE = '@media (max-width: 640px)';\nexport const COLOR = 'color';\nexport const box = { sm: '@media (max-width: 640px)' };`,
  );
  fs.writeFileSync(
    path.join(DIR, 'tokens.ts'),
    `import * as css from '@plumeria/core';\nexport const breakpoints = css.createStatic({ sm: '@media (max-width: 640px)' });\nexport const fade = css.keyframes({ from: { opacity: 0 } });`,
  );
  fs.writeFileSync(
    path.join(DIR, 'plain.ts'),
    `declare const k: number;\nconst read = () => ({});\nexport const plain = { k, ...read(), run() {}, get value() { return 1; } };`,
  );

  const run = (body: string) =>
    transformSource({
      source: `import * as css from '@plumeria/core';\n${body}`,
      moduleId: `${DIR}/fixture.tsx`,
      filePath: `${DIR}/fixture.tsx`,
      root: DIR,
      cwd: DIR,
      styleProp: DEFAULT_STYLE_PROP,
      propertyPolicy: undefined,
      isDev: false,
      addDependency: () => {},
    });

  const style = (key: string) =>
    `const s = css.create({ a: { padding: 16, [${key}]: { padding: 12 } } });`;

  describe('a computed key the build cannot inline', () => {
    it.each([
      [
        'a const from a plain module',
        `import { MOBILE } from './constants';\n${style('MOBILE')}`,
        '[MOBILE]',
      ],
      [
        'a member of a plain object from a plain module',
        `import { box } from './constants';\n${style('box.sm')}`,
        '[box.sm]',
      ],
      [
        'a definition from a package without the condition',
        `import { tokens } from 'not-a-plumeria-package';\n${style('tokens.sm')}`,
        '[tokens.sm]',
      ],
      [
        'a function call',
        `const read = () => ':hover';\n${style('read()')}`,
        '',
      ],
      [
        'a ternary on a runtime value',
        `declare const flag: boolean;\n${style("flag ? ':hover' : ':focus'")}`,
        '',
      ],
    ])('rejects %s', async (_name, body, label) => {
      await expect(run(body)).rejects.toThrow(
        `Cannot inline the computed key ${label}`,
      );
    });

    it('points at css.createStatic', async () => {
      await expect(
        run(`import { MOBILE } from './constants';\n${style('MOBILE')}`),
      ).rejects.toThrow(/Declare it with css\.createStatic/);
    });

    it('rejects one holding a declaration', async () => {
      await expect(
        run(
          `import { COLOR } from './constants';\nconst s = css.create({ a: { [COLOR]: 'red' } });`,
        ),
      ).rejects.toThrow('Cannot inline the computed key [COLOR]');
    });

    it('rejects one nested under a selector', async () => {
      await expect(
        run(
          `import { MOBILE } from './constants';\nconst s = css.create({ a: { ':hover': { [MOBILE]: { padding: 12 } } } });`,
        ),
      ).rejects.toThrow('Cannot inline the computed key [MOBILE]');
    });

    it('rejects one in a style function', async () => {
      await expect(
        run(
          `import { MOBILE } from './constants';\nconst s = css.create({ a: (width: string) => ({ width, [MOBILE]: { padding: 12 } }) });\nexport const A = () => <div classStyle={s.a('1px')} />;`,
        ),
      ).rejects.toThrow('Cannot inline the computed key [MOBILE]');
    });
  });

  describe('computed keys that stay accepted', () => {
    it.each([
      ['a string literal', style("':hover'")],
      ['a const in the file', `const key = ':hover';\n${style('key')}`],
      [
        'a createStatic in the file',
        `const b = css.createStatic({ sm: '@media (max-width: 640px)' });\n${style('b.sm')}`,
      ],
      [
        'an imported createStatic',
        `import { breakpoints } from './tokens';\n${style('breakpoints.sm')}`,
      ],
      [
        'a createStatic read through a namespace',
        `import * as tokens from './tokens';\n${style('tokens.breakpoints.sm')}`,
      ],
      ['a template literal', `const key = 'hover';\n${style('`:${key}`')}`],
      [
        'css.extended',
        `const s = css.create({ p: { ...css.marker('p', ':hover') }, a: { padding: 16, [css.extended('p', ':hover')]: { padding: 12 } } });`,
      ],
      [
        'a runtime key on ordinary data in the same file',
        `declare const k: string;\nexport const data = { [k]: 1 };\n${style("':hover'")}`,
      ],
      [
        'a runtime key in the argument of a style function',
        `declare const k: string;\nconst s = css.create({ a: (width: string) => ({ width }) });\nexport const A = () => <div classStyle={s.a({ [k]: 1, width: '1px' })} />;`,
      ],
    ])('accepts %s', async (_name, body) => {
      await expect(run(body)).resolves.toBeDefined();
    });
  });

  describe('a shorthand the build cannot resolve', () => {
    const margin = 'const margin = Math.max(8, 16);';

    it.each([
      ['in a style', `${margin}\nconst s = css.create({ a: { margin } });`],
      [
        'under a selector',
        `${margin}\nconst s = css.create({ a: { ':hover': { margin } } });`,
      ],
      [
        'in a spread const',
        `${margin}\nconst base = { margin };\nconst s = css.create({ a: { ...base } });`,
      ],
      [
        'in a style function',
        `${margin}\nconst s = css.create({ a: (width: string) => ({ width, margin }) });`,
      ],
    ])('rejects one %s', async (_name, body) => {
      await expect(run(body)).rejects.toThrow(
        'Cannot resolve the value of "margin" at build time',
      );
    });
  });

  describe('a spread the build cannot read', () => {
    const mixin = 'const mixin = () => ({ margin: 8 });';

    it.each([
      ['a helper', '...mixin()'],
      ['a helper with a type assertion', '...(mixin() as object)'],
      ['a helper behind a static condition', '...(DEBUG && mixin())'],
    ])('rejects %s', async (_name, spread) => {
      await expect(
        run(
          `${mixin}\nconst DEBUG = true;\nconst s = css.create({ a: { ${spread}, padding: 16 } });`,
        ),
      ).rejects.toThrow('Cannot spread');
    });

    it('rejects a member of a namespace', async () => {
      await expect(
        run(
          `const utils = { mixin: () => ({ margin: 8 }) };\nconst s = css.create({ a: { ...utils.mixin(), padding: 16 } });`,
        ),
      ).rejects.toThrow('Cannot spread a function call');
    });

    it('rejects one in a style function', async () => {
      await expect(
        run(
          `${mixin}\nconst s = css.create({ a: (width: string) => ({ ...mixin(), width }) });\nexport const A = () => <div classStyle={s.a('1px')} />;`,
        ),
      ).rejects.toThrow('Cannot spread a function call');
    });
  });

  describe('a method or an accessor', () => {
    it.each([
      ['a method', 'margin() { return 8; }'],
      ['a getter', 'get margin() { return 8; }'],
      ['a setter', 'set margin(value: number) {}'],
    ])('rejects %s', async (_name, member) => {
      await expect(
        run(`const s = css.create({ a: { padding: 16, ${member} } });`),
      ).rejects.toThrow('Cannot read the method or accessor "margin"');
    });

    it('rejects a style written as a method', async () => {
      await expect(
        run(`const s = css.create({ a() { return { padding: 16 }; } });`),
      ).rejects.toThrow('Cannot read the method or accessor "a"');
    });
  });

  describe('forms that stay accepted', () => {
    const accepted = (body: string) => run(body).then((result) => result.code);

    it('keeps a shorthand holding a const', async () => {
      const code = await accepted(
        `const margin = 8;\nconst s = css.create({ a: { margin } });\nexport const A = () => <div classStyle={s.a} />;`,
      );
      expect(code).toMatch(/className=\{?"x[a-z0-9]+"/);
    });

    it.each([
      ['a style', '{ animationName }', 's.a'],
      [
        'a style function',
        '(w: string) => ({ width: w, animationName })',
        "s.a('1px')",
      ],
    ])(
      'reads a shorthand holding keyframes in %s',
      async (_name, form, read) => {
        const compile = (imported: string, written: string) =>
          accepted(
            `import { ${imported} } from './tokens';\nconst s = css.create({ a: ${written} });\nexport const A = () => <div classStyle={${read}} />;`,
          );
        const short = await compile('fade as animationName', form);
        const long = await compile(
          'fade',
          form.replace('animationName', 'animationName: fade'),
        );
        expect(short).toEqual(long);
      },
    );

    it.each([
      [
        'a parameter of a style function',
        `const s = css.create({ a: (width: string) => ({ width }) });\nexport const A = () => <div classStyle={s.a('1px')} />;`,
      ],
      [
        'a named parameter of a style function',
        `const s = css.create({ a: ({ width }: { width: string }) => ({ width }) });\nexport const A = () => <div classStyle={s.a({ width: '1px' })} />;`,
      ],
      [
        'a runtime shorthand in the argument of a style function',
        `const s = css.create({ a: ({ width }: { width: string }) => ({ width }) });\nexport const A = ({ width }: { width: string }) => <div classStyle={s.a({ width })} />;`,
      ],
      [
        'a shorthand replaced later',
        `const margin = Math.max(8, 16);\nconst s = css.create({ a: { margin, margin: 8 } });`,
      ],
      [
        'css.marker',
        `const s = css.create({ a: { ...css.marker('p', ':hover') } });`,
      ],
      [
        'a const object',
        `const base = { margin: 8 };\nconst s = css.create({ a: { ...base } });`,
      ],
      ['null', `const s = css.create({ a: { ...null, padding: 16 } });`],
      [
        'a false condition',
        `const s = css.create({ a: { ...(false && { margin: 8 }), padding: 16 } });`,
      ],
      [
        'ordinary data in the same file',
        `declare const k: number;\nconst read = () => ({});\nexport const data = { k, ...read(), run() {}, get value() { return 1; } };\nconst s = css.create({ a: { padding: 16 } });`,
      ],
      [
        'ordinary data imported from a plain module',
        `import { plain } from './plain';\nconst s = css.create({ a: { padding: 16 } });\nexport const value = plain;`,
      ],
    ])('accepts %s', async (_name, body) => {
      await expect(run(body)).resolves.toBeDefined();
    });
  });
});
