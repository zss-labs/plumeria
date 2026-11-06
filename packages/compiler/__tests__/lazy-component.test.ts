// A component loaded through React's lazy is the export its import() names, so
// a style passed to it reaches that component's table rather than being
// resolved to a className the component never reads. Only a lazy imported
// from react is read this way, and the module it loads is a dependency of the
// file that loads it.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_STYLE_PROP } from '@plumeria/utils';
import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ transformSource }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-')),
  );
  const file = (name: string) => path.join(DIR, name);

  const receiver = (name: string, exported: string) =>
    `import * as css from '@plumeria/core';
const styles = css.create({ base: { fontSize: '14px' } });
${exported} ${name}({ sx }: { sx?: css.Style }) {
  return <div sx={[styles.base, sx]} />;
}`;

  const app = (imports: string, loader: string) =>
    `import * as css from '@plumeria/core';
${imports}
const Card = ${loader};
const styles = css.create({ big: { fontSize: '24px' } });
export const App = () => <Card sx={styles.big} />;`;

  const sources: Record<string, string> = {
    'Card.tsx': receiver('Card', 'export default function'),
    'Panel.tsx': receiver('Panel', 'export function'),
    'Swap.tsx': receiver('Swap', 'export default function'),
    'Moved.tsx': receiver('Moved', 'export default function'),
    'Direct.tsx': app(
      `import { lazy } from 'react';`,
      `lazy(() => import('./Card'))`,
    ),
    'Picked.tsx': app(
      `import { lazy } from 'react';`,
      `lazy(() => import('./Panel').then((m) => ({ default: m.Panel })))`,
    ),
    'Block.tsx': app(
      `import { lazy } from 'react';`,
      `lazy(() => {
  return import('./Panel').then(function (m) {
    return { default: m.Panel };
  });
})`,
    ),
    'Namespace.tsx': app(
      `import * as React from 'react';`,
      `React.lazy(() => import('./Card'))`,
    ),
    'Renamed.tsx': app(
      `import { lazy as load } from 'react';`,
      `load(() => import('./Card'))`,
    ),
    'Wrapped.tsx': app(
      `import { lazy, memo } from 'react';`,
      `memo(lazy(() => import('./Card')))`,
    ),
    'Foreign.tsx': app(
      `import { lazy } from './loader';`,
      `lazy(() => import('./Card'))`,
    ),
    'Untyped.tsx': app(
      `const defer = (load: any) => load;`,
      `defer(() => import('./Card'))`,
    ),
    'Swapping.tsx': app(
      `import { lazy } from 'react';`,
      `lazy(() => import('./Swap'))`,
    ),
    'Later.tsx': app(
      `import { lazy } from 'react';`,
      `lazy(() => import('./Appears'))`,
    ),
    'loader.ts': `export const lazy = (load: any) => load;`,
  };

  const compile = async (name: string) => {
    const filePath = file(name);
    return (
      await transformSource({
        source: fs.readFileSync(filePath, 'utf8'),
        moduleId: filePath,
        filePath,
        root: DIR,
        cwd: DIR,
        styleProp: DEFAULT_STYLE_PROP,
        propertyPolicy: undefined,
        isDev: false,
        addDependency: () => {},
      })
    ).code;
  };

  const rewrite = (name: string, source: string) => {
    const previous = fs.existsSync(file(name))
      ? fs.statSync(file(name)).mtimeMs
      : 0;
    fs.writeFileSync(file(name), source);
    const later = new Date(Math.max(Date.now(), previous) + 1_000);
    fs.utimesSync(file(name), later, later);
  };

  // The key the call site hands over, or undefined when it resolved the
  // style to a className instead.
  const keyOf = async (name: string) =>
    (await compile(name)).match(/<Card sx=\{"(\w+)"\}/)?.[1];

  beforeAll(() => {
    for (const [name, source] of Object.entries(sources))
      fs.writeFileSync(file(name), source);
  });

  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

  it.each([
    ['a default export', 'Direct.tsx', 'Card.tsx'],
    ['a named export picked in then()', 'Picked.tsx', 'Panel.tsx'],
    ['a loader and a pick written as blocks', 'Block.tsx', 'Panel.tsx'],
    ['React.lazy on a namespace import', 'Namespace.tsx', 'Card.tsx'],
    ['lazy imported under another name', 'Renamed.tsx', 'Card.tsx'],
    ['lazy wrapped in memo', 'Wrapped.tsx', 'Card.tsx'],
  ])('hands the key to %s', async (_label, caller, receiver) => {
    const key = await keyOf(caller);
    expect(key).toBeDefined();
    expect(await compile(receiver)).toContain(`"${key}":`);
  });

  it.each([
    ['a lazy that is not from react', 'Foreign.tsx'],
    ['a call that is not lazy', 'Untyped.tsx'],
  ])('reads %s as a component it cannot see', async (_label, caller) => {
    expect(await keyOf(caller)).toBeUndefined();
    expect(await compile(caller)).toMatch(/<Card className=\{"\w+"\}/);
  });

  it('follows the loaded module when it starts re-exporting another', async () => {
    const key = await keyOf('Swapping.tsx');
    expect(key).toBeDefined();
    expect(await compile('Swap.tsx')).toContain(`"${key}":`);

    // Swapping.tsx is unchanged, so only the dependency on Swap.tsx brings
    // its call site to the component Swap.tsx now names.
    rewrite('Swap.tsx', `export { default } from './Moved';`);
    expect(await compile('Moved.tsx')).toContain(`"${key}":`);

    rewrite('Swap.tsx', sources['Swap.tsx']);
    expect(await compile('Swap.tsx')).toContain(`"${key}":`);
    expect(await compile('Moved.tsx')).not.toContain(`"${key}":`);
  });

  it('picks up the loaded module once it is written', async () => {
    expect(await keyOf('Later.tsx')).toBeUndefined();

    rewrite('Appears.tsx', receiver('Appears', 'export default function'));
    const key = await keyOf('Later.tsx');
    expect(key).toBeDefined();
    expect(await compile('Appears.tsx')).toContain(`"${key}":`);
  });
});
