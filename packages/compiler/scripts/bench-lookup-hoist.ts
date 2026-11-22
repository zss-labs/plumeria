import { spawnSync } from 'node:child_process';

const SIZES = [2, 4, 8, 16, 32];
const SHAPES = ['open', 'closed'] as const;
const TIERS: Array<[string, string[]]> = [
  ['ignition', ['--max-opt=0']],
  ['sparkplug', ['--max-opt=1']],
  ['maglev', ['--max-opt=2']],
  ['turbofan', []],
];
const SAMPLES = 9;
const TARGET_NS = 20_000_000;
const KEY_COUNT = 1024;

type Shape = (typeof SHAPES)[number];
type Variant = {
  size: number;
  shape: Shape;
  mode: 'inline' | 'hoisted' | 'lazy';
};

const table = (size: number, shape: Shape) => {
  const entries = Array.from(
    { length: size },
    (_, i) => `"k${i}":"x${(i * 7919).toString(36).padStart(7, 'a')}"`,
  );
  return `{${shape === 'open' ? '__proto__:null,' : ''}${entries.join(',')}}`;
};

const build = ({ size, shape, mode }: Variant) => {
  const lit = table(size, shape);
  const read = shape === 'open' ? '|| ""' : '?? ""';
  const source =
    mode === 'inline'
      ? `return function (k) { return (${lit}[k] ${read}); };`
      : mode === 'hoisted'
        ? `const t = ${lit}; return function (k) { return (t[k] ${read}); };`
        : `var t; function init() { return (t = ${lit}); } return function (k) { return ((t ?? init())[k] ${read}); };`;
  return new Function(source)() as (k: string) => string;
};

const keysFor = (size: number) => {
  let seed = size * 2654435761;
  const next = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed;
  };
  return Array.from({ length: KEY_COUNT }, () => {
    const r = next();
    return r % 8 === 0 ? 'missing' : `k${r % size}`;
  });
};

let sink = 0;

const run = (fn: (k: string) => string, keys: string[], calls: number) => {
  const start = process.hrtime.bigint();
  for (let i = 0; i < calls; i++) {
    sink += fn(keys[i & (KEY_COUNT - 1)]).length;
  }
  return Number(process.hrtime.bigint() - start);
};

const calibrate = (fn: (k: string) => string, keys: string[]) => {
  let calls = 1024;
  for (;;) {
    const ns = run(fn, keys, calls);
    if (ns >= TARGET_NS / 4) return Math.ceil((calls * TARGET_NS) / ns);
    calls *= 4;
  }
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

const child = () => {
  const rows: Array<Variant & { ns: number }> = [];
  for (const size of SIZES) {
    for (const shape of SHAPES) {
      const keys = keysFor(size);
      const fns = (['inline', 'hoisted', 'lazy'] as const).map((mode) => {
        const fn = build({ size, shape, mode });
        return { mode, fn, calls: calibrate(fn, keys), times: [] as number[] };
      });
      for (let s = 0; s < SAMPLES; s++) {
        const order = s % 2 === 0 ? fns : [...fns].reverse();
        for (const v of order) v.times.push(run(v.fn, keys, v.calls) / v.calls);
      }
      for (const v of fns)
        rows.push({ size, shape, mode: v.mode, ns: median(v.times) });
    }
  }
  process.stdout.write(JSON.stringify({ rows, sink }));
};

const parent = () => {
  console.log(`node ${process.version}`);
  for (const [tier, flags] of TIERS) {
    const result = spawnSync(
      process.execPath,
      [...flags, process.argv[1], '--child'],
      { encoding: 'utf8', maxBuffer: 1 << 24 },
    );
    if (result.status !== 0) {
      console.error(result.stderr);
      process.exit(1);
    }
    const { rows } = JSON.parse(result.stdout) as {
      rows: Array<Variant & { ns: number }>;
    };
    console.log(`\n${tier}`);
    console.log('size  shape   inline ns  hoisted ns  lazy ns  speedup');
    for (const size of SIZES) {
      for (const shape of SHAPES) {
        const pick = (mode: Variant['mode']) =>
          rows.find(
            (r) => r.size === size && r.shape === shape && r.mode === mode,
          )!.ns;
        const inline = pick('inline');
        const hoisted = pick('hoisted');
        const lazy = pick('lazy');
        console.log(
          `${String(size).padStart(4)}  ${shape.padEnd(6)}  ${inline.toFixed(2).padStart(9)}  ${hoisted.toFixed(2).padStart(10)}  ${lazy.toFixed(2).padStart(7)}  ${(inline / lazy).toFixed(2).padStart(6)}x`,
        );
      }
    }
  }
};

if (process.argv.includes('--child')) child();
else parent();
