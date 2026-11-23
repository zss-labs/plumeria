import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { transformSync } from '@swc/core';
import { DEFAULT_STYLE_PROP } from '@plumeria/utils';
import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ transformSource }) => {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-styled-')),
  );

  const write = (name: string, source: string) => {
    const filePath = path.join(directory, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
    return filePath;
  };

  const run = async (source: string, name = `${Math.random()}.tsx`) => {
    const filePath = write(name, source);
    const { code } = await transformSource({
      source,
      moduleId: filePath,
      filePath,
      root: directory,
      cwd: directory,
      styleProp: DEFAULT_STYLE_PROP,
      propertyPolicy: undefined,
      isDev: false,
      addDependency: () => {},
    });
    return code;
  };

  const failure = async (source: string, name?: string) => {
    try {
      await run(source, name);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('expected the transform to fail');
  };

  const head = `import { styled } from '@plumeria/react';`;

  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('compiles a styled element to an atomic class', async () => {
    const code = await run(
      `${head}\nexport const Button = styled.button({ color: 'red' });\nexport const App = () => <Button />;`,
    );

    expect(code).not.toContain('@plumeria/react');
    expect(code).toContain('<button');
    expect(code).toContain('className');
  });

  it('turns a dynamic value into a CSS variable', async () => {
    const code = await run(
      `${head}\nexport const Box = styled.div({ width: (p: { w: number }) => p.w });\nexport const App = () => <Box w={4} />;`,
    );

    expect(code).toContain('<div');
    expect(code).toMatch(/--[\w-]+/);
  });

  const render = (code: string) => {
    const { code: js } = transformSync(code, {
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        transform: { react: { runtime: 'classic', pragma: 'h' } },
        target: 'es2022',
      },
      module: { type: 'commonjs' },
    });
    const exports: Record<string, () => Element> = {};
    type Element = { type: unknown; props: Record<string, unknown> };
    const h = (type: unknown, props: Record<string, unknown> | null) => ({
      type,
      props: props ?? {},
    });
    new Function('exports', 'require', 'h', js)(exports, () => ({}), h);
    const element = (name: string) => {
      let node = exports[name]();
      while (typeof node.type === 'function')
        node = (node.type as (props: object) => Element)(node.props);
      return {
        tag: node.type,
        classes: String(node.props.className ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .sort(),
      };
    };
    return Object.assign(element, { exports: exports as any });
  };

  it('merges parent, child and call-site styles in that order', async () => {
    const reference = render(
      await run(
        `import * as css from '@plumeria/core';\nconst r = css.create({ blue: { color: 'blue', padding: 8 }, green: { color: 'green', padding: 8 } });\nexport const Blue = () => <button sx={r.blue} />;\nexport const Green = () => <button sx={r.green} />;`,
      ),
    );
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ green: { color: 'green' } });\nconst Base = styled.button({ color: 'red', padding: 8 });\nexport const Ghost = styled(Base)({ color: 'blue' });\nexport const Plain = () => <Ghost />;\nexport const Override = () => <Ghost sx={styles.green} />;`,
      ),
    );

    expect(actual('Plain')).toEqual(reference('Blue'));
    expect(actual('Override')).toEqual(reference('Green'));
  });

  it('applies a variant chosen by a dynamic key', async () => {
    const reference = render(
      await run(
        `import * as css from '@plumeria/core';\nconst r = css.create({ blue: { color: 'blue' }, red: { color: 'red' } });\nexport const Blue = () => <button sx={r.blue} />;\nexport const Red = () => <button sx={r.red} />;`,
      ),
    );
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ primary: { color: 'blue' }, danger: { color: 'red' } });\nconst Button = styled.button({ color: 'black' });\nconst Pick = ({ tone }: { tone: 'primary' | 'danger' }) => <Button sx={styles[tone]} />;\nexport const Primary = () => <Pick tone="primary" />;\nexport const Danger = () => <Pick tone="danger" />;`,
      ),
    );

    expect(actual('Primary')).toEqual(reference('Blue'));
    expect(actual('Danger')).toEqual(reference('Red'));
  });

  it('keeps the rest of the array when a dynamic key matches nothing', async () => {
    const reference = render(
      await run(
        `import * as css from '@plumeria/core';\nconst r = css.create({ base: { color: 'black', padding: 8 }, red: { color: 'red', padding: 8 }, bold: { color: 'black', padding: 8, fontWeight: 700 } });\nexport const Base = () => <button sx={r.base} />;\nexport const Red = () => <button sx={r.red} />;\nexport const Bold = () => <button sx={r.bold} />;`,
      ),
    );
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ base: { padding: 8 }, danger: { color: 'red' }, bold: { fontWeight: 700 } });\nconst Button = styled.button({ color: 'black' });\nconst Pick = ({ tone, on }: { tone: string; on: boolean }) => <Button sx={[styles.base, on && styles.bold, styles[tone]]} />;\nconst Lone = ({ tone }: { tone: string }) => <Button sx={[styles.base, styles[tone]]} />;\nexport const Missing = () => <Lone tone="nope" />;\nexport const Danger = () => <Lone tone="danger" />;\nexport const BoldMissing = () => <Pick tone="nope" on={true} />;`,
      ),
    );

    expect(actual('Missing')).toEqual(reference('Base'));
    expect(actual('Danger')).toEqual(reference('Red'));
    expect(actual('BoldMissing')).toEqual(reference('Bold'));
  });

  it.each([
    [
      'with a caller',
      `const Card = ({ styleArray }: any) => <Button sx={styleArray} />;\nexport const App = () => <Card styleArray={styles.danger} />;`,
    ],
    [
      'without a caller',
      `export const Card = ({ styleArray }: any) => <Button sx={[styles.base, styleArray]} />;`,
    ],
  ])(
    'rejects a received style relayed to a styled component %s',
    async (_, body) => {
      const message = await failure(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ base: { padding: 8 }, danger: { color: 'red' } });\nconst Button = styled.button({ color: 'black' });\n${body}`,
      );

      expect(message).toContain(
        '"styleArray" is a style received through a prop, so it cannot be passed on to <Button>, which takes sx too.',
      );
    },
  );

  it('reads a dynamic key once', async () => {
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ primary: { color: 'blue' }, danger: { color: 'red' }, bold: { fontWeight: 700 } });\nconst Button = styled.button({ color: 'black' });\nexport const counter = { reads: 0 };\nconst p = { get tone() { counter.reads++; return 'danger'; } };\nconst String = () => 'primary';\nexport const Lone = () => <Button sx={styles[p.tone]} />;\nconst Pick = ({ on = true }) => <Button sx={[on && styles.bold, styles[p.tone]]} />;\nexport const Mixed = () => <Pick />;`,
      ),
    );
    const reference = render(
      await run(
        `import * as css from '@plumeria/core';\nconst r = css.create({ red: { color: 'red' }, bold: { color: 'red', fontWeight: 700 } });\nexport const Red = () => <button sx={r.red} />;\nexport const Bold = () => <button sx={r.bold} />;`,
      ),
    );

    expect(actual('Lone')).toEqual(reference('Red'));
    expect(actual.exports.counter.reads).toBe(1);
    expect(actual('Mixed')).toEqual(reference('Bold'));
    expect(actual.exports.counter.reads).toBe(2);
  });

  it('evaluates each dynamic style argument once per call', async () => {
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ sum: (n: number) => ({ width: n + n }), pair: (n: number) => ({ width: n + 4, height: n * 2 }), fallback: (n = 10) => ({ width: n + 4 }), plain: (n: number) => ({ width: n }) });\nconst Button = styled.button({ color: 'black' });\nexport const reads: string[] = [];\nconst read = (name: string, value?: number) => { reads.push(name); return value; };\nexport const Sum = () => <div sx={styles.sum(read('sum', 4)!)} />;\nexport const Pair = () => <Button sx={styles.pair(read('pair', 4)!)} />;\nexport const Fallback = () => <div sx={styles.fallback(read('fallback'))} />;\nexport const Unused = () => <div sx={styles.plain(8, read('unused'))} />;`,
      ),
    );
    const { reads } = actual.exports;

    for (const name of ['Sum', 'Pair', 'Fallback']) {
      actual(name);
      expect(reads.splice(0)).toEqual([name.toLowerCase()]);
    }
    actual('Unused');
    expect(reads.splice(0)).toEqual(['unused']);
  });

  it('reads an identifier argument before a later argument runs', async () => {
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ size: (width: number, height: number) => ({ width, height }) });\nlet x = 1;\nconst bump = () => { x = 2; return 3; };\nexport const Size = () => <div sx={styles.size(x, bump())} />;`,
      ),
    );

    expect(Object.values(actual.exports.Size().props.style as object)).toEqual([
      '1px',
      '3px',
    ]);
  });

  it('keeps a caller variable apart from a parameter of the same name', async () => {
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ size: (width: number, height: number) => ({ width, height }) });\nconst readWidth = () => 10;\nexport const Size = ({ width = 20 }) => <div sx={styles.size(readWidth(), width)} />;`,
      ),
    );

    expect(
      Object.values(actual.exports.Size({}).props.style as object),
    ).toEqual(['10px', '20px']);
  });

  it('evaluates every value of a repeated named argument', async () => {
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ size: ({ width }: { width: number }) => ({ width }) });\nexport const reads: string[] = [];\nconst first = () => { reads.push('first'); return 1; };\nconst second = () => { reads.push('second'); return 2; };\nexport const Size = () => <div sx={styles.size({ width: first(), width: second() })} />;`,
      ),
    );

    const style = actual.exports.Size().props.style as object;
    expect(actual.exports.reads).toEqual(['first', 'second']);
    expect(Object.values(style)).toEqual(['2px']);
  });

  describe('an element that reads at runtime in both attributes', () => {
    const element = (body: string) =>
      run(
        `import * as css from '@plumeria/core';
const styles = css.create({ w: (n: number) => ({ width: n }), base: { padding: 8 }, track: (n: number) => ({ color: 'red' }) });
const tones = css.create({ x: { color: 'red' }, y: { color: 'blue' } });
export const reads: string[] = [];
const read = <T,>(name: string, value: T) => { reads.push(name); return value; };
export const flags = { value: true, get on() { reads.push('on'); return this.value; } };
${body}`,
      ).then(render);

    it('reads every attribute and element once in attribute order', async () => {
      const actual = await element(
        `export const A = () => <div style={read('style', { top: 1 })} sx={[tones[read('tone', 'x')], styles.w(read('w', 4)), flags.on && styles.base]} className={read('class', 'c')} />;`,
      );
      const { props } = actual.exports.A();

      expect(actual.exports.reads).toEqual([
        'style',
        'tone',
        'w',
        'on',
        'class',
      ]);
      expect(props.className).toMatch(/^c /);
      expect(Object.values(props.style)).toEqual([1, '4px']);
    });

    it('passes a comma expression key as one argument', async () => {
      const actual = await element(
        `export const A = () => <div sx={[tones[read('mark', 'x'), read('tone', 'y')], styles.w(read('w', 4))]} />;
export const B = () => <div sx={tones.y} />;`,
      );
      const { props } = actual.exports.A();

      expect(actual.exports.reads).toEqual(['mark', 'tone', 'w']);
      expect(props.className).toContain(actual.exports.B().props.className);
      expect(Object.values(props.style)).toEqual(['4px']);
    });

    it('keeps the order beside a condition with three branches', async () => {
      const actual = await element(
        `export const A = () => <div sx={[styles.w(read('w', 4)), read('a', false) ? tones.x : read('b', true) ? tones.y : styles.base]} />;`,
      );
      const { props } = actual.exports.A();

      expect(actual.exports.reads).toEqual(['w', 'a', 'b']);
      expect(Object.values(props.style)).toEqual(['4px']);
    });

    it('reads a guard once for a literal argument behind it', async () => {
      const actual = await element(
        `export const A = () => <div sx={flags.on && styles.w(4)} />;`,
      );
      const { props } = actual.exports.A();

      expect(actual.exports.reads).toEqual(['on']);
      expect(props.className).not.toBe('');
      expect(Object.values(props.style)).toEqual(['4px']);
    });

    it('keeps two attributes when only one side reads at runtime', async () => {
      const code = await run(
        `import * as css from '@plumeria/core';
const tones = css.create({ x: { color: 'red' }, y: { color: 'blue' } });
const styles = css.create({ w: (n: number) => ({ width: n }) });
export const A = ({ tone }: { tone: 'x' | 'y' }) => <div style={{ top: 1 }} sx={tones[tone]} />;
export const B = ({ tone }: { tone: 'x' | 'y' }) => <div className={'fixed'} sx={[tones[tone], styles.w(4)]} />;`,
      );

      expect(code).toContain('style={{ top: 1 }}');
      expect(code).not.toContain('{...(');
    });

    it('passes the style on untouched when a false guard leaves no variable', async () => {
      const actual = await element(
        `export const style = { get top() { reads.push('top'); return 1; } };
export const A = () => <div style={style} sx={[flags.on && styles.w(read('w', 4)), tones.x]} />;`,
      );
      actual.exports.flags.value = false;
      const { props } = actual.exports.A();

      expect(actual.exports.reads).toEqual(['on']);
      expect(props.style).toBe(actual.exports.style);
    });

    it('evaluates an unused argument without copying the style', async () => {
      const actual = await element(
        `export const style = { top: 1 };
export const A = () => <div style={style} sx={[flags.on && styles.track(1, read('unused', 0)), tones.x]} />;`,
      );
      const { props } = actual.exports.A();

      expect(actual.exports.reads).toEqual(['on', 'unused']);
      expect(props.style).toBe(actual.exports.style);
    });

    it('keeps an awaited argument behind its guard', async () => {
      const actual = await element(
        `export const A = async () => <div sx={[flags.on && styles.w(await read('w', Promise.resolve(4))), tones[read('tone', 'y')]]} />;`,
      );
      const { props } = await actual.exports.A();

      expect(actual.exports.reads).toEqual(['on', 'w', 'tone']);
      expect(Object.values(props.style)).toEqual(['4px']);

      actual.exports.flags.value = false;
      actual.exports.reads.splice(0);
      const off = await actual.exports.A();
      expect(actual.exports.reads).toEqual(['on', 'tone']);
      expect(off.props.style).toBeUndefined();
    });
  });

  it('keeps dynamic style arguments in source order', async () => {
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ base: { padding: 8 }, danger: { color: 'red' }, width: (w: number) => ({ width: w }) });\nconst Button = styled.button({ color: 'black' });\nexport const reads: string[] = [];\nconst readWidth = () => { reads.push('width'); return 10; };\nconst p = { get tone() { reads.push('tone'); return 'danger'; } };\nconst flags = { get on() { reads.push('on'); return true; } };\nexport const Later = () => <Button sx={[styles[p.tone], styles.width(readWidth()), flags.on && styles.base]} />;\nexport const Earlier = () => <Button sx={[styles.width(readWidth()), styles[p.tone]]} />;`,
      ),
    );
    const { reads } = actual.exports;

    actual('Later');
    expect(reads.splice(0)).toEqual(['tone', 'width', 'on']);
    actual('Earlier');
    expect(reads.splice(0)).toEqual(['width', 'tone']);
  });

  it('keeps the order of guarded and later reads', async () => {
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ base: { padding: 8 }, danger: { color: 'red' } });\nconst Button = styled.button({ color: 'black' });\nexport const reads: string[] = [];\nconst p = { get key() { reads.push('key'); return 'danger'; } };\nconst flags = { get on() { reads.push('on'); return true; } };\nconst Pick = ({ tone, enabled }: { tone: string; enabled: boolean }) => <Button sx={[styles[tone], enabled && styles[p.key], flags.on && styles.base]} />;\nexport const On = () => <Pick tone="danger" enabled={true} />;\nexport const Off = () => <Pick tone="danger" enabled={false} />;`,
      ),
    );
    const reference = render(
      await run(
        `import * as css from '@plumeria/core';\nconst r = css.create({ both: { color: 'red', padding: 8 } });\nexport const Both = () => <button sx={r.both} />;`,
      ),
    );
    const { reads } = actual.exports;

    expect(actual('On')).toEqual(reference('Both'));
    expect(reads.splice(0)).toEqual(['key', 'on']);
    expect(actual('Off')).toEqual(reference('Both'));
    expect(reads.splice(0)).toEqual(['on']);
  });

  it('reads a guard and its dynamic key once each', async () => {
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ base: { padding: 8 }, danger: { color: 'red' }, primary: { color: 'blue' } });\nconst Button = styled.button({ color: 'black' });\nexport const counter = { guard: 0, key: 0 };\nconst flags = { get enabled() { counter.guard++; return counter.guard === 1; } };\nconst p = { get tone() { counter.key++; return 'primary'; } };\nexport const Pick = () => <Button sx={[styles.base, flags.enabled && styles[p.tone]]} />;`,
      ),
    );
    const reference = render(
      await run(
        `import * as css from '@plumeria/core';\nconst r = css.create({ both: { color: 'blue', padding: 8 } });\nexport const Both = () => <button sx={r.both} />;`,
      ),
    );

    expect(actual('Pick')).toEqual(reference('Both'));
    expect(actual.exports.counter).toEqual({ guard: 1, key: 1 });
  });

  it('reads a guarded dynamic key only when the guard holds', async () => {
    const actual = render(
      await run(
        `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ base: { padding: 8 }, primary: { color: 'blue' }, danger: { color: 'red' } });\nconst Button = styled.button({ color: 'black' });\nexport const counter = { reads: 0 };\nconst p = { get tone() { counter.reads++; return 'danger'; } };\nconst Lone = ({ enabled }: { enabled: boolean }) => <Button sx={enabled && styles[p.tone]} />;\nconst Mixed = ({ enabled, q }: { enabled: boolean; q?: typeof p }) => <Button sx={[styles.base, enabled && styles[q!.tone]]} />;\nexport const LoneOff = () => <Lone enabled={false} />;\nexport const LoneOn = () => <Lone enabled={true} />;\nexport const MixedOff = () => <Mixed enabled={false} />;\nexport const MixedOn = () => <Mixed enabled={true} q={p} />;`,
      ),
    );
    const reference = render(
      await run(
        `import * as css from '@plumeria/core';\nconst r = css.create({ black: { color: 'black' }, red: { color: 'red' }, base: { color: 'black', padding: 8 }, both: { color: 'red', padding: 8 } });\nexport const Black = () => <button sx={r.black} />;\nexport const Red = () => <button sx={r.red} />;\nexport const Base = () => <button sx={r.base} />;\nexport const Both = () => <button sx={r.both} />;`,
      ),
    );
    const { counter } = actual.exports;

    expect(actual('LoneOff')).toEqual(reference('Black'));
    expect(counter.reads).toBe(0);
    expect(actual('LoneOn')).toEqual(reference('Red'));
    expect(counter.reads).toBe(1);
    expect(actual('MixedOff')).toEqual(reference('Base'));
    expect(counter.reads).toBe(1);
    expect(actual('MixedOn')).toEqual(reference('Both'));
    expect(counter.reads).toBe(2);
  });

  describe('a received style that awaits', () => {
    const settle = async (
      actual: { exports: any },
      name: string,
      props: object = {},
    ) => {
      let node = await actual.exports[name](props);
      while (typeof node.type === 'function') node = node.type(node.props);
      return {
        tag: node.type,
        classes: String(node.props.className ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .sort(),
      };
    };
    const setup = async () =>
      render(
        await run(
          `import * as css from '@plumeria/core';\n${head}\nconst styles = css.create({ base: { padding: 8 }, danger: { color: 'red' }, width: (w: number) => ({ width: w }) });\nconst Button = styled.button({ color: 'black' });\nexport const reads: string[] = [];\nconst p = { get key() { reads.push('tone'); return 'danger'; } };\nconst flags = { get on() { reads.push('on'); return true; } };\nconst ready = () => { reads.push('ready'); return Promise.resolve(true); };\nconst readWidth = () => { reads.push('width'); return 10; };\nexport const Awaited = async () => <Button sx={[styles.base, (await ready()) && styles[p.key]]} />;\nexport const Late = async () => <Button sx={[styles[p.key], (await ready()) && styles.base]} />;\nexport const Early = async () => <Button sx={[(await ready()) && styles.base, styles[p.key], flags.on && styles.base]} />;\nexport const Nested = async ({ c }: { c: boolean }) => <Button sx={[styles[p.key], c ? (await ready()) && styles.base : null]} />;\nexport const Guarded = ({ c }: { c: boolean }) => <Button sx={[c ? styles.width(readWidth()) : null, flags.on && styles.base]} />;`,
        ),
      );
    const references = async () =>
      render(
        await run(
          `import * as css from '@plumeria/core';\nconst r = css.create({ red: { color: 'red' }, base: { color: 'black', padding: 8 }, both: { color: 'red', padding: 8 } });\nexport const Red = () => <button sx={r.red} />;\nexport const Base = () => <button sx={r.base} />;\nexport const Both = () => <button sx={r.both} />;`,
        ),
      );

    it.each([
      ['Awaited', ['ready', 'tone']],
      ['Late', ['tone', 'ready']],
      ['Early', ['ready', 'tone', 'on']],
    ])('reads %s in source order', async (name, order) => {
      const actual = await setup();
      const reference = await references();

      expect(await settle(actual, name)).toEqual(reference('Both'));
      expect(actual.exports.reads).toEqual(order);
    });

    it('reads an awaited guard only on its own branch', async () => {
      const actual = await setup();
      const reference = await references();
      const { reads } = actual.exports;

      expect(await settle(actual, 'Nested', { c: false })).toEqual(
        reference('Red'),
      );
      expect(reads.splice(0)).toEqual(['tone']);
      expect(await settle(actual, 'Nested', { c: true })).toEqual(
        reference('Both'),
      );
      expect(reads.splice(0)).toEqual(['tone', 'ready']);
    });

    it('reads a guarded dynamic argument only when the guard holds', async () => {
      const actual = await setup();
      const reference = await references();
      const { reads } = actual.exports;

      expect(await settle(actual, 'Guarded', { c: false })).toEqual(
        reference('Base'),
      );
      expect(reads.splice(0)).toEqual(['on']);
      await settle(actual, 'Guarded', { c: true });
      expect(reads.splice(0)).toEqual(['width', 'on']);
    });
  });

  it('extends a styled component through a barrel', async () => {
    write(
      'lib/button.tsx',
      `${head}\nexport const Button = styled.button({ color: (p: { c: string }) => p.c });`,
    );
    write('lib/index.ts', `export * from './button';`);
    const code = await run(
      `${head}\nimport { Button } from './lib/index';\nexport const Ghost = styled(Button)({ fontSize: 2 });`,
    );

    expect(code).toContain(`from './lib/button.tsx'`);
    expect(code).toContain('<button');
  });

  it('reads a .ts barrel that holds a type assertion', async () => {
    write(
      'cast/button.tsx',
      `${head}\nexport const Button = styled.button({ color: 'red' });`,
    );
    write(
      'cast/index.ts',
      `export const id = (x: unknown) => <string>x;\nexport { Button } from './button';`,
    );
    const code = await run(
      `${head}\nimport { Button } from './cast/index';\nexport const Ghost = styled(Button)({ fontSize: 2 });`,
    );

    expect(code).toContain(`from './cast/button.tsx'`);
  });

  it('collects a prop read from a default parameter of a shadowing function', async () => {
    const code = await run(
      `${head}\nexport const Box = styled.div({ color: (p: { color: string }) => ((x = p.color) => { const p = {}; return x; })() });`,
    );

    expect(code).toContain('color: __styled_prop0');
  });

  it('names the barrel that fails to parse', async () => {
    write(
      'broken/button.tsx',
      `${head}\nexport const Button = styled.button({});`,
    );
    const barrel = write(
      'broken/index.ts',
      `export const = 1;\nexport { Button } from './button';`,
    );
    const message = await failure(
      `${head}\nimport { Button } from './broken/index';\nexport const G = styled(Button)({});`,
    );

    expect(message).toContain(`Cannot read "${barrel}"`);
    expect(message).not.toContain('is not a styled component');
  });

  it('extends a default export directly and through a barrel', async () => {
    write(
      'def/button.tsx',
      `${head}\nconst Button = styled.button({ color: 'red' });\nexport default Button;`,
    );
    write('def/index.ts', `export { default as Button } from './button';`);
    const direct = await run(
      `${head}\nimport Button from './def/button';\nexport const Ghost = styled(Button)({ fontSize: 2 });`,
    );
    const barrel = await run(
      `${head}\nimport { Button } from './def/index';\nexport const Ghost = styled(Button)({ fontSize: 2 });`,
    );

    expect(direct).toContain('__styled_default__0');
    expect(barrel).toContain(`from './def/button.tsx'`);
    expect(barrel).toContain('__styled_default__0');
  });

  it('follows a barrel that default-exports an imported component', async () => {
    write(
      'redef/button.tsx',
      `${head}\nconst Button = styled.button({ color: 'red' });\nexport default Button;`,
    );
    write(
      'redef/index.ts',
      `import Button from './button';\nexport default Button;`,
    );
    const code = await run(
      `${head}\nimport Button from './redef/index';\nexport const Ghost = styled(Button)({ fontSize: 2 });`,
    );

    expect(code).toContain(`from './redef/button.tsx'`);
    expect(code).toContain('__styled_default__0');
  });

  it('extends through a string export name', async () => {
    write(
      'ui.tsx',
      `${head}\nconst Base = styled.button({ color: 'red' });\nexport { Base as "ui-button" };`,
    );
    const code = await run(
      `${head}\nimport { "ui-button" as Base } from './ui';\nexport const Ghost = styled(Base)({ fontSize: 2 });`,
    );

    expect(code).toContain('__styled_ui$2d$button__0');
  });

  it('ignores unrelated locals named styled', async () => {
    const code = await run(
      `${head}\nexport const Box = styled.div({ color: 'red' });\nexport function identity(styled: string) { return styled; }\ntype S = typeof styled;`,
    );

    expect(code).toContain('return styled;');
  });

  it('leaves files without @plumeria/react to the existing path', async () => {
    const source = `import * as css from '@plumeria/core';\nconst s = css.create({ a: { color: 'red' } });\nexport const A = () => <div sx={s.a} />;`;
    const code = await run(source);

    expect(code).not.toContain('__styled');
  });

  it.each([
    [
      'a branching dynamic value',
      `${head}\nexport const A = styled.a({ color: (p: { on: boolean }) => (p.on ? 'red' : 'blue') });`,
      'branches its value',
    ],
    [
      'a component chosen at runtime',
      `${head}\nconst B = styled.a({});\nconst C = styled.a({});\ndeclare const on: boolean;\nexport const A = styled(on ? B : C)({});`,
      'must name a styled component directly',
    ],
    [
      'a component not made with styled',
      `${head}\nconst Plain = () => null;\nexport const A = styled(Plain)({});`,
      'is not a styled component',
    ],
    [
      'a call below the top level',
      `${head}\nexport function f() { return styled.a({}); }`,
      'only be called at the top level',
    ],
    [
      'an anonymous default export',
      `${head}\nexport default styled.a({ color: 'red' });`,
      'A default export of styled needs a name',
    ],
  ])('rejects %s', async (_, source, message) => {
    expect(await failure(source)).toContain(message);
  });

  it('rejects an ambiguous export * pair', async () => {
    write('amb/a.tsx', `${head}\nexport const Button = styled.button({});`);
    write('amb/b.tsx', `${head}\nexport const Button = styled.button({});`);
    write('amb/index.ts', `export * from './a';\nexport * from './b';`);
    const message = await failure(
      `${head}\nimport { Button } from './amb/index';\nexport const G = styled(Button)({});`,
    );

    expect(message).toContain('more than one export *');
  });

  it('prefers an explicit export over export *', async () => {
    write('pick/plain.tsx', `export const Button = () => null;`);
    write(
      'pick/styled.tsx',
      `${head}\nexport const Button = styled.button({});`,
    );
    write(
      'pick/index.ts',
      `export { Button } from './plain';\nexport * from './styled';`,
    );
    const message = await failure(
      `${head}\nimport { Button } from './pick/index';\nexport const G = styled(Button)({});`,
    );

    expect(message).toContain('is not a styled component');
  });

  it('skips type-only re-exports when resolving', async () => {
    write(
      'types/button.tsx',
      `${head}\nexport const Button = styled.button({});`,
    );
    write('types/other.ts', `export type Button = {};`);
    write(
      'types/index.ts',
      `export type { Button } from './other';\nexport * from './button';`,
    );
    const code = await run(
      `${head}\nimport { Button } from './types/index';\nexport const G = styled(Button)({ color: 'red' });`,
    );

    expect(code).toContain(`from './types/button.tsx'`);
  });
});
