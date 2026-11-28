import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { transformSync } from '@swc/core';
import { DEFAULT_STYLE_PROP } from '@plumeria/utils';
import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ transformSource, compileCSS }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-')),
  );
  const IMPORTED_STYLES = path.join(DIR, 'imported.styles.ts');

  const env = (source: string, filePath: string) => ({
    source,
    moduleId: filePath,
    filePath,
    root: DIR,
    cwd: DIR,
    styleProp: DEFAULT_STYLE_PROP,
    propertyPolicy: undefined,
    isDev: false,
    addDependency: () => {},
  });
  fs.writeFileSync(
    IMPORTED_STYLES,
    `import * as css from '@plumeria/core';
export const importedStyles = css.create({
  tone: (color: string) => ({ color, fontWeight: 700 }),
});
`,
  );

  const run = (
    code: string,
    name: string,
  ): Promise<{ code: string; sheets: string[] }> => {
    const file = path.join(DIR, name);
    fs.writeFileSync(file, code);
    return transformSource(env(code, file)).then((result) => ({
      code: result.code,
      sheets: [compileCSS({ include: [name], exclude: [], cwd: DIR })],
    }));
  };

  // A file left off the disk has no entry in the scan, so a component it renders
  // is read without knowing which props carry a style.
  const runUnscanned = (
    code: string,
    name: string,
  ): Promise<{ code: string }> =>
    transformSource(env(code, path.join(DIR, name)));

  const header = `import * as css from '@plumeria/core';
import { Box } from './box';
const s = css.create({ stat: { color: 'red' }, palette: (color: string) => ({ color }) });
`;

  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

  describe('dynamic function keys', () => {
    it.each([
      ['spaces', '  ', '\n'],
      ['tabs', '\t', '\r\n'],
    ])(
      'indents declarations after directives with %s',
      async (name, indent, newline) => {
        const source = [
          "import * as css from '@plumeria/core';",
          'const s = css.create({ w: (n) => ({ width: n }) });',
          'export function A({ readWidth }) {',
          `${indent}'use client';`,
          `${indent}return <div sx={s.w(readWidth())} />;`,
          '}',
        ].join(newline);
        const { code } = await run(source, `directive-${name}.tsx`);
        expect(code).toContain(
          [
            `'use client';`,
            `${indent}let __plumeria__$$a0;`,
            `${indent}return`,
          ].join(newline),
        );
      },
    );

    const defaults = `import * as css from '@plumeria/core';
const d = css.create({
  tinted: (c = 'teal') => ({ color: c }),
  plain: () => ({ color: 'olive' }),
  toned: ({ tone = 'navy' }) => ({ backgroundColor: tone }),
});
`;
    const classOf = (code: string) => code.match(/className="([^"]+)"/)?.[1];

    it.each([
      ['local', '__plumeria__$$a0', '__plumeria__$$a0'],
      [
        'escaped local',
        String.raw`\u005f_plumeria__$$a0`,
        String.raw`\u005f_plumeria__$$a0`,
      ],
      ['global', '', '__plumeria__$$a0'],
    ])(
      'preserves a reserved argument name (%s)',
      async (_, parameter, argument) => {
        const { code } = await run(
          header +
            `export function A(${parameter}) { return <div sx={s.palette(${argument}())} />; }`,
          'reserved-argument.tsx',
        );
        expect(code).toContain('style={((__plumeria__$$a0) => (');
        expect(code).toContain(argument);
        expect(code).not.toMatch(/\bconst __plumeria__\$\$a0\s*=/);
      },
    );

    it('declares the arguments in the function that returns the element', async () => {
      const { code } = await run(
        header +
          `export function A({ c }) {\n  return <div sx={s.palette(c())} />;\n}\nexport const B = ({ c }) => <div sx={s.palette(c())} />;`,
        'hoist-site.tsx',
      );
      expect(code).toMatch(
        /export function A\(\{ c \}\) \{ let __plumeria__\$\$a0;\n {2}return <div className="xokp0532" style=\{\(__plumeria__\$\$a0 = c\(\), /,
      );
      expect(code).toMatch(
        /export const B = \(\{ c \}\) => \{ let __plumeria__\$\$a0; return <div className="xokp0532" style=\{\(__plumeria__\$\$a0 = c\(\), [^\n]*\)\} \/>; \};/,
      );
    });

    const compileComponent = async (body: string) => {
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ stat: { color: 'red' }, scale: (n) => ({ scale: n }), w: (n) => ({ width: n * 2 }) });
function App(mark) { ${body} }`,
        'evaluation-order.tsx',
      );
      const js = transformSync(code, {
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', tsx: true },
          transform: { react: { runtime: 'classic' } },
        },
      }).code;
      return new Function('React', js + '\nreturn App;')({
        createElement: (tag: unknown) => tag,
      });
    };

    it('reads the component tag before its style arguments', async () => {
      const app = await compileComponent(`
        let Tag = 'before';
        function changeTag() { Tag = 'after'; return 2; }
        return <Tag sx={s.scale(changeTag())} />;
      `);
      expect(app()).toBe('before');
    });

    it('computes a variable from its argument before a later condition', async () => {
      const app = await compileComponent(`
        const n = { valueOf() { mark('valueOf'); return 1; } };
        return <div sx={[s.w(n), mark('condition') && s.stat]} />;
      `);
      const mark = jest.fn();
      app(mark);
      expect(mark.mock.calls).toEqual([['valueOf'], ['condition']]);
    });

    it('computes a variable from its argument before the next argument', async () => {
      const app = await compileComponent(`
        const n = { valueOf() { mark('valueOf'); return 1; } };
        return <div sx={[s.w(n), s.scale(mark('argument'))]} />;
      `);
      const mark = jest.fn();
      app(mark);
      expect(mark.mock.calls).toEqual([['valueOf'], ['argument']]);
    });

    it.each([
      [
        `sx={[s.w(n), mark('condition') && s.stat]} id={mark('id')} style={mark('style')}`,
        ['valueOf', 'condition', 'id', 'style'],
      ],
      [
        `style={mark('style')} id={mark('id')} sx={[s.w(n), mark('condition') && s.stat]}`,
        ['style', 'id', 'valueOf', 'condition'],
      ],
      [
        `className={mark('class')} {...mark('spread')} sx={[s.w(n), mark('condition') && s.stat]} title={mark('title')} style={mark('style')}`,
        ['class', 'spread', 'valueOf', 'condition', 'title', 'style'],
      ],
      [
        `sx={[s.w(n), mark('condition') && s.stat]} title={<b k={mark('element')} />} className={mark('class')}`,
        ['valueOf', 'condition', 'element', 'class'],
      ],
    ])(
      'evaluates each attribute where it is written: %s',
      async (attributes, order) => {
        const app = await compileComponent(`
        const n = { valueOf() { mark('valueOf'); return 1; } };
        return <div ${attributes} />;
      `);
        const mark = jest.fn((name: string) =>
          name === 'spread' ? {} : name === 'style' ? { top: 1 } : name,
        );
        app(mark);
        expect(mark.mock.calls.map(([name]) => name)).toEqual(order);
      },
    );

    it.each([
      [
        'a default parameter',
        `function P(x = <div sx={[mark('condition') && s.stat, s.w(n)]} />) { return x; }
        return P();`,
      ],
      [
        'a class field',
        `class C { x = <div sx={[mark('condition') && s.stat, s.w(n)]} />; }
        return new C().x;`,
      ],
      [
        'a shared condition in a default parameter',
        `function P(x = <div sx={[mark('condition') && s.w(n), s.stat]} />) { return x; }
        return P();`,
      ],
    ])('reads %s once in order without a wrapper', async (_, body) => {
      const source = `
        const n = { valueOf() { mark('valueOf'); return 1; } };
        ${body}
      `;
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ stat: { color: 'red' }, w: (n) => ({ width: n * 2 }) });
function App(mark) { ${source} }`,
        'helper-site.tsx',
      );
      expect(code).not.toMatch(/\(\([\w, [\]]*\) => /);
      const app = await compileComponent(source);
      const mark = jest.fn(() => true);
      app(mark);
      expect(mark.mock.calls).toEqual([['condition'], ['valueOf']]);
    });

    it('declares the module temporaries outside an arrow that ends the file', async () => {
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ stat: { color: 'red' }, w: (n) => ({ width: n }) });
const on = true, n = 1;
export const el = <div sx={[on && s.stat, s.w(n)]} />;
export const B = (p) => <div sx={[p.on && s.stat, s.w(p.n)]} />`,
        'eof-arrow.tsx',
      );
      const js = transformSync(code, {
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', tsx: true },
          transform: { react: { runtime: 'classic' } },
        },
        module: { type: 'commonjs' },
      }).code;
      const exports: Record<string, unknown> = {};
      new Function('React', 'exports', 'require', js)(
        { createElement: (_: unknown, props: unknown) => props },
        exports,
        () => ({}),
      );
      type Props = { className: string; style: Record<string, unknown> };
      const el = exports.el as Props;
      const b = (exports.B as (p: object) => Props)({ on: false, n: 2 });
      expect(el.className.split(' ')).toHaveLength(2);
      expect(Object.values(el.style)).toEqual(['1px']);
      expect(b.className.split(' ')).toHaveLength(1);
      expect(Object.values(b.style)).toEqual(['2px']);
    });

    const execute = async (source: string, name: string) => {
      const { code } = await run(source, name);
      const js = transformSync(code, {
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', tsx: true },
          transform: { react: { runtime: 'classic' } },
        },
        module: { type: 'commonjs' },
      }).code;
      const exports: Record<string, (...args: never[]) => unknown> = {};
      new Function('React', 'exports', 'require', js)(
        { createElement: (_: unknown, props: unknown) => props },
        exports,
        () => ({}),
      );
      return exports;
    };

    it('applies the width unit directly to a stable parameter', async () => {
      const source = `import * as css from '@plumeria/core';
const s = css.create({ w: (n) => ({ width: n }) });
export const A = (n) => <div sx={s.w(n)} />;`;
      const name = 'inline-width-parameter.tsx';
      const { code } = await run(source, name);
      expect(code).not.toMatch(/__plumeria__\$\$a\d/);
      const { A } = (await execute(source, name)) as {
        A: (n: number | string) => { style: Record<string, unknown> };
      };
      expect(Object.values(A(12).style)).toEqual(['12px']);
      expect(Object.values(A('50%').style)).toEqual(['50%']);
    });

    const readmeStyles = `import * as css from '@plumeria/core';
const styles = css.create({
  text: { fontSize: 12, color: 'gray' },
  active: { color: 'navy' },
  scale: (value) => ({ scale: value }),
});`;

    it('inlines the initialized scale and the condition in the README example', async () => {
      const { code } = await run(
        readmeStyles +
          `
export default function App({ active }) {
  const scale = useScale();
  return <div sx={[styles.text, active && styles.active, styles.scale(scale)]} />;
}`,
        'readme-inline.tsx',
      );
      expect(code).not.toContain('__plumeria__$$');
      expect(code).toContain(
        'className={((active) ? "xhrr6ses xhxthtyw xvbwmxqp" : "xhrr6ses xhxthtyw xuifcaas")}',
      );
      expect(code).toMatch(/style=\{\{\s*"--xfuma1qq-value": scale\s*\}\}/);
    });

    it.each([
      [
        'beside',
        '[styles.text, active && styles.active, styles.scale(size * 2)]',
      ],
      ['guarding', '[styles.text, active && styles.scale(size * 2)]'],
    ])(
      'reads a stable condition %s a computed argument in place',
      async (_, sx) => {
        const source =
          readmeStyles +
          `
export function App({ active, size }) {
  return <div sx={${sx}} />;
}`;
        const { code } = await run(source, 'stable-condition.tsx');
        const { App } = (await execute(source, 'stable-condition-run.tsx')) as {
          App: (props: { active: boolean; size: number }) => {
            className: string;
            style: unknown;
          };
        };
        expect(code).not.toMatch(/__plumeria__\$\$t\d/);
        const on = App({ active: true, size: 3 });
        const off = App({ active: false, size: 3 });
        expect(on.style).toEqual({ '--xfuma1qq-value': 6 });
        expect(off.className).not.toBe(on.className);
      },
    );

    it.each([
      'scale = 2',
      'scale++',
      '({ value: [scale] } = source)',
      'for (scale of values) {}',
      'for (scale in values) {}',
    ])(
      'isolates the parameter written by %s from a same-named parameter',
      async (write) => {
        const { code } = await run(
          readmeStyles +
            `
export const A = ({ scale }) => <div sx={styles.scale(scale)} />;
export function B({ scale }) {
  const change = () => { ${write}; };
  return <div sx={styles.scale(scale)} onClick={change} />;
}`,
          'parameter-writes.tsx',
        );
        expect(code).toContain('style={{ "--xfuma1qq-value": scale }}');
        expect(code).toMatch(/__plumeria__\$\$a\d+ = scale/);
      },
    );

    it.each(['var scale = 2;', 'function scale() {}'])(
      'keeps a temporary for a parameter redeclared by %s',
      async (redeclaration) => {
        const { code } = await run(
          readmeStyles +
            `
export function B({ scale }) {
  ${redeclaration}
  return <div sx={styles.scale(scale)} />;
}`,
          'parameter-redeclaration.tsx',
        );
        expect(code).toMatch(/__plumeria__\$\$a\d+ = scale/);
      },
    );

    it('keeps parameter temporaries in a file with direct eval', async () => {
      const { code } = await run(
        readmeStyles +
          `
export function A({ scale }) {
  const change = () => (eval)('scale = 2');
  return <div sx={styles.scale(scale)} onClick={change} />;
}`,
        'parameter-eval.tsx',
      );
      expect(code).toMatch(/__plumeria__\$\$a\d+ = scale/);
    });

    it('reads the condition before a dynamic argument reassigns it', async () => {
      const { App } = await execute(
        readmeStyles +
          `
export function App(active = true) {
  const change = () => { active = false; return 2; };
  return <div sx={[styles.text, active && styles.active, styles.scale(change())]} />;
}`,
        'readme-condition-order.tsx',
      );
      expect(App()).toMatchObject({
        className: 'xhrr6ses xhxthtyw xvbwmxqp',
        style: { '--xfuma1qq-value': 2 },
      });
    });

    it('reads the condition after a preceding dynamic argument reassigns it', async () => {
      const { App } = await execute(
        readmeStyles +
          `
export function App(active = true) {
  const change = () => { active = false; return 2; };
  return <div sx={[styles.text, styles.scale(change()), active && styles.active]} />;
}`,
        'argument-before-condition.tsx',
      );
      expect(App()).toMatchObject({
        className: 'xhrr6ses xhxthtyw xuifcaas',
        style: { '--xfuma1qq-value': 2 },
      });
    });

    it.each(['[on && s.red, s.w(n)]', '[s.w(n), on && s.red]'])(
      'reads an initialized module condition and writes width directly for %s',
      async (sx) => {
        const { code } = await run(
          `import * as css from '@plumeria/core';
const s = css.create({ red: { color: 'red' }, w: (n) => ({ width: n }) });
export const on = readFlag();
const n = readWidth();
export const view = <div sx={${sx}} />;`,
          'module-const-condition.tsx',
        );
        expect(code).toContain('className=');
        expect(code).toContain('style=');
        expect(code).not.toMatch(/__plumeria__\$\$[tv]\d/);
      },
    );

    it('preserves a module const TDZ read inside a hoisted function', async () => {
      await expect(
        execute(
          `import * as css from '@plumeria/core';
const s = css.create({ red: { color: 'red' }, blue: { color: 'blue' } });
render();
const on = true;
export function render() {
  return css.use(on && s.red, s.blue);
}`,
          'hoisted-module-const-tdz.tsx',
        ),
      ).rejects.toThrow(ReferenceError);
    });

    it('preserves a TDZ read when a later style overrides the conditional style', async () => {
      const { U } = await execute(
        `import * as css from '@plumeria/core';
const s = css.create({ red: { color: 'red' }, blue: { color: 'blue' } });
export function U(read) {
  const result = css.use((read && flag) && s.red, s.blue);
  let flag = true;
  return result;
}`,
        'use-tdz.tsx',
      );
      expect(() => U(true as never)).toThrow(ReferenceError);
      expect(typeof U(false as never)).toBe('string');
    });

    it('keeps a TDZ read that shadows an initialized parameter', async () => {
      const { U } = await execute(
        `import * as css from '@plumeria/core';
const s = css.create({ red: { color: 'red' }, blue: { color: 'blue' } });
export function U(flag) {
  {
    const value = css.use(flag && s.red, s.blue);
    let flag = true;
    return value;
  }
}`,
        'use-shadowed-parameter.tsx',
      );
      expect(() => U(true as never)).toThrow(ReferenceError);
    });

    it('skips a parameter read that a later style overrides', async () => {
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ red: { color: 'red' }, blue: { color: 'blue' } });
export const A = ({ a, b }) => <div sx={[a && s.red, b && s.blue]} />;`,
        'skip-parameter.tsx',
      );
      expect(code).toMatch(
        /className=\{\(\(b\) \? "\w+" : \(\(a\) \? "\w+" : ""\)\)\}/,
      );
      expect(code).not.toContain('__plumeria__$$a');
    });

    it('reads a condition that css.use folds away', async () => {
      const { U } = await execute(
        `import * as css from '@plumeria/core';
const s = css.create({ red: { color: 'red' }, blue: { color: 'blue' } });
export const U = (proxy) => css.use(('active' in proxy) && s.red, s.blue);`,
        'use-in.tsx',
      );
      const has = jest.fn(() => true);
      U(new Proxy({}, { has }) as never);
      expect(has).toHaveBeenCalledTimes(1);
    });

    it('evaluates folded css.use conditions in order without a helper', async () => {
      const source = `import * as css from '@plumeria/core';
const s = css.create({ red: { color: 'red' }, blue: { color: 'blue' } });
export const U = (mark) => css.use(mark(1) && s.red, mark(2) && s.red, s.blue);
export const blue = css.use(s.blue);`;
      const name = 'use-folded-conditions.tsx';
      const { code } = await run(source, name);
      expect(code).not.toMatch(/__plumeria__\$\$f\d+/);
      const { U, blue } = await execute(source, name);
      const mark = jest.fn(() => false);
      expect(U(mark as never)).toBe(blue);
      expect(mark.mock.calls).toEqual([[1], [2]]);
    });

    const branches = async (sx: string, name: string) => {
      const source = `import * as css from '@plumeria/core';
const s = css.create({ w: (n) => ({ width: n }) });
export const A = ({ on, next, a, b }) => <div sx={${sx}} />;`;
      const { code } = await run(source, name);
      const { A } = await execute(source, name);
      const render = (flag: boolean) => {
        const calls = {
          next: jest.fn(() => flag),
          a: jest.fn(() => 1),
          b: jest.fn(() => 2),
        };
        const props = A({ on: flag, ...calls } as never) as {
          className: string;
          style: Record<string, unknown>;
        };
        return { calls, props };
      };
      return { code, render };
    };

    it('writes one class for a condition whose branches share it', async () => {
      const { code, render } = await branches(
        'next() ? s.w(a()) : s.w(b())',
        'shared-branch.tsx',
      );
      expect(code).toMatch(/className="\w+"/);
      const on = render(true);
      const off = render(false);
      expect(on.props.className).toBe(off.props.className);
      expect(on.calls.next).toHaveBeenCalledTimes(1);
      expect(on.calls.a).toHaveBeenCalledTimes(1);
      expect(on.calls.b).not.toHaveBeenCalled();
      expect(Object.values(on.props.style)).toEqual(['1px']);
      expect(off.calls.next).toHaveBeenCalledTimes(1);
      expect(off.calls.a).not.toHaveBeenCalled();
      expect(off.calls.b).toHaveBeenCalledTimes(1);
      expect(Object.values(off.props.style)).toEqual(['2px']);
    });

    it('emits a fixed class when both branches of a stable condition use the same key', async () => {
      const { code } = await run(
        header +
          `export const A = ({ on, a, b }) => <div sx={on ? s.palette(a) : s.palette(b)} />;`,
        'stable-shared-branch.tsx',
      );
      expect(classOf(code)).toBe('xokp0532');
    });

    it('writes the selected style directly for a stable condition', async () => {
      const { code, render } = await branches(
        'on ? s.w(a()) : s.w(b())',
        'direct-branch-style.tsx',
      );
      expect(code).not.toMatch(/__plumeria__\$\$v\d+/);
      for (const flag of [true, false]) {
        const { calls, props } = render(flag);
        expect(calls.a).toHaveBeenCalledTimes(flag ? 1 : 0);
        expect(calls.b).toHaveBeenCalledTimes(flag ? 0 : 1);
        expect(Object.values(props.style)).toEqual([flag ? '1px' : '2px']);
      }
    });

    it('preserves a shared inner guard on opposite outer branches', async () => {
      const { A } = (await execute(
        header +
          `export const A = ({ x, on, color }) => <div sx={x
            ? (on ? null : s.palette(color))
            : (on ? null : s.palette(color))} />;`,
        'nested-shared-branch.tsx',
      )) as {
        A: (props: { x: boolean; on: boolean; color: string }) => {
          className: string;
        };
      };
      for (const x of [true, false]) {
        expect(A({ x, on: true, color: 'red' }).className).toBe('');
        expect(A({ x, on: false, color: 'red' }).className).toBe('xokp0532');
      }
    });

    it('keeps two separately written conditions apart', async () => {
      const { render } = await branches(
        '[next() && s.w(a()), !next() && s.w(b())]',
        'separate-branch.tsx',
      );
      expect(render(true).calls.next).toHaveBeenCalledTimes(2);
    });

    it.each([`className="base"`, `className={"base"}`])(
      'lets %s after a spread win over it',
      async (attribute) => {
        const { A } = await execute(
          `import * as css from '@plumeria/core';
const s = css.create({ w: (n) => ({ width: n }) });
export const A = ({ n, props }) => <div sx={s.w(n)} {...props} ${attribute} />;`,
          'spread-order.tsx',
        );
        const props = A({ n: 1, props: { className: 'spread' } } as never) as {
          className: string;
        };
        expect(props.className.split(' ')[0]).toBe('base');
      },
    );

    it('moves a static style past a spread without declaring anything', async () => {
      const source = `import * as css from '@plumeria/core';
const s = css.create({ red: { color: 'red' } });
export const A = (props) => <div sx={s.red} {...props} className="base" />;`;
      const { code } = await run(source, 'static-spread.tsx');
      expect(code).not.toContain('let');
      const { A } = await execute(source, 'static-spread.tsx');
      const props = A({ className: 'spread' } as never) as {
        className: string;
      };
      expect(props.className.split(' ')[0]).toBe('base');
    });

    it('keeps a style key that looks like a generated name', async () => {
      const { code } = await run(
        `import * as css from '@plumeria/core';
const t = css.create({ __plumeria__$$0: { color: 'red' }, b: { color: 'blue' }, c: { padding: 1 } });
export const A = ({ getKey }) => <div sx={[t[getKey()], t[getKey()]]} />;`,
        'generated-key.tsx',
      );
      expect(code).toContain('"__plumeria__$$0":"xq96bg3w"');
      expect(code).not.toContain('"__plumeria__$$a0":');
    });

    it('leaves an attribute that reads between sx and style in place', async () => {
      const { code } = await run(
        header +
          `export function A({ c, f, g }) {\n  return <div sx={[s.palette(c), f() && s.stat]} id={g()} style={f()} />;\n}`,
        'hoist-between.tsx',
      );
      expect(code).not.toMatch(/=> \(\{/);
      expect(code).toContain(
        `{...{ "style": { "--x80848wl-color": (typeof (c) === 'number' ? (c) + 'px' : (c)) } }} id={g()} style={f()} />`,
      );
    });

    const element = '<div sx={[s.scale(n), mark() && s.stat]} />';
    it.each([
      ['local', `const el = ${element}; const n = 1; return el;`],
      [
        'switch case',
        `switch (1) {
        case 0: const n = 1;
        case 1: return ${element};
      }`,
      ],
      [
        'outer',
        `const el = render(); const n = 1; function render() { return ${element}; } return el;`,
      ],
      ['for...of', `for (const n of [${element}]) {}`],
      ['for...in', `for (const n in { k: ${element} }) {}`],
    ])(
      'reads the uninitialized %s binding before the condition',
      async (_, body) => {
        const app = await compileComponent(body);
        const mark = jest.fn();
        expect(() => app(mark)).toThrow(ReferenceError);
        expect(mark).not.toHaveBeenCalled();
      },
    );

    it('applies a parameter default without an inline style', async () => {
      const { code } = await run(
        defaults + 'export const A = () => <div sx={d.tinted()} />;',
        'default-omitted.tsx',
      );
      expect(code).toMatch(/className="[a-z0-9]+"/);
      expect(code).not.toContain('style={{');
    });

    // The default lives in the sheet, so overriding it must reuse the class and
    // only add the variable.
    it('keeps the same class when a defaulted parameter is given a value', async () => {
      const omitted = await run(
        defaults + 'export const A = () => <div sx={d.tinted()} />;',
        'default-a.tsx',
      );
      const given = await run(
        defaults + "export const A = () => <div sx={d.tinted('blue')} />;",
        'default-b.tsx',
      );
      expect(classOf(given.code)).toBe(classOf(omitted.code));
      expect(given.code).toContain('style={{');
      expect(given.code).toContain('"blue"');
    });

    it('applies a destructured default when the key is omitted', async () => {
      const { code } = await run(
        defaults + 'export const A = () => <div sx={d.toned({})} />;',
        'default-named.tsx',
      );
      expect(code).toMatch(/className="[a-z0-9]+"/);
      expect(code).not.toContain('style={{');
    });

    it('applies a destructured default when the call takes no argument', async () => {
      const omitted = await run(
        defaults + 'export const A = () => <div sx={d.toned()} />;',
        'default-named-omitted.tsx',
      );
      const empty = await run(
        defaults + 'export const A = () => <div sx={d.toned({})} />;',
        'default-named-empty.tsx',
      );
      expect(classOf(omitted.code)).toBe(classOf(empty.code));
      expect(omitted.code).not.toContain('style={{');
    });

    it('rejects a call with no argument when a destructured parameter has no default', async () => {
      await expect(
        run(
          `import * as css from '@plumeria/core';
const s = css.create({ bare: ({ tone }: { tone: string }) => ({ backgroundColor: tone }) });
export const B = () => <div sx={s.bare()} />;`,
          'named-omitted-unset.tsx',
        ),
      ).rejects.toThrow('leaves "tone" unset');
    });

    it('resolves a call on a style function that takes no parameter', async () => {
      const { code } = await run(
        defaults + 'export const A = () => <div sx={d.plain()} />;',
        'default-none.tsx',
      );
      expect(code).toMatch(/className="[a-z0-9]+"/);
      expect(code).not.toContain('style={{');
    });

    it('resolves an imported function key', async () => {
      const file = path.join(DIR, 'imported-consumer.tsx');
      const source = `import '@plumeria/core';
import { importedStyles } from './imported.styles';
export const Imported = (p: any) => <p sx={importedStyles.tone(p.color)} />;`;
      fs.writeFileSync(file, source);

      const { code } = await transformSource(env(source, file));

      expect(code).toContain('className="');
      expect(code).toContain('p.color');
      expect(code).toMatch(/"--[^"}]+-color"/);
    });

    describe('a function key resolves its names where it was written', () => {
      // An imported call has to land on the same classes the identical
      // declaration produces inline, or the scope the body reads is the
      // consumer's rather than the one it was written in.
      const classesOf = (code: string) =>
        code.match(/className="([^"]*)"/)?.[1];

      const compare = async (declaration: string, leadIn = '') => {
        const stylesFile = path.join(DIR, 'scoped.styles.ts');
        fs.writeFileSync(
          stylesFile,
          `import * as css from '@plumeria/core';
${leadIn}export const scoped = css.create(${declaration});
`,
        );
        const consumerFile = path.join(DIR, 'scoped-consumer.tsx');
        const consumer = `import '@plumeria/core';
import { scoped } from './scoped.styles';
export const A = (p: any) => <div sx={scoped.tone(p.c)} />;`;
        fs.writeFileSync(consumerFile, consumer);
        const imported = await transformSource(env(consumer, consumerFile));

        const inline = await run(
          `import * as css from '@plumeria/core';
${leadIn}const scoped = css.create(${declaration});
export const A = (p: any) => <div sx={scoped.tone(p.c)} />;`,
          'scoped-inline.tsx',
        );

        return [classesOf(imported.code), classesOf(inline.code)];
      };

      it('resolves a const declared in the defining file', async () => {
        const [imported, inline] = await compare(
          `{ tone: (color: string) => ({ color, fontWeight: weight }) }`,
          'const weight = 700;\n',
        );
        expect(imported).toBe(inline);
      });

      it('resolves a spread of a const declared in the defining file', async () => {
        const [imported, inline] = await compare(
          `{ tone: (color: string) => ({ color, ...base }) }`,
          'const base = { fontWeight: 700 };\n',
        );
        expect(imported).toBe(inline);
      });

      it('resolves a const the parameter shares an expression with', async () => {
        const [imported, inline] = await compare(
          '{ tone: (value: string) => ({ padding: `${value} ${gap}` }) }',
          "const gap = '4px';\n",
        );
        expect(imported).toBe(inline);
      });

      it('resolves a defining-file const behind a named parameter', async () => {
        const stylesFile = path.join(DIR, 'named.styles.ts');
        fs.writeFileSync(
          stylesFile,
          `import * as css from '@plumeria/core';
const weight = 700;
export const named = css.create({
  tone: ({ color }: { color: string }) => ({ color, fontWeight: weight }),
});
`,
        );
        const consumerFile = path.join(DIR, 'named-consumer.tsx');
        const consumer = `import '@plumeria/core';
import { named } from './named.styles';
export const A = (p: any) => <div sx={named.tone({ color: p.c })} />;`;
        fs.writeFileSync(consumerFile, consumer);
        const { code } = await transformSource(env(consumer, consumerFile));

        const inline = await run(
          `import * as css from '@plumeria/core';
const weight = 700;
const named = css.create({
  tone: ({ color }: { color: string }) => ({ color, fontWeight: weight }),
});
export const A = (p: any) => <div sx={named.tone({ color: p.c })} />;`,
          'named-inline.tsx',
        );

        expect(classesOf(code)).toBe(classesOf(inline.code));
      });
    });

    it('resolves a prop argument into a class name and a CSS variable', async () => {
      const { code } = await run(
        header + `export const A = (p: any) => <div sx={s.palette(p.c)} />;`,
        'a.tsx',
      );
      expect(code).toContain('className="xokp0532"');
      expect(code).toContain(
        `style={(__plumeria__$$a0 = p.c, { "--x80848wl-color": (typeof (__plumeria__$$a0) === 'number' ? (__plumeria__$$a0) + 'px' : (__plumeria__$$a0)) })}`,
      );
    });

    it('names the variable after the declaration it lands in', async () => {
      // Two creates may share a key name and a parameter name. The variable
      // names must still differ, or the later entry in the inline style object
      // silently overwrites the earlier one.
      const { code } = await run(
        `import * as css from '@plumeria/core';
const a = css.create({ palette: (color: string) => ({ backgroundColor: color }) });
const b = css.create({ palette: (color: string) => ({ borderColor: color }) });
export const B = (p: any) => <div sx={[a.palette(p.x), b.palette(p.y)]} />;`,
        'b.tsx',
      );
      expect(code).toContain('"--xav007xm-color"');
      expect(code).toContain('"--xcf1maiq-color"');
    });

    it('keeps two files apart when both name the create the same', async () => {
      // The name is derived from the resolved body, so it does not depend on the
      // local identifier and cannot be shared by unrelated declarations.
      const one = await run(
        `import * as css from '@plumeria/core';
const styles = css.create({ box: (w: number) => ({ width: w }) });
export const C = (p: any) => <div sx={styles.box(p.w)} />;`,
        'c.tsx',
      );
      const two = await run(
        `import * as css from '@plumeria/core';
const styles = css.create({ box: (w: number) => ({ height: w }) });
export const D = (p: any) => <div sx={styles.box(p.w)} />;`,
        'd.tsx',
      );
      const nameOf = (code: string) => code.match(/"(--[^"]+-w)"/)?.[1];
      expect(nameOf(one.code)).toBeDefined();
      expect(nameOf(one.code)).not.toBe(nameOf(two.code));
    });

    it('sets the variable for a parameter that only appears under nesting', async () => {
      // The rule is emitted whatever the nesting is, so an inline variable that
      // only covers top-level declarations leaves the rule reading nothing.
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({
  link: (base: string, hovered: string) => ({ color: base, ':hover': { color: hovered } }),
  deep: (size: number) => ({ '@media (min-width: 600px)': { ':hover': { fontSize: size } } }),
});
export const E = (p: any) => (<div><a sx={s.link(p.b, p.h)} /><i sx={s.deep(p.s)} /></div>);`,
        'nested.tsx',
      );
      const vars = code.match(/"--[^"]+"/g) ?? [];
      expect(vars).toHaveLength(3);
      expect(code).toContain(
        `(__plumeria__$$a0 = p.b, __plumeria__$$a1 = p.h, {`,
      );
      expect(code).toContain(
        `(__plumeria__$$a1) + 'px' : (__plumeria__$$a1)) })}`,
      );
      expect(code).toContain(`(__plumeria__$$a2 = p.s, {`);
      expect(code).toContain(
        `(__plumeria__$$a2) + 'px' : (__plumeria__$$a2)) })}`,
      );
    });

    it('keeps a unitless nested property free of the px fallback', async () => {
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ fade: (o: number) => ({ ':hover': { opacity: o } }) });
export const F = (p: any) => <div sx={s.fade(p.o)} />;`,
        'unitless.tsx',
      );
      expect(code).toMatch(
        /\(__plumeria__\$\$a0 = p\.o, \{ "--[^"]+": __plumeria__\$\$a0 \}\)\}/,
      );
    });

    it('keeps a multi-word unitless property free of the px fallback', async () => {
      // The unitless list is kebab-case at the source, so a property that reads
      // the same either way (opacity) hides the ones that do not.
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ grow: (n: number) => ({ flexGrow: n }), weight: (n: number) => ({ fontWeight: n }) });
export const F2 = (p: any) => (<div><i sx={s.grow(1)} /><b sx={s.weight(p.w)} /></div>);`,
        'unitless-multiword.tsx',
      );
      expect(code).toMatch(/"--[^"]+-n": "1"/);
      expect(code).toMatch(
        /\(__plumeria__\$\$a0 = p\.w, \{ "--[^"]+-n": __plumeria__\$\$a0 \}\)/,
      );
    });

    it('leaves a custom property number alone whichever way it is written', async () => {
      // A custom property carries no unit rule, and the literal and the runtime
      // argument have to agree on that.
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ gap: (n: number) => ({ '--gap': n, gap: 'var(--gap)' }) });
export const F3 = (p: any) => (<div><i sx={s.gap(4)} /><b sx={s.gap(p.n)} /></div>);`,
        'custom-prop.tsx',
      );
      expect(code).toMatch(/"--[^"]+-n": "4"/);
      expect(code).toMatch(
        /\(__plumeria__\$\$a0 = p\.n, \{ "--[^"]+-n": __plumeria__\$\$a0 \}\)/,
      );
    });

    it('splits the variable when the parameter lands in both unit rules', async () => {
      // The element sets the variable once, so padding and z-index cannot read
      // the same one: 4px and 4 are both needed.
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ units: (n: number) => ({ padding: n, zIndex: n }) });
export const U = (p: any) => <div sx={s.units(p.n)} />;`,
        'unit-split.tsx',
      );
      expect(code).toMatch(
        /\(__plumeria__\$\$a0 = p\.n, \{ "--([a-z0-9]+)-n": \(typeof \(__plumeria__\$\$a0\) === 'number' \? \(__plumeria__\$\$a0\) \+ 'px' : \(__plumeria__\$\$a0\)\), "--\1-n-z-index": __plumeria__\$\$a0 \}\)\}/,
      );
    });

    it('keeps one variable when the declarations share a unit rule', async () => {
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ same: (c: string) => ({ color: c, borderColor: c }) });
export const S = (p: any) => <div sx={s.same(p.c)} />;`,
        'unit-same.tsx',
      );
      expect(code.match(/"--[^"]+"/g)).toHaveLength(1);
    });

    it('gives the variable of a call under a condition the same reach as its class', async () => {
      // lookup.test.ts pins the class list; what it cannot see is the value, and
      // one variable name serves every branch that shares the declaration.
      const { code } = await run(
        header +
          `export const G = (p: any) => (<div><i sx={p.on && s.palette(p.c)} /><b sx={p.on ? s.palette(p.a) : s.palette(p.b)} /></div>);`,
        'conditional.tsx',
      );
      const declared = code.match(/=> \{ (let [^;]+;)/)?.[1] ?? '';
      const [i, b] = [
        ...code.matchAll(
          /<[ib] className=(?:\{([\s\S]*?)\}|("[^"]*")) style=\{([\s\S]*?)\} \/>/g,
        ),
      ].map(
        ([, dynamic, fixed, style]) =>
          (p: object): { className: string; style?: Record<string, unknown> } =>
            new Function(
              'p',
              `${declared} const className = (${dynamic ?? fixed}); return { className, style: (${style}) };`,
            )(p),
      );
      const on = { on: true, c: 'red', a: 'blue', b: 'green' };
      const off = { ...on, on: false };
      const lit = i(on);
      const [name] = Object.keys(lit.style!);

      expect(lit.className).not.toBe('');
      expect(lit.style).toEqual({ [name]: 'red' });
      expect(i(off).className).toBe('');
      expect(i(off).style).toBeUndefined();
      expect(b(on)).toEqual({
        className: lit.className,
        style: { [name]: 'blue' },
      });
      expect(b(off)).toEqual({
        className: lit.className,
        style: { [name]: 'green' },
      });
    });

    it('takes named parameters from a destructured signature', async () => {
      // The call names the parameters, and a renamed binding is read under the
      // name the body uses, not the one the caller wrote.
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({
  named: ({ color, size }: { color: string; size: number }) => ({ color, fontSize: size }),
  renamed: ({ tone: t }: { tone: string }) => ({ backgroundColor: t }),
});
export const H = (p: any) => (<div>
  <i sx={s.named({ color: p.c, size: 12 })} />
  <b sx={s.renamed({ tone: p.t })} />
</div>);`,
        'named.tsx',
      );
      expect(code).toContain(
        `(__plumeria__$$a0 = p.c, { "--x4fa0uiv-color": (typeof (__plumeria__$$a0) === 'number' ? (__plumeria__$$a0) + 'px' : (__plumeria__$$a0)) })`,
      );
      expect(code).toContain(
        `(__plumeria__$$a1 = p.t, { "--xs7d3nvt-t": (typeof (__plumeria__$$a1) === 'number' ? (__plumeria__$$a1) + 'px' : (__plumeria__$$a1)) })`,
      );
    });

    it('folds a named value only when it is written out in full', async () => {
      // A template literal reads only in part, so baking it into the rule would
      // drop the interpolation.
      const { code } = await run(
        `import * as css from '@plumeria/core';
const GAP = 'blue';
const s = css.create({ tint: ({ color }: { color: string }) => ({ backgroundColor: color }) });
export const K = (p: any) => (<div>
  <i sx={s.tint({ color: "red" })} />
  <b sx={s.tint({ color: GAP })} />
  <u sx={s.tint({ color: \`rgb(\${p.r} 0 0)\` })} />
</div>);`,
        'folding.tsx',
      );
      expect(code).toContain('<i className="xymr32dw" />');
      expect(code).toContain('<b className="x2x7bpc1" />');
      expect(code).toContain(
        "(__plumeria__$$a0 = `rgb(${p.r} 0 0)`, { \"--xav007xm-color\": (typeof (__plumeria__$$a0) === 'number' ? (__plumeria__$$a0) + 'px' : (__plumeria__$$a0)) })",
      );
    });

    it('rejects a named call that leaves a parameter unset', async () => {
      await expect(
        run(
          `import * as css from '@plumeria/core';
const s = css.create({ named: ({ color, size }: { color: string; size: number }) => ({ color, fontSize: size }) });
export const I = (p: any) => <div sx={s.named({ color: p.c })} />;`,
          'unset.tsx',
        ),
      ).rejects.toThrow('leaves "size" unset');
    });

    it('rejects a positional call to a named signature', async () => {
      await expect(
        run(
          `import * as css from '@plumeria/core';
const s = css.create({ named: ({ color }: { color: string }) => ({ color }) });
export const J = (p: any) => <div sx={s.named(p.c)} />;`,
          'positional.tsx',
        ),
      ).rejects.toThrow('takes one object argument');
    });

    it('rejects a call handed to a component prop instead of emitting a broken lookup', async () => {
      // The create call becomes a plain object holding only the static keys, so
      // leaving the call in place would throw "palette is not a function".
      await expect(
        runUnscanned(
          header +
            `export const C = (p: any) => <Box styleArray={s.palette(p.c)} />;`,
          'c.tsx',
        ),
      ).rejects.toThrow(
        '[plumeria] s.palette(p.c) is only supported in the sx prop.',
      );
    });

    it('rejects a call whose result is never handed to the style prop', async () => {
      await expect(
        run(
          header +
            `export const D = (p: any) => { s.palette(p.c); return <div sx={s.stat} />; };`,
          'd.tsx',
        ),
      ).rejects.toThrow('is only supported in the sx prop.');
    });

    it('keeps static keys usable through component props', async () => {
      const { code } = await runUnscanned(
        header + `export const E = () => <Box styleArray={s.stat} />;`,
        'e.tsx',
      );
      expect(code).toContain('styleArray={({"color":"xq96bg3w"})}');
    });
  });

  describe('a unit the declaration already spells out', () => {
    const styleOf = (code: string) => code.match(/style=\{[^\n]*?\} \/>/)?.[0];

    it('moves the unit into the value the element sets', async () => {
      const { code, sheets } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ fill: (pct: number) => ({ width: \`\${pct}%\` }) });
export const A = ({ r }: { r: number }) => <div sx={s.fill(r)} />;`,
        'unit-percent.tsx',
      );
      expect(sheets.join('')).toMatch(/width: var\(--[a-z0-9-]+\);/);
      expect(styleOf(code)).toMatch(/"--[a-z0-9-]+": \(\(r\) \+ '%'\)/);
    });

    it('moves a unit written as px the same way', async () => {
      const { code, sheets } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ box: (w: number) => ({ width: \`\${w}px\` }) });
export const A = ({ r }: { r: number }) => <div sx={s.box(r)} />;`,
        'unit-px.tsx',
      );
      expect(sheets.join('')).toMatch(/width: var\(--[a-z0-9-]+\);/);
      expect(styleOf(code)).toMatch(/"--[a-z0-9-]+": \(\(r\) \+ 'px'\)/);
    });

    it('moves a unit written inside calc', async () => {
      const { code, sheets } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ box: (w: number) => ({ width: \`calc(100% - \${w}px)\` }) });
export const A = ({ r }: { r: number }) => <div sx={s.box(r)} />;`,
        'unit-calc-suffix.tsx',
      );
      expect(sheets.join('')).toMatch(
        /width: calc\(100% - var\(--[a-z0-9-]+\)\);/,
      );
      expect(styleOf(code)).toMatch(/"--[a-z0-9-]+": \(\(r\) \+ 'px'\)/);
    });

    it('still carries the unit when the declaration writes none', async () => {
      const bare = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ box: (w: number) => ({ width: w }) });
export const A = ({ r }: { r: number }) => <div sx={s.box(r)} />;`,
        'unit-bare.tsx',
      );
      const inCalc = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ box: (w: number) => ({ width: \`calc(\${w} * 2)\` }) });
export const A = ({ r }: { r: number }) => <div sx={s.box(r)} />;`,
        'unit-calc-factor.tsx',
      );
      expect(bare.sheets.join('')).toMatch(/width: var\(--[a-z0-9-]+\);/);
      expect(bare.code).toContain("+ 'px'");
      expect(inCalc.sheets.join('')).toMatch(
        /width: calc\(var\(--[a-z0-9-]+\) \* 2\);/,
      );
      expect(inCalc.code).toContain("+ 'px'");
    });

    it('writes the default into the sheet with the unit', async () => {
      const { sheets } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ fill: (pct: number = 0) => ({ width: \`\${pct}%\` }) });
export const A = ({ r }: { r: number }) => <div sx={s.fill(r)} />;`,
        'unit-default.tsx',
      );
      expect(sheets.join('')).toMatch(/width: var\(--[a-z0-9-]+, 0%\);/);
    });

    it('resolves the rating bar a benchmark lane reported as full width', async () => {
      const { code, sheets } = await run(
        `import * as css from '@plumeria/core';
const styles = css.create({
  ratingFill: { height: '100%', backgroundColor: '#fbbf24' },
  fillW: (pct: number = 0) => ({ width: \`\${pct}%\` }),
});
export const Bar = ({ p }: { p: { rating: number } }) => (
  <div sx={[styles.ratingFill, styles.fillW((p.rating / 5) * 100)]} />
);`,
        'unit-rating-bar.tsx',
      );
      expect(sheets.join('')).toMatch(/width: var\(--[a-z0-9-]+, 0%\);/);
      expect(styleOf(code)).toMatch(
        /\(__plumeria__\$\$a0 = \(p\.rating \/ 5\) \* 100, \{ "--[a-z0-9-]+": \(\(__plumeria__\$\$a0\) \+ '%'\) \}\)/,
      );
    });

    it('writes a literal argument with the unit', async () => {
      const { code } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ fill: (pct: number) => ({ width: \`\${pct}%\` }) });
export const A = () => <div sx={s.fill(40)} />;`,
        'unit-literal.tsx',
      );
      expect(styleOf(code)).toMatch(/"--[a-z0-9-]+": "40%"/);
    });

    it('gives a parameter used in three units three variables', async () => {
      const { code, sheets } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({
  k: (n: number) => ({ width: \`\${n}px\`, margin: \`\${n}rem\`, translate: \`\${n}%\` }),
});
export const A = ({ r }: { r: number }) => <div sx={s.k(r)} />;`,
        'unit-three.tsx',
      );
      const css = sheets.join('');
      expect(css).toMatch(/width: var\(--[a-z0-9-]+\);/);
      expect(css).toMatch(/margin: var\(--[a-z0-9-]+-margin\);/);
      expect(css).toMatch(/translate: var\(--[a-z0-9-]+-translate\);/);
      expect(styleOf(code)).toMatch(
        /"--[a-z0-9-]+-margin": \(\(r\) \+ 'rem'\)/,
      );
      expect(styleOf(code)).toMatch(
        /"--[a-z0-9-]+-translate": \(\(r\) \+ '%'\)/,
      );
    });

    it('gives two units in one declaration their own variables', async () => {
      const { code, sheets } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ k: (n: number) => ({ width: \`calc(\${n}px + \${n}%)\` }) });
export const A = ({ r }: { r: number }) => <div sx={s.k(r)} />;`,
        'unit-two-in-one.tsx',
      );
      expect(sheets.join('')).toMatch(
        /width: calc\(var\(--[a-z0-9-]+\) \+ var\(--[a-z0-9-]+-width\)\);/,
      );
      expect(styleOf(code)).toMatch(/"--[a-z0-9-]+-width": \(\(r\) \+ '%'\)/);
    });

    it('splits one parameter that lands in declarations with different units', async () => {
      const { code, sheets } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ box: (w: number) => ({ width: w, marginTop: \`\${w}%\` }) });
export const A = ({ r }: { r: number }) => <div sx={s.box(r)} />;`,
        'unit-split.tsx',
      );
      const css = sheets.join('');
      expect(css).toMatch(/width: var\(--[a-z0-9-]+\);/);
      expect(css).toMatch(/margin-top: var\(--[a-z0-9-]+-margin-top\);/);
      expect(styleOf(code)).toContain("+ 'px'");
      expect(styleOf(code)).toMatch(
        /"--[a-z0-9-]+-margin-top": \(\(r\) \+ '%'\)/,
      );
    });

    it('leaves a number inside a color or scale function without a unit', async () => {
      const { code, sheets } = await run(
        `import * as css from '@plumeria/core';
const s = css.create({ k: (h: number, d: number) => ({ color: \`hsl(\${h} 85% 72%)\`, transform: \`scaleX(\${d})\` }) });
export const A = ({ h, d }: { h: number; d: number }) => <div sx={s.k(h, d)} />;`,
        'unit-unitless-function.tsx',
      );
      const css = sheets.join('');
      expect(css).toMatch(/color: hsl\(var\(--[a-z0-9-]+\) 85% 72%\);/);
      expect(css).toMatch(/transform: scaleX\(var\(--[a-z0-9-]+\)\);/);
      expect(styleOf(code)).not.toContain("'px'");
    });
  });
});
