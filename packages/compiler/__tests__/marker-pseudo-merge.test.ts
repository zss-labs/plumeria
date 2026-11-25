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

  const classesOf = async (
    primary: string,
    prelude = '',
    expression = 's.p',
  ) => {
    const { code } = await transformSource({
      source: `import * as css from '@plumeria/core';\n${prelude}\nconst s = css.create({ p: ${primary} });\nexport const A = () => <a sx={${expression}} />;`,
      moduleId: `${DIR}/fixture.tsx`,
      filePath: `${DIR}/fixture.tsx`,
      root: DIR,
      cwd: DIR,
      styleProp: DEFAULT_STYLE_PROP,
      propertyPolicy: undefined,
      isDev: false,
      addDependency: () => {},
    });
    const match = /className="([^"]*)"/.exec(code);
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

  it.each(['nav_item', 'nav-item'])(
    'keeps marker %s through a pseudo-class merge',
    async (id) => {
      const marker = `...css.marker('${id}', ':hover')`;
      const only = await classesOf(`{ ${marker} }`);
      expect(only.size).toBe(1);
      expect(
        await classesOf(`{ ${marker}, ':hover': { opacity: 0.8 } }`),
      ).toEqual(
        new Set([
          ...only,
          ...(await classesOf("{ ':hover': { opacity: 0.8 } }")),
        ]),
      );
    },
  );

  it.each([
    "{ ...css.marker('nav.item', ':hover') }",
    "{ [css.extended('項目', ':hover')]: { opacity: 0.8 } }",
  ])(
    'rejects a marker id outside letters, digits, - and _ in %s',
    async (style) => {
      await expect(classesOf(style)).rejects.toThrow(
        /can only contain letters, digits, "-" and "_"/,
      );
    },
  );

  it('resolves renamed marker and extended imports', async () => {
    const actual = await classesOf(
      "{ ...mark('nav_item', ':hover'), [when('nav_item', ':hover')]: { opacity: 0.8 } }",
      "import { marker as mark, extended as when } from '@plumeria/core';",
    );
    expect(actual).toEqual(
      await classesOf(
        "{ ...css.marker('nav_item', ':hover'), [css.extended('nav_item', ':hover')]: { opacity: 0.8 } }",
      ),
    );
  });

  const renamed = "import { marker as mark } from '@plumeria/core';";
  it.each([
    [
      'a renamed import with a static argument',
      renamed,
      "(mark) => ({ ...mark('nav', ':hover') })",
      's.p(1)',
    ],
    [
      'a renamed import with a runtime argument',
      renamed,
      "(mark) => ({ ...mark('nav', ':hover') })",
      's.p(globalThis.mark)',
    ],
    [
      'a renamed import through destructuring',
      renamed,
      "({ mark }) => ({ ...mark('nav', ':hover') })",
      's.p({ mark: globalThis.mark })',
    ],
    [
      'the namespace',
      '',
      "(css) => ({ ...css.marker('nav', ':hover') })",
      's.p(globalThis.css)',
    ],
  ])(
    'rejects a parameter shadowing %s',
    async (_, prelude, style, expression) => {
      await expect(classesOf(style, prelude, expression)).rejects.toThrow(
        /Cannot spread/,
      );
    },
  );

  it('keeps the import when destructuring renames the parameter', async () => {
    const [marker] = await classesOf("{ ...mark('nav', ':hover') }", renamed);
    const classes = await classesOf(
      "({ mark: localMark }) => ({ ...mark('nav', ':hover') })",
      renamed,
      's.p({ mark: globalThis.mark })',
    );
    expect(classes.has(marker)).toBe(true);
  });

  it.each([
    "{ ...helpers.marker('nav', ':hover') }",
    "{ [helpers.extended('nav', ':hover')]: { opacity: 0.8 } }",
  ])('rejects a foreign helper in %s', async (style) => {
    await expect(
      classesOf(style, "import * as helpers from 'other-library';"),
    ).rejects.toThrow();
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
