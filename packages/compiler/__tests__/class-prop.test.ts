import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_STYLE_PROP } from '@plumeria/utils';
import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ transformSource }) => {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-class-prop-')),
  );

  const prefix = `import * as css from '@plumeria/core';`;
  const styles = `const styles = css.create({ a: { color: 'red' }, dyn: (x: number = 0) => ({ width: x }) });`;

  const run = async (body: string, classProp?: string) => {
    const filePath = path.join(directory, `${Math.random()}.tsx`);
    const source = `${prefix}\n${styles}\n${body}\n`;
    fs.writeFileSync(filePath, source);
    const { code } = await transformSource({
      source,
      moduleId: filePath,
      filePath,
      root: directory,
      cwd: directory,
      styleProp: DEFAULT_STYLE_PROP,
      classProp,
      propertyPolicy: undefined,
      isDev: false,
      addDependency: () => {},
    });
    return code;
  };

  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('writes className when no class prop is configured', async () => {
    const code = await run(`export const A = () => <div sx={styles.a} />;`);

    expect(code).toContain('className="');
    expect(code).not.toContain('<div class=');
  });

  it('writes the configured attribute instead of className', async () => {
    const code = await run(
      `export const A = () => <div sx={styles.a} />;`,
      'class',
    );

    expect(code).toContain('class="');
    expect(code).not.toContain('className=');
  });

  it('keeps the style attribute for a dynamic function key', async () => {
    const code = await run(
      `export const A = () => <div sx={[styles.a, styles.dyn(1)]} />;`,
      'class',
    );

    expect(code).toContain('class="');
    expect(code).toContain('style={{');
    expect(code).not.toContain('className=');
  });

  it('leaves an existing attribute written under the configured name in place', async () => {
    const code = await run(
      `export const A = () => <div class="kept" sx={styles.a} />;`,
      'class',
    );

    expect(code).toMatch(/class="kept" \{\.\.\.\{ "class": "x\w+" \}\}/);
    expect(code).not.toContain('className');
  });

  it('writes a hyphenated name as a computed key when both attributes are spread', async () => {
    const code = await run(
      `const on = () => true;\nexport class K { el = <div sx={[styles.a, on() && styles.dyn(1)]} />; }`,
      'data-class',
    );

    expect(code).toContain('{...');
    expect(code).toContain('({ "data-class": ');
    expect(code).not.toContain('data-class:');
  });

  it('writes a colliding attribute with a hyphenated name as a string key', async () => {
    const code = await run(
      `export const A = () => <div data-class="kept" sx={styles.a} />;`,
      'data-class',
    );

    expect(code).toMatch(
      /data-class="kept" \{\.\.\.\{ "data-class": "x\w+" \}\}/,
    );
  });
});
