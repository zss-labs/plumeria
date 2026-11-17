import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { implementations } from '../compiler-implementations';

const LONE = /contains a lone surrogate, which CSS cannot represent/;

const moduleWith = (styles: string) => `import * as css from '@plumeria/core';
const styles = css.create(${styles});
export const Box = () => <div sx={styles.box} />;
`;

describe.each(implementations)('$name', ({ compileCSS, transformSource }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-lone-surrogate-')),
  );
  const FILE = path.join(DIR, 'box.tsx');
  const compile = (styles: string) => {
    fs.writeFileSync(FILE, moduleWith(styles));
    return compileCSS({ include: [], exclude: [], cwd: DIR, files: [FILE] });
  };

  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

  it.each([
    ['a string value', `{ box: { content: '"\\uD800"' } }`],
    ['a template value', '{ box: { content: `"\\uD800"` } }'],
    ['a string key', `{ '\\uD800x': { color: 'red' }, box: { color: 'red' } }`],
    [
      'a string after an escaped backslash',
      `{ box: { content: '"\\\\\\uD800"' } }`,
    ],
    [
      'a computed string key',
      `{ ['\\uD800x']: { color: 'red' }, box: { color: 'red' } }`,
    ],
  ])('rejects a lone surrogate in %s', (_name, styles) => {
    expect(() => compile(styles)).toThrow(LONE);
  });

  it.each([
    ['a string', `'"\\uD800"'`],
    ['a template', '`"\\uD800"`'],
  ])(
    'stops on a lone surrogate in %s read through a const',
    async (_, init) => {
      const source = `import * as css from '@plumeria/core';
const content = ${init};
const styles = css.create({ box: { content } });
export const Box = () => <div sx={styles.box} />;
`;
      fs.writeFileSync(FILE, source);

      await expect(
        transformSource({
          source,
          moduleId: FILE,
          filePath: FILE,
          root: DIR,
          styleProp: 'sx',
          isDev: false,
          cwd: DIR,
        }),
      ).rejects.toThrow(/\[plumeria\]/);
    },
  );

  it('keeps an escaped backslash written before the letter u', () => {
    expect(() => compile(`{ box: { content: '"\\\\uD800"' } }`)).not.toThrow();
  });

  it('keeps a complete surrogate pair', () => {
    expect(compile(`{ box: { content: '"\\uD83D\\uDE00"' } }`)).toContain(
      'content: "😀"',
    );
  });
});
