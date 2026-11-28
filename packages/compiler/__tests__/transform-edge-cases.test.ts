import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ transformSource, compileCSS }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-transform-edge-')),
  );
  let count = 0;

  const HEAD = `import * as css from '@plumeria/core';
const s = css.create({
  a: { color: 'red' },
  b: { padding: 4 },
  fn: (size: number) => ({ width: size }),
  named: ({ tone }: { tone: string }) => ({ color: tone }),
});
`;

  const transform = async (files: Record<string, string>) => {
    const cwd = path.join(DIR, String(count++));
    for (const [name, source] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
      fs.writeFileSync(path.join(cwd, name), source);
    }
    const filePath = path.join(cwd, 'app.tsx');
    const { code } = await transformSource({
      source: files['app.tsx'],
      moduleId: filePath,
      filePath,
      root: cwd,
      cwd,
      isDev: false,
    });
    return {
      code,
      css: compileCSS({ include: ['**/*.{ts,tsx}'], exclude: [], cwd }),
    };
  };

  const app = (body: string) => transform({ 'app.tsx': HEAD + body });

  const RED = 'xq96bg3w';
  const PADDING = 'x8ti24uy';

  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

  describe('transform: how the core package is imported', () => {
    it('leaves a type-only import in place', async () => {
      const { code, css } = await transform({
        'app.tsx': `import type { Style } from '@plumeria/core';
export const A = ({ x }: { x?: Style }) => <div sx={x} />;`,
      });
      expect(code).toContain(`import type { Style } from '@plumeria/core';`);
      expect(code).toContain(`<div className="" />`);
      expect(css).toBe('');
    });

    it('keeps only the types of an import that mixes them with values', async () => {
      const { code } = await transform({
        'app.tsx': `import { type Style, type CSSProperties as P, create as make } from '@plumeria/core';
const s = make({ a: { color: 'red' } });
export const A = ({ x }: { x?: Style; p?: P }) => <div sx={s.a} />;`,
      });
      expect(code).toContain(
        `import type { Style, CSSProperties as P } from '@plumeria/core'`,
      );
      expect(code).not.toContain('make');
      expect(code).toContain(`<div className="${RED}" />`);
    });

    it('reads a style object imported under another name', async () => {
      const { code, css } = await transform({
        'styles.ts': `import * as css from '@plumeria/core';
export const styles = css.create({ a: { color: 'teal' } });`,
        'app.tsx': `import '@plumeria/core';
import { styles as st, missing } from './styles';
export const A = () => <div sx={st.a} />;`,
      });
      expect(code).toMatch(/<div className="x[a-z0-9]+" \/>/);
      expect(css).toContain('color: teal');
    });

    it('leaves a create call on another object alone', async () => {
      const { code } = await app(
        `const other: any = { create: (x: any) => x };
const o = other.create({ a: { color: 'blue' } });
export const A = () => <div sx={s.a} />;`,
      );
      expect(code).toContain(`other.create({ a: { color: 'blue' } })`);
      expect(code).toContain(`<div className="${RED}" />`);
    });
  });

  describe('transform: a style that is not there', () => {
    it('reads undefined as no class', async () => {
      const { code } = await app(
        `export const A = () => <div sx={undefined} />;`,
      );
      expect(code).toContain(`<div className="" />`);
    });

    it('reads undefined in an array as no entry', async () => {
      const { code } = await app(
        `export const A = () => <div sx={[s.a, undefined]} />;`,
      );
      expect(code).toContain(`<div className="${RED}" />`);
    });

    it('skips a hole in an array under a condition', async () => {
      const { code } = await app(
        `export const A = ({ on }: any) => <div sx={[on && [s.a, , s.b]]} />;`,
      );
      expect(code).toContain(`className={(on ? "${RED} ${PADDING}" : "")}`);
    });

    it('leaves a keyframes call without an object alone', async () => {
      const { code, css } = await app(
        `const frames: any = {}; const k = css.keyframes(frames);`,
      );
      expect(code).toContain('const k = css.keyframes(frames);');
      expect(css).toBe('');
    });
  });

  describe('transform: what it rejects', () => {
    it.each([
      [
        'a destructured create call',
        `const { a } = css.create({ a: { color: 'blue' } });`,
        '[plumeria] css.create must be assigned to a named top-level variable.',
      ],
      [
        'a function key the style object does not hold',
        `export const A = () => <div sx={s.nope(1)} />;`,
        '[plumeria] Dynamic or unresolvable style object "s.nope(1)" is not supported.',
      ],
      [
        'a function key called with a spread',
        `export const A = ({ args }: any) => <div sx={s.fn(...args)} />;`,
        '[plumeria] Dynamic or unresolvable style object "s.fn(...args)" is not supported.',
      ],
      [
        'a spread in an array under a condition',
        `export const A = ({ on, list }: any) => <div sx={[on && [...list]]} />;`,
        '[plumeria] Spread elements in a style array are not supported: "...list".',
      ],
      [
        'a constant that names another constant',
        `const x = s.a; const y = x; export const A = () => <div sx={y} />;`,
        '[plumeria] Dynamic or unresolvable style object "y" is not supported.',
      ],
    ])('rejects %s', async (_name, body, message) => {
      await expect(app(body)).rejects.toThrow(message);
    });
  });

  describe('transform: the arguments of a function key', () => {
    it('ignores an argument past the last parameter', async () => {
      const { code } = await app(
        `export const A = ({ n }: any) => <div sx={s.fn(n, 2)} />;`,
      );
      expect(code).toMatch(
        /style=\{\(__plumeria__\$\$a0 = n, \{ "--[a-z0-9]+-size": \(typeof \(__plumeria__\$\$a0\) === 'number' \? \(__plumeria__\$\$a0\) \+ 'px' : \(__plumeria__\$\$a0\)\) \}\)\}/,
      );
    });

    it.each([`s.fn("3")`, `s.fn('3')`])(
      'passes the string literal of %s through as written',
      async (call) => {
        const { code } = await app(
          `export const A = () => <div sx={${call}} />;`,
        );
        expect(code).toMatch(/style=\{\{ "--[a-z0-9]+-size": "3" \}\}/);
      },
    );

    it('joins the unit a declaration writes onto each kind of argument', async () => {
      const { code } = await transform({
        'app.tsx': `import * as css from '@plumeria/core';
const s = css.create({ fn: (size: number) => ({ width: \`\${size}px\`, height: size }) });
export const A = ({ n }: any) => <><i sx={s.fn("3")} /><b sx={s.fn(n)} /><u sx={s.fn(4)} /></>;`,
      });
      expect(code).toMatch(/<i [^>]*"--[a-z0-9]+-size": "3px"/);
      expect(code).toMatch(
        /<b [^{]*\{\{ "--[a-z0-9]+-size": \(\(n\) \+ 'px'\)[^}]*\}\}/,
      );
    });

    it('emits no class for an object handed to a positional parameter at runtime', async () => {
      const { code } = await app(
        `export const A = ({ n }: any) => <div sx={s.fn({ size: n })} />;`,
      );
      expect(code).toContain(`<div className="" />`);
    });

    it('hands a function key to a component as a key and its variables', async () => {
      const { code } = await app(
        `const Card = ({ cardStyle }: { cardStyle?: css.Style }) => <div sx={cardStyle} />;
export const A = ({ n }: any) => <Card cardStyle={s.fn(n)} />;`,
      );
      expect(code).toContain('[((cardStyle && cardStyle.key) || cardStyle)]');
      expect(code).toContain('style={{ ...(cardStyle && cardStyle.vars) }}');
      expect(code).toMatch(/<Card cardStyle=\{\{ key: "x[a-z0-9]+", vars: \{/);
    });
  });

  describe('transform: conditions', () => {
    it('keys a conditional nested in another by its path', async () => {
      const { code } = await app(
        `export const A = ({ a, b }: any) => <div sx={a ? (b ? s.a : s.b) : s.b} />;`,
      );
      expect(code).toContain(
        `({"#0":"${RED}","#1":"${PADDING}","#2":"${PADDING}"}[((a) ? ((b) ? "#0" : "#1") : "#2")] || "")`,
      );
    });

    it('keeps the null prototype when a key comes from the caller', async () => {
      const { code } = await app(
        `const t = css.create({ x: { color: 'blue' } });\n` +
          `export const A = ({ a, k }: any) => <div sx={a ? t[k] : s.b} />;`,
      );
      expect(code).toContain('({__proto__:null,');
    });

    it('reads through parentheses', async () => {
      const { code } = await app(
        `export const A = ({ on }: any) => <div sx={[(on && s.a), (s.b)]} />;`,
      );
      expect(code).toContain(
        `className={(on ? "${PADDING} ${RED}" : "${PADDING}")}`,
      );
    });
  });

  describe('transform: names and components', () => {
    it('does not follow a constant into a scope that shadows its name', async () => {
      const { code } = await app(
        `const local = s.a;
export const A = ({ local }: any) => <div sx={local} />;
export const B = () => <div sx={local} />;`,
      );
      expect(code).toContain(
        `export const A = ({ local }: any) => <div className="" />;`,
      );
      expect(code).toContain(
        `export const B = () => <div className="${RED}" />;`,
      );
    });

    it('reads an anonymous default component that receives a style', async () => {
      const { code } = await app(
        `export default function ({ boxStyle }: { boxStyle?: css.Style }) { return <div sx={boxStyle} />; }`,
      );
      expect(code).toContain(`return <div className="" />;`);
    });

    it('reads a defaulted prop beside patterns it does not name', async () => {
      const { code } = await app(
        `const k = 'x';
const Card = ({ a: { b }, [k]: v, 'q': quoted, c: d = s.a }: any) => <div sx={d} />;
export const A = () => <Card c={s.b} />;`,
      );
      expect(code).toMatch(
        new RegExp(
          `\\(\\{__proto__:null,"x[a-z0-9]+":"${PADDING}","x[a-z0-9]+":"${RED}"\\}\\[d\\] \\|\\| ""\\)`,
        ),
      );
    });

    it('passes over a wrapper call that holds no component', async () => {
      const { code } = await app(
        `const Card = memo(config);
export const A = () => <div sx={s.a} />;`,
      );
      expect(code).toContain('const Card = memo(config);');
      expect(code).toContain(`<div className="${RED}" />`);
    });

    it('empties a style object exported through a specifier list', async () => {
      const { code } = await app(
        `const Card = ({ cardStyle }: { cardStyle?: css.Style }) => <div sx={cardStyle} />;
export { Card, s as styles };
export const A = () => <Card cardStyle={s.a} />;`,
      );
      expect(code).toContain('const s = "";');
      expect(code).toContain('export { Card, s as styles };');
    });
  });

  describe('transform: the attributes beside the style prop', () => {
    const FN = `const d = css.create({ fn: (size: number) => ({ width: size }) });\n`;
    const SIZE = `\\{ "--[a-z0-9]+-size": \\(typeof \\(n\\) === 'number' \\? \\(n\\) \\+ 'px' : \\(n\\)\\) \\}`;

    it.each([
      [
        'a namespaced attribute',
        `<svg xlink:href="x" sx={s.a} />`,
        `<svg xlink:href="x" className="${RED}" />`,
      ],
      [
        'a spread attribute',
        `<div {...p} sx={s.a} />`,
        `<div {...p} className="${RED}" />`,
      ],
      [
        'a className without a value',
        `<div className sx={s.a} />`,
        `<div className="${RED}" />`,
      ],
      [
        'a className string',
        `<div className="x" sx={s.a} />`,
        `<div className="${RED}" />`,
      ],
      [
        'a className expression',
        `<div className={p.c} sx={s.a} />`,
        `<div className={p.c} {...{ "className": "${RED}" }} />`,
      ],
      [
        'a className beside a style that is not there',
        `<div className="x" sx={undefined} />`,
        `<div className="" />`,
      ],
      [
        'dollar patterns in a className expression',
        `<div className={p.on ? "a$&b" : "c$'d"} sx={s.a} />`,
        `<div className={p.on ? "a$&b" : "c$'d"} {...{ "className": "${RED}" }} />`,
      ],
      [
        'dollar patterns in a style expression',
        `<div style={p.on ? { content: "$$" } : p.st} sx={s.a} />`,
        `<div style={p.on ? { content: "$$" } : p.st} className="${RED}" />`,
      ],
      [
        'a className immediately after a static style',
        `<div sx={s.a} className="base" />`,
        `<div className="base" />`,
      ],
      [
        'a className after a spread',
        `<div sx={s.a} {...p} className="x" />`,
        `<div {...{ "className": "${RED}" }} {...p} className="x" />`,
      ],
      [
        'two spaces inside a className value',
        `<div className="a  b" sx={s.a} />`,
        `<div className="${RED}" />`,
      ],
      [
        'attributes on their own lines',
        `<div\n      id="i"\n      className="x"\n      sx={s.a}\n    />`,
        `<div\n      id="i"\n      \n      className="${RED}"\n    />`,
      ],
    ])('transforms %s', async (_name, element, expected) => {
      const { code } = await app(`export const A = (p: any) => ${element};`);
      expect(code).toContain(expected);
    });

    it.each([
      ['a string', `sx="x"`],
      ['no value', `sx`],
    ])(
      'leaves a style prop written with %s alone',
      async (_name, attribute) => {
        const { code, css } = await app(
          `export const A = () => <div ${attribute} />;`,
        );
        expect(code).toContain(`<div ${attribute} />`);
        expect(css).toBe('');
      },
    );

    const after = (kept: string) =>
      `<div ${kept} className="x\\w+" \\{\\.\\.\\.\\{ "style": ${SIZE} \\}\\} />`;

    it.each([
      ['a string', `style="color:red"`, after('style="color:red"')],
      [
        'an object',
        `style={{ top: 1, ...rest }}`,
        after('style=\\{\\{ top: 1, \\.\\.\\.rest \\}\\}'),
      ],
      ['a name', `style={st}`, after('style=\\{st\\}')],
    ])(
      'writes the variables of a function key after a style attribute written as %s',
      async (_name, attribute, expected) => {
        const { code } = await app(
          FN +
            `export const A = ({ n, rest, st }: any) => <div ${attribute} sx={d.fn(n)} />;`,
        );
        expect(code).toMatch(new RegExp(expected));
      },
    );
  });

  describe('transform: a definition read as a value', () => {
    const DEFINITIONS = `const statics = css.createStatic({ gap: 4 });
const theme = css.createTheme('.dark', { color: { default: 'black', theme: 'white' } });
const k = css.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const vt = css.viewTransitionClass({ old: { opacity: 0 } });
`;

    it.each([
      ['a createStatic object', 'statics', '({"gap":4})'],
      ['a createStatic key', 'statics.gap', '(4)'],
      ['a createStatic key it does not hold', 'statics.zzz', '({"gap":4}).zzz'],
      ['a createTheme object', 'theme', '({"color":"var(--x2etbn17-color)"})'],
      ['a createTheme key', 'theme.color', '("var(--x2etbn17-color)")'],
      ['a style key', 's.a', `({"color":"${RED}"})`],
    ])('writes out %s', async (_name, read, written) => {
      const { code } = await app(DEFINITIONS + `export const value = ${read};`);
      expect(code).toContain(`export const value = ${written};`);
    });

    it('writes out a keyframes and a viewTransitionClass by their hashes', async () => {
      const { code } = await app(DEFINITIONS + `export const all = [k, vt];`);
      expect(code).toMatch(
        /export const all = \["kf-x[a-z0-9]+", "vt-x[a-z0-9]+"\];/,
      );
    });

    it('writes out definitions imported from another file', async () => {
      const { code } = await transform({
        'tokens.ts': `import * as css from '@plumeria/core';
export const statics = css.createStatic({ gap: 4 });
export const theme = css.createTheme('.dark', { color: { default: 'black', theme: 'white' } });
export const styles = css.create({ a: { color: 'red' } });`,
        'app.tsx': `import '@plumeria/core';
import { statics, theme, styles } from './tokens';
export const all = [statics, statics.gap, statics.zzz, theme, theme.color, styles, styles.a, styles.zzz];`,
      });
      expect(code).toContain(
        `[({"gap":4}), (4), ({"gap":4}).zzz, ({"color":"var(--x2etbn17-color)"}), ("var(--x2etbn17-color)"), ({"a":{"color":"${RED}"}}), ({"color":"${RED}"}), ({"a":{"color":"${RED}"}}).zzz]`,
      );
    });

    it('reads a whole style object in the style prop as no class', async () => {
      const { code } = await app(`export const A = () => <div sx={s} />;`);
      expect(code).toContain(`<div className="" />`);
    });
  });

  describe('transform: css.use', () => {
    it.each([
      ['several styles', 'css.use(s.a, s.b)', `"${RED} ${PADDING}"`],
      ['no argument', 'css.use()', '""'],
      ['a condition', 'css.use(p && s.a)', `((p) ? "${RED}" : "")`],
    ])('compiles %s', async (_name, call, expected) => {
      const { code } = await app(
        `declare const p: boolean; export const cls = ${call};`,
      );
      expect(code).toContain(`export const cls = ${expected};`);
    });

    it('compiles a call through a named import', async () => {
      const { code } = await transform({
        'app.tsx': `import { create, use } from '@plumeria/core';
const s = create({ a: { color: 'red' } });
export const cls = use(s.a);`,
      });
      expect(code).toContain(`export const cls = "${RED}";`);
    });

    it('leaves a call whose callee is not a name alone', async () => {
      const { code } = await app(
        `const v = (() => 1)(); export const A = () => <div sx={s.a} />;`,
      );
      expect(code).toContain('const v = (() => 1)();');
    });
  });

  describe('transform: conditions that set the same property', () => {
    const BLUE = `const t = css.create({ c: { color: 'blue' } });\n`;

    it('checks the later condition before the earlier one', async () => {
      const { code } = await app(
        BLUE +
          `export const A = ({ x, y }: any) => <div sx={[x && s.a, y && t.c]} />;`,
      );
      expect(code).toContain(
        `className={((y) ? "xgmn1kmt" : ((x) ? "${RED}" : ""))}`,
      );
    });

    it('chains two comparisons of one name', async () => {
      const { code } = await app(
        BLUE +
          `export const A = ({ v }: any) => <div sx={[v === 'a' && s.a, v === 'c' && t.c]} />;`,
      );
      expect(code).toContain(
        `((v === 'c') ? "xgmn1kmt" : ((v === 'a') ? "${RED}" : ""))`,
      );
    });

    it('writes a base the conditions do not change as one string', async () => {
      const { code } = await app(
        BLUE +
          `export const A = ({ v, on }: any) => <div sx={[s.b, v === 'a' && s.a, v === 'c' && t.c, on && s.b]} />;`,
      );
      expect(code).toContain(
        `className={"${PADDING}" + " " + ((v === 'c') ? "xgmn1kmt" : ((v === 'a') ? "${RED}" : ""))}`,
      );
    });

    it('drops conditions a later ternary always overrides', async () => {
      const { code } = await app(
        BLUE +
          `export const A = ({ v, y }: any) => <div sx={[v === 'a' && s.a, v === 'c' && t.c, y ? s.a : t.c]} />;`,
      );
      expect(code).toContain(`className={(y ? "${RED}" : "xgmn1kmt")}`);
    });

    it('evaluates a call once for every chain it feeds', async () => {
      const { code } = await app(
        BLUE +
          `const u = css.create({ d: { color: 'red', opacity: 0.5 } });\n` +
          `export const A = ({ a, b }: any) => <div sx={[a() && u.d, b && t.c]} />;`,
      );
      expect(code.match(/a\(\)/g)).toHaveLength(1);
      expect(code).toMatch(
        /\(__plumeria__\$\$a0 = \(\(a\(\)\)\), __plumeria__\$\$a1 = \(\(b\)\), /,
      );
    });

    it('reads earlier conditions before a later call', async () => {
      const { code } = await app(
        BLUE +
          `export const A = ({ flag, update }: any) => <div sx={[flag && t.c, update() && s.a]} />;`,
      );
      expect(code).toContain(
        '(__plumeria__$$a0 = ((flag)), __plumeria__$$a1 = ((update())), ',
      );
    });
  });

  describe('transform: one parameter written with several units', () => {
    const local = (declaration: string) =>
      transform({
        'app.tsx': `import * as css from '@plumeria/core';
const st = css.create(${declaration});
export const A = (p: any) => <div sx={st.fn(p.n)} />;`,
      });

    it('names a second unit on one property after the unit', async () => {
      const { code } = await local(
        "{ fn: (size: number) => ({ width: `${size}px`, ':hover': { width: `${size}%` }, ':focus': { width: size } }) }",
      );
      expect(code).toMatch(
        /__plumeria__\$\$a0 = p\.n, \{ "--([a-z0-9]+)-size": \(\(__plumeria__\$\$a0\) \+ 'px'\), "--\1-size-width": \(\(__plumeria__\$\$a0\) \+ '%'\), "--\1-size-width-px": \(typeof \(__plumeria__\$\$a0\) === 'number' \? \(__plumeria__\$\$a0\) \+ 'px' : \(__plumeria__\$\$a0\)\) \}\)\}/,
      );
    });

    it('names a percentage on a unitless property in words', async () => {
      const { code } = await local(
        "{ fn: (n: number) => ({ lineHeight: n, ':hover': { lineHeight: `${n}px` }, ':focus': { lineHeight: `${n}%` } }) }",
      );
      expect(code).toMatch(
        /__plumeria__\$\$a0 = p\.n, \{ "--([a-z0-9]+)-n": __plumeria__\$\$a0, "--\1-n-line-height": \(\(__plumeria__\$\$a0\) \+ 'px'\), "--\1-n-line-height-percent": \(\(__plumeria__\$\$a0\) \+ '%'\) \}\)\}/,
      );
    });

    it('shares one variable between declarations that write the same unit', async () => {
      const { code } = await local(
        "{ fn: (n: number) => ({ width: `${n}px`, ':hover': { width: `${n}px` }, height: `${n}%` }) }",
      );
      expect(code).toMatch(
        /style=\{\(__plumeria__\$\$a0 = p\.n, \{ "--([a-z0-9]+)-n": \(\(__plumeria__\$\$a0\) \+ 'px'\), "--\1-n-height": \(\(__plumeria__\$\$a0\) \+ '%'\) \}\)\}/,
      );
    });
  });

  describe('transform: an imported function key that reads names around it', () => {
    const imported = (declaration: string, lead: string, call = 'st.fn(p.n)') =>
      transform({
        'styles.ts': `import * as css from '@plumeria/core';
${lead}
export const st = css.create(${declaration});`,
        'app.tsx': `import '@plumeria/core';
import { st } from './styles';
export const A = (p: any) => <div sx={${call}} />;`,
      });

    it.each([
      [
        'a template literal',
        '{ fn: (n: number) => ({ width: `calc(${n}px + ${GAP}px)`, color: TONE }) }',
        `const GAP = 4;\nconst TONE = 'red';`,
        /\{ width: calc\(var\(--[a-z0-9]+-n\) \+ 4px\); \}[\s\S]*\{ color: red; \}/,
      ],
      [
        'a block body',
        '{ fn: (n: number) => { return { width: n, color: TONE }; } }',
        `const TONE = 'red';`,
        /\{ width: var\(--[a-z0-9]+-n\); \}[\s\S]*\{ color: red; \}/,
      ],
      [
        'a function expression',
        '{ fn: function (n: number) { return { width: n, padding: GAP }; } }',
        `const GAP = 4;`,
        /\{ width: var\(--[a-z0-9]+-n\); \}[\s\S]*\{ padding: 4px; \}/,
      ],
      [
        'a parameter default',
        '{ fn: (n: number = GAP) => ({ width: n }) }',
        `const GAP = 4;`,
        /\{ width: var\(--[a-z0-9]+-n, 4px\); \}/,
      ],
      [
        'a shorthand property',
        '{ fn: (n: number) => ({ width: n, color }) }',
        `const color = 'red';`,
        /\{ color: red; \}/,
      ],
      [
        'members and a spread of objects',
        '{ fn: (n: number) => ({ width: n, color: TOKENS.tone, margin: TOKENS.deep.gap, ...BASE }) }',
        `const TOKENS = { tone: 'red', deep: { gap: 4 } };\nconst BASE = { display: 'flex' };`,
        /\{ color: red; \}[\s\S]*\{ margin: 4px; \}[\s\S]*\{ display: flex; \}/,
      ],
    ])('resolves %s', async (_name, declaration, lead, expected) => {
      const { css } = await imported(declaration, lead);
      expect(css).toMatch(expected);
    });

    it.each([
      [
        'an array pattern and a rest parameter',
        '{ fn: ([a]: number[], ...rest: number[]) => ({ width: a }) }',
        'st.fn(p.n)',
      ],
      [
        'a rest element in a named parameter',
        '{ fn: ({ tone, ...rest }: any) => ({ color: tone }) }',
        'st.fn({ tone: p.t })',
      ],
    ])('rejects %s', async (_name, declaration, call) => {
      await expect(imported(declaration, '', call)).rejects.toThrow(
        '[plumeria] Dynamic styles require named parameters or object destructuring; array and rest parameters are not supported.',
      );
    });
  });

  describe('transform: values read through other definitions', () => {
    it('names a keyframes and a viewTransitionClass inside a style', async () => {
      const { css } = await transform({
        'app.tsx': `import * as css from '@plumeria/core';
const k = css.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const vt = css.viewTransitionClass({ old: { opacity: 0 } });
const st = css.create({ a: { animationName: k, viewTransitionName: vt } });
export const A = () => <div sx={st.a} />;`,
      });
      expect(css).toMatch(/@keyframes kf-x[a-z0-9]+ \{/);
      expect(css).toMatch(/::view-transition-old\(\*\.vt-x[a-z0-9]+\) \{/);
    });

    it('names a keyframes read through a namespace import', async () => {
      const { css } = await transform({
        'anim.ts': `import * as css from '@plumeria/core';
export const k = css.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });`,
        'app.tsx': `import * as css from '@plumeria/core';
import * as anim from './anim';
const st = css.create({ a: { animationName: anim.k } });
export const A = () => <div sx={st.a} />;`,
      });
      expect(css).toMatch(/@keyframes kf-x[a-z0-9]+ \{/);
      expect(css).toMatch(/animation-name: kf-x[a-z0-9]+;/);
    });

    it.each([
      [
        'a createStatic value read through two quoted keys',
        {
          'app.tsx': `import * as css from '@plumeria/core';
const bp = css.createStatic({ n: { gap: 4 } });
const st = css.create({ a: { margin: bp['n']['gap'] } });
export const A = () => <div sx={st.a} />;`,
        },
        `Cannot resolve the value of "margin" at build time (bp['n']['gap']).`,
      ],
    ])('rejects %s', async (_name, files, message) => {
      await expect(transform(files)).rejects.toThrow(message);
    });

    it('spreads an object constant and passes over one that is not an object', async () => {
      const { css } = await transform({
        'app.tsx': `import * as css from '@plumeria/core';
const base = { color: 'red' };
const num = 4;
const st = css.create({ a: { ...base, ...num, padding: 1 } });
export const A = () => <div sx={st.a} />;`,
      });
      expect(css).toContain('{ color: red; }');
      expect(css).toContain('{ padding: 1px; }');
    });
  });

  describe('transform: no cwd given', () => {
    it('scans the directory the process is running in', async () => {
      const project = path.join(DIR, 'default-cwd');
      fs.mkdirSync(project);
      fs.writeFileSync(
        path.join(project, 'card.tsx'),
        `import * as css from '@plumeria/core';
export const Card = ({ cardStyle }: { cardStyle?: css.Style }) => <div sx={cardStyle} />;`,
      );
      const source = `import * as css from '@plumeria/core';
import { Card } from './card';
const s = css.create({ a: { color: 'red' } });
export const A = () => <Card cardStyle={s.a} />;`;
      const filePath = path.join(project, 'app.tsx');
      fs.writeFileSync(filePath, source);

      const previous = process.cwd();
      process.chdir(project);
      try {
        const { code } = await transformSource({
          source,
          moduleId: filePath,
          filePath,
          root: project,
          isDev: false,
        });
        expect(code).toContain(`<Card cardStyle={"xdeb8kup"} />`);
      } finally {
        process.chdir(previous);
      }
    });
  });

  describe('transform: a spread inside a style', () => {
    const declared = (declaration: string, lead = '') =>
      transform({
        'app.tsx': `import * as css from '@plumeria/core';
${lead}
const st = css.create(${declaration});
export const A = () => <div sx={st.a} />;`,
      });

    it.each([
      [
        'an object constant, which a later key overrides',
        `{ a: { ...base, color: 'red' } }`,
        `const base = { padding: 2, color: 'blue' };`,
        ['{ padding: 2px; }', '{ color: red; }'],
      ],
      [
        'an object constant, which overrides an earlier key',
        `{ a: { color: 'red', ...base } }`,
        `const base = { padding: 2, color: 'blue' };`,
        ['{ padding: 2px; }', '{ color: blue; }'],
      ],
      [
        'a member of an object constant',
        `{ a: { ...base.inner, color: 'red' } }`,
        `const base = { inner: { padding: 2 } };`,
        ['{ padding: 2px; }', '{ color: red; }'],
      ],
    ])('reads %s', async (_name, declaration, lead, rules) => {
      const { css } = await declared(declaration, lead);
      for (const rule of rules) expect(css).toContain(rule);
    });

    it.each([
      [
        'a call',
        `{ a: { ...make(), color: 'red' } }`,
        '[plumeria] Cannot spread a function call at build time.',
      ],
      [
        'a name it cannot resolve',
        `{ a: { ...missing, color: 'red' } }`,
        '[plumeria] Cannot resolve static value: missing.',
      ],
      [
        'an object literal',
        `{ a: { ...({ padding: 2 }), color: 'red' } }`,
        '[plumeria] Unsupported expression type: an object literal.',
      ],
      [
        'a conditional expression',
        `{ a: { ...(flag ? { padding: 2 } : {}), color: 'red' } }`,
        '[plumeria] Unsupported expression type: a conditional expression.',
      ],
    ])('rejects %s', async (_name, declaration, message) => {
      await expect(declared(declaration, 'const flag = true;')).rejects.toThrow(
        message,
      );
    });
  });

  describe('transform: a style object it cannot see', () => {
    it.each([
      [
        'a function key behind two members',
        `const lib: any = {}; export const A = () => <div sx={[s.a, lib.styles.fn(1)]} />;`,
        'lib.styles.fn(1)',
      ],
      [
        'a function key on the result of a call',
        `const get = (): any => s; export const A = () => <div sx={[s.a, get().fn(1)]} />;`,
        'get().fn(1)',
      ],
      [
        'a function key on a parameter that shadows the style object',
        `export const A = ({ s }: any) => <div sx={s.fn(1)} />;`,
        's.fn(1)',
      ],
      [
        'a static key on a parameter that shadows the style object',
        `export const A = ({ s }: any) => <div sx={s.a} />;`,
        's.a',
      ],
    ])('rejects %s', async (_name, body, source) => {
      await expect(app(body)).rejects.toThrow(
        `[plumeria] Dynamic or unresolvable style object "${source}" is not supported.`,
      );
    });
  });

  describe('transform: where a component reads the style it receives', () => {
    const TABLE = `{__proto__:null,"xdeb8kup":"${RED}"}`;

    it.each([
      [
        'a member of the props object',
        `(props: { cardStyle?: css.Style }) => <div sx={props.cardStyle} />`,
        `(${TABLE}[props.cardStyle] || "")`,
      ],
      [
        'a name destructured in the body',
        `(props: { cardStyle?: css.Style }) => { const { cardStyle } = props; return <div sx={cardStyle} />; }`,
        `(${TABLE}[cardStyle] || "")`,
      ],
      [
        'a function nested in the component',
        `({ cardStyle }: { cardStyle?: css.Style }) => { const inner = () => <div sx={cardStyle} />; return inner(); }`,
        `(${TABLE}[cardStyle] || "")`,
      ],
    ])('looks the key up through %s', async (_name, component, lookup) => {
      const { code } = await app(
        `const Card = ${component};
export const A = () => <Card cardStyle={s.a} />;`,
      );
      expect(code).toContain(lookup);
      expect(code).toContain('<Card cardStyle={"xdeb8kup"} />');
    });

    it('joins a base with a received array that holds a function key', async () => {
      const { code } = await app(
        `const Card = ({ cardStyle }: { cardStyle?: css.Style }) => <div sx={[s.b, cardStyle]} />;
export const A = ({ n, on }: any) => <Card cardStyle={[on && s.a, s.fn(n)]} />;`,
      );
      expect(code).toMatch(
        new RegExp(
          `className=\\{"${PADDING}" \\+ " " \\+ \\(\\{__proto__:null,"x[a-z0-9]+":"${RED} x[a-z0-9]+","x[a-z0-9]+":"x[a-z0-9]+"\\}\\[\\(\\(cardStyle && cardStyle\\.key\\) \\|\\| cardStyle\\)\\] \\|\\| ""\\)\\}`,
        ),
      );
    });
  });

  describe('transform: styles that set the same property', () => {
    const BLUE = `const t = css.create({ c: { color: 'blue' }, x: { color: 'blue' }, y: { color: 'green' } });\n`;

    it('keeps the later of two styles that are always applied', async () => {
      const { code, css } = await app(
        BLUE + `export const A = () => <div sx={[s.a, t.c]} />;`,
      );
      expect(code).toMatch(/<div className="x[a-z0-9]+" \/>/);
      expect(code).not.toContain(RED);
      expect(css).toBe('.xgmn1kmt { color: blue; }\n');
    });

    it('writes a conditional between two of them as it stands', async () => {
      const { code } = await app(
        BLUE +
          `export const A = ({ on }: any) => <div sx={[on ? s.a : t.c, s.b]} />;`,
      );
      expect(code).toContain(
        `className={(on ? "${PADDING} ${RED}" : "${PADDING} xgmn1kmt")}`,
      );
    });

    it('falls back to the bracket when the condition is off', async () => {
      const { code } = await app(
        BLUE +
          `export const A = ({ k, on }: any) => <div sx={[t[k], on && s.a]} />;`,
      );
      expect(code).toContain(
        `((on) ? "${RED}" : ({__proto__:null,"c":"xgmn1kmt","x":"xgmn1kmt","y":"x3git8yv"}[k] ?? ""))`,
      );
    });
  });
});
