import { spawnSync } from 'child_process';
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

  const STYLES = `
const s = css.create({
  p1: { color: 'green' },
  p3: { color: 'teal' },
});
`;

  const run = async (body: string, head = '') => {
    const source = `${head}import * as css from '@plumeria/core';\n${STYLES}\n${body}\n`;
    const result = await transformSource(env(source, `${DIR}/fixture.tsx`));
    return typeof result === 'string' ? result : (result?.code ?? '');
  };

  const declarations = (code: string) =>
    [
      ...code.matchAll(
        /var (__plumeria_lookup\d+); function \1_init\(\) \{ return \(\1 = (\{[^\n]*\})\); \}/g,
      ),
    ].map((match) => ({ name: match[1], table: match[2], index: match.index }));

  const read = (name: string) => `(${name} ?? ${name}_init())[k]`;

  const COMPONENT = `export const A = ({ k }: { k: 'p1' | 'p3' }) => <div sx={s[k]} />;`;

  describe('transform: hoisted lookup tables', () => {
    it('declares a table of literal class names once and reads it by key', async () => {
      const out = await run(COMPONENT);
      const [decl, ...rest] = declarations(out);
      expect(rest).toHaveLength(0);
      expect(decl.table).toContain('"p1":"x3git8yv"');
      expect(decl.table).toContain('"p3":"xxcejlqg"');
      expect(out).toContain(read(decl.name));
      expect(out).not.toMatch(/\}\[k\]/);
    });

    it('reads the table from a function an import cycle calls before the module evaluates', async () => {
      const source = `import * as css from '@plumeria/core';\nimport './b.mjs';\n${STYLES}\nexport function A(k) { return css.use(s[k]); }\n`;
      const result = await transformSource(env(source, `${DIR}/a.tsx`));
      const code = typeof result === 'string' ? result : (result?.code ?? '');
      expect(declarations(code)).toHaveLength(1);
      fs.writeFileSync(`${DIR}/a.mjs`, code);
      fs.writeFileSync(
        `${DIR}/b.mjs`,
        `import { A } from './a.mjs';\nconsole.log(A('p1'));\n`,
      );
      const child = spawnSync(process.execPath, [`${DIR}/a.mjs`], {
        encoding: 'utf8',
      });
      expect(child.stderr).toBe('');
      expect(child.stdout.trim()).toBe('x3git8yv');
    });

    it('places the declarations before any statement that can render', async () => {
      const out = await run(
        `${COMPONENT}\nexport const eager = A({ k: 'p1' });`,
        `'use client';\nimport { useState } from 'react';\n`,
      );
      const [decl] = declarations(out);
      expect(out.startsWith(`'use client';`)).toBe(true);
      expect(decl.index).toBeGreaterThan(out.indexOf(`from 'react'`));
      expect(decl.index).toBeLessThan(out.indexOf('export const A'));
    });

    it('shares one declaration between call sites with the same table', async () => {
      const out = await run(
        `${COMPONENT}\nexport const B = ({ k }: { k: 'p1' | 'p3' }) => <span sx={s[k]} />;`,
      );
      const [decl, ...rest] = declarations(out);
      expect(rest).toHaveLength(0);
      expect(out.split(read(decl.name))).toHaveLength(3);
    });

    it('skips a name the module already declares at the top level', async () => {
      const out = await run(
        `const __plumeria_lookup0 = 'mine';\nexport const mine = __plumeria_lookup0;\n${COMPONENT}`,
      );
      const [decl] = declarations(out);
      expect(decl.name).not.toBe('__plumeria_lookup0');
      expect(out.match(/__plumeria_lookup0\b(?!_init)/g)).toHaveLength(2);
      expect(out).toContain(read(decl.name));
    });

    it('skips a name whose initializer the module already declares', async () => {
      const out = await run(
        `export function __plumeria_lookup0_init() {}\n${COMPONENT}`,
      );
      const [decl] = declarations(out);
      expect(decl.name).not.toBe('__plumeria_lookup0');
      expect(out.match(/function __plumeria_lookup0_init\b/g)).toHaveLength(1);
      expect(out).toContain(read(decl.name));
    });

    it('skips a lookup name written with a Unicode escape', async () => {
      const out = await run(
        String.raw`export const __plumeria_look\u0075p0 = 'mine';` +
          '\n' +
          COMPONENT,
      );
      const [decl] = declarations(out);
      expect(decl.name).not.toBe('__plumeria_lookup0');
      expect(out).toContain(read(decl.name));
    });

    it('skips a name a parameter shadows at the call site', async () => {
      const out = await run(
        `export const A = ({ k, __plumeria_lookup0 }: { k: 'p1' | 'p3'; __plumeria_lookup0: unknown }) => <div sx={s[k]} />;`,
      );
      const [decl] = declarations(out);
      expect(decl.name).not.toBe('__plumeria_lookup0');
      expect(out).not.toContain('(__plumeria_lookup0 ??');
      expect(out).toContain(read(decl.name));
    });
  });
});
