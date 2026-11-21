import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_STYLE_PROP } from '@plumeria/utils';
import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ transformSource }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-')),
  );
  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

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

  const HEAD = `
import * as css from '@plumeria/core';
const a = css.create({ a0: { color: 'red' }, a1: { color: 'blue' } });
const b = css.create({ b0: { color: 'teal' }, b1: { color: 'navy' } });
const c = css.create({ c0: { margin: 1 }, c1: { margin: 2 } });
const d = css.create({ d0: { margin: 3 }, d1: { margin: 4 } });
const bridge = css.create({
  e0: { color: 'gold', margin: 5 },
  e1: { color: 'gray', margin: 6 },
});
`;

  const classExpr = async (styleExpr: string) => {
    const result = await transformSource(
      env(
        `${HEAD}export const A = ({ ka, kb, kc, kd, ke }: any) => <div sx={${styleExpr}} />;`,
        `${DIR}/fixture.tsx`,
      ),
    );
    const code = typeof result === 'string' ? result : (result?.code ?? '');
    const found = code.match(/className=(?:\{([\s\S]*?)\}|"([^"]*)") \/>/);
    if (!found) throw new Error(`no className in:\n${code}`);
    return found[1] ?? JSON.stringify(found[2]);
  };

  const tableSizes = (expr: string) =>
    (expr.match(/\{__proto__:null,(?:"[^"]*":"[^"]*",?)+\}/g) ?? []).map(
      (table) => (table.match(/":"/g) ?? []).length,
    );

  const norm = (value: string) =>
    value.trim().split(/\s+/).filter(Boolean).sort().join(' ');

  const evaluate = (expr: string, vars: Record<string, unknown>) => {
    const names = Object.keys(vars);
    const fn = new Function(...names, `return (${expr});`);
    return norm(fn(...names.map((n) => vars[n])));
  };

  const literal = (styleExpr: string, combo: Record<string, string>) =>
    styleExpr
      .replace(/a\[ka\]/g, `a.${combo.ka}`)
      .replace(/b\[kb\]/g, `b.${combo.kb}`)
      .replace(/c\[kc\]/g, `c.${combo.kc}`)
      .replace(/d\[kd\]/g, `d.${combo.kd}`)
      .replace(/bridge\[ke\]/g, `bridge.${combo.ke}`);

  const SPACES: Record<string, string[]> = {
    ka: ['a0', 'a1'],
    kb: ['b0', 'b1'],
    kc: ['c0', 'c1'],
    kd: ['d0', 'd1'],
    ke: ['e0', 'e1'],
  };

  const combosOf = (names: string[]) =>
    names.reduce<Array<Record<string, string>>>(
      (acc, name) =>
        acc.flatMap((base) =>
          SPACES[name].map((value) => ({ ...base, [name]: value })),
        ),
      [{}],
    );

  describe('transform: conflicting styles become one chain per property', () => {
    it('chains two groups that set the same property', async () => {
      expect(tableSizes(await classExpr('[a[ka], b[kb]]'))).toEqual([2, 2]);
    });

    it('writes one chain for each pair of unrelated properties', async () => {
      expect(
        tableSizes(await classExpr('[a[ka], b[kb], c[kc], d[kd]]')),
      ).toEqual([2, 2, 2, 2]);
    });

    it('repeats a bridging group in each chain instead of multiplying', async () => {
      expect(
        tableSizes(await classExpr('[a[ka], b[kb], c[kc], d[kd], bridge[ke]]')),
      ).toEqual([2, 2, 2, 2, 2, 2]);
    });

    it('chains a boolean condition without a table', async () => {
      expect(
        tableSizes(await classExpr('[a[ka], b[kb], kc && c.c0, d[kd]]')),
      ).toEqual([2, 2, 2]);
    });

    it.each(['constructor', 'toString', '__proto__'])(
      'falls back past a key the table does not hold: %s',
      async (key) => {
        const lone = await classExpr('[a[ka]]');
        expect(evaluate(lone, { ka: key })).toBe('');
        const chained = await classExpr('[a.a0, b[kb]]');
        expect(evaluate(chained, { kb: key })).toBe(
          evaluate(await classExpr('[a.a0]'), {}),
        );
      },
    );

    it('reads a property once for every chain it feeds', async () => {
      let reads = 0;
      const ka = {
        get on() {
          reads++;
          return true;
        },
      };
      const expr = await classExpr('[ka.on && bridge.e0, kb && a.a0]');
      expect(evaluate(expr, { ka, kb: false })).toBe(
        evaluate(await classExpr('[bridge.e0]'), {}),
      );
      expect(reads).toBe(1);
    });

    it.each([
      { gate: false, branch: true, expected: '', reads: ['gate'] },
      { gate: true, branch: true, expected: 'a.a0', reads: ['gate', 'branch'] },
      {
        gate: true,
        branch: false,
        expected: 'b.b0',
        reads: ['gate', 'branch'],
      },
    ])(
      'short-circuits a nested decision ($gate, $branch)',
      async ({ gate, branch, expected, reads }) => {
        const seen: string[] = [];
        const expr = await classExpr('[ka.on && (kb.on ? a.a0 : b.b0)]');
        const result = evaluate(expr, {
          ka: {
            get on() {
              seen.push('gate');
              return gate;
            },
          },
          kb: {
            get on() {
              seen.push('branch');
              return branch;
            },
          },
        });
        expect(seen).toEqual(reads);
        expect(result).toBe(
          expected ? evaluate(await classExpr(expected), {}) : '',
        );
      },
    );

    it('keeps a variant named __proto__', async () => {
      const result = await transformSource(
        env(
          `import * as css from '@plumeria/core';
const v = css.create({ ["__proto__"]: { color: 'red' }, other: { color: 'blue' } });
export const A = ({ k }: any) => <div sx={v[k]} />;`,
          `${DIR}/proto.tsx`,
        ),
      );
      const code = typeof result === 'string' ? result : (result?.code ?? '');
      expect(code).toContain('["__proto__"]:"xq96bg3w"');
    });

    it.each([
      [
        'unrelated pairs',
        '[a[ka], b[kb], c[kc], d[kd]]',
        ['ka', 'kb', 'kc', 'kd'],
      ],
      [
        'bridged pairs',
        '[a[ka], b[kb], c[kc], d[kd], bridge[ke]]',
        ['ka', 'kb', 'kc', 'kd', 'ke'],
      ],
      [
        'a bridge in the middle',
        '[a[ka], bridge[ke], d[kd]]',
        ['ka', 'ke', 'kd'],
      ],
      [
        'a base ahead of two pairs',
        '[a.a0, b[kb], c[kc], d[kd]]',
        ['kb', 'kc', 'kd'],
      ],
    ])(
      'matches the literal-key form for every input: %s',
      async (_label, styleExpr, names) => {
        const actual = await classExpr(styleExpr);
        for (const combo of combosOf(names as string[])) {
          const reference = await classExpr(literal(styleExpr, combo));
          expect(evaluate(actual, combo)).toBe(evaluate(reference, combo));
        }
      },
    );
  });
});
