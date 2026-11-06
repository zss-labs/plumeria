import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_STYLE_PROP } from '@plumeria/utils';
import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ transformSource }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-marker-merge-')),
  );
  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));
  fs.writeFileSync(path.join(DIR, 'package.json'), '{ "name": "app" }');

  const classesOf = async (primary: string, prelude = '') => {
    const { code } = await transformSource({
      source: `import * as css from '@plumeria/core';\n${prelude}\nconst s = css.create({ p: ${primary} });\nexport const A = () => <a sx={s.p} />;`,
      moduleId: `${DIR}/fixture.tsx`,
      filePath: `${DIR}/fixture.tsx`,
      root: DIR,
      cwd: DIR,
      styleProp: DEFAULT_STYLE_PROP,
      propertyPolicy: undefined,
      isDev: false,
      addDependency: () => {},
    });
    const match = /className=\{"([^"]*)"\}/.exec(code);
    return new Set(match ? match[1].split(' ') : []);
  };

  // The marker class is the one a style holding only the marker produces.
  const markerClass = async () => {
    const [only] = await classesOf(`{ ...css.marker('p', ':hover') }`);
    return only;
  };

  it('keeps the marker when the same pseudo-class is written after it', async () => {
    const classes = await classesOf(
      `{ color: 'red', ...css.marker('p', ':hover'), ':hover': { opacity: 0.8 } }`,
    );
    expect(classes.has(await markerClass())).toBe(true);
    expect(classes.size).toBe(3);
  });

  it('handles a marker spread after pseudo-class styles', async () => {
    const classes = await classesOf(
      `{ color: 'red', ':hover': { opacity: 0.8 }, ...css.marker('p', ':hover') }`,
    );
    expect(classes.has(await markerClass())).toBe(true);
    expect(classes.size).toBe(3);
  });

  it('replaces a pseudo-class written twice without a marker', async () => {
    const classes = await classesOf(
      `{ ':hover': { color: 'red' }, ...base }`,
      `const base = { ':hover': { opacity: 0.8 } };`,
    );
    expect(classes.size).toBe(1);
  });

  it('replaces the whole pseudo-class object on spread', async () => {
    const classes = await classesOf(
      `{ ':hover': { color: 'red', opacity: 0.8 }, ...base }`,
      `const base = { ':hover': { color: 'blue' } };`,
    );
    expect(classes).toEqual(await classesOf(`{ ':hover': { color: 'blue' } }`));
  });
});
