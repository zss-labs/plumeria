// What a style prop compiles to for each kind of receiver. The receiving half
// already works: a component is given a lookup table keyed by the call sites
// that pass it a style, and a prop of its own name is handed the key. Only the
// call site written with the element's own name is not, and 19.1.7 broke three
// releases trying to change that. These assertions are the fence around the
// behaviour any second attempt has to keep.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_STYLE_PROP } from '@plumeria/utils';
import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ transformSource }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-')),
  );

  const STYLES = path.join(DIR, 'styles.ts');
  const RECEIVERS = path.join(DIR, 'Receivers.tsx');
  const APP = path.join(DIR, 'App.tsx');
  const UNSEEN = path.join(DIR, 'Unseen.tsx');
  const VIA_USE = path.join(DIR, 'ViaUse.tsx');
  const DEFAULT_FN = path.join(DIR, 'DefaultFn.tsx');
  const DEFAULT_ARROW = path.join(DIR, 'DefaultArrow.tsx');
  const WRAPPED = path.join(DIR, 'Wrapped.tsx');
  const COMPARED = path.join(DIR, 'Compared.tsx');
  const AMBIGUOUS = path.join(DIR, 'Ambiguous.tsx');
  const PLAIN = path.join(DIR, 'Plain.tsx');

  const sources: Record<string, string> = {
    [STYLES]: `import * as css from '@plumeria/core';
export const styles = css.create({
  base: { fontSize: '14px' },
  a: { color: 'teal' },
  b: { color: 'crimson' },
  box: (w: number) => ({ width: w }),
});`,
    [RECEIVERS]: `import * as css from '@plumeria/core';
import { styles } from './styles';
export const Alone = ({ classStyle }: { classStyle?: css.Style }) => (
  <div classStyle={classStyle} />
);
export const Merged = ({ classStyle }: { classStyle?: css.Style }) => (
  <div classStyle={[styles.base, classStyle]} />
);
export const Renamed = ({ styleArray }: { styleArray?: css.Style }) => (
  <div classStyle={[styles.base, styleArray]} />
);
`,
    [APP]: `import '@plumeria/core';
import { styles } from './styles';
import Link from 'next/link';
import { Alone, Merged, Renamed } from './Receivers';
import { UseAlone, UseWithBase, UseListed } from './ViaUse';
import DefaultFn from './DefaultFn';
import DefaultArrow from './DefaultArrow';
import WrappedDefault, { Memo, Forwarded } from './Wrapped';
import { MemoCompared, MemoInner, WithOptions } from './Compared';
import { PassesClassName } from './Plain';
import { Both } from './Ambiguous';
export const OnElement = () => <div classStyle={styles.a} />;
export const OnForwarder = () => <Link href="/x" classStyle={styles.a} />;
export const OnAlone = () => <Alone classStyle={styles.a} />;
export const OnMerged = () => <Merged classStyle={styles.a} />;
export const OnRenamed = () => <Renamed styleArray={styles.a} />;
export const OnUseAlone = () => <UseAlone classStyle={styles.a} />;
export const OnUseWithBase = () => <UseWithBase classStyle={styles.a} />;
export const OnUseListed = () => <UseListed classStyle={styles.a} />;
export const Conditional = ({ on }: { on: boolean }) => (
  <Merged classStyle={on && styles.a} />
);
export const Dynamic = ({ w }: { w: number }) => (
  <Merged classStyle={styles.box(w)} />
);
export const DynamicListed = ({ w }: { w: number }) => (
  <Merged classStyle={[styles.a, styles.box(w)]} />
);
export const DynamicOnElement = ({ w }: { w: number }) => (
  <div classStyle={styles.box(w)} />
);
export const OnDefaultFn = () => <DefaultFn classStyle={styles.a} />;
export const OnDefaultArrow = () => <DefaultArrow classStyle={styles.a} />;
export const OnMemo = () => <Memo classStyle={styles.a} />;
export const OnForwarded = () => <Forwarded classStyle={styles.a} />;
export const OnWrappedDefault = () => <WrappedDefault classStyle={styles.a} />;
export const OnMemoCompared = () => <MemoCompared classStyle={styles.a} />;
export const OnMemoInner = () => <MemoInner classStyle={styles.a} />;
export const OnWithOptions = () => <WithOptions classStyle={styles.a} />;
export const OnPassesClassName = () => <PassesClassName classStyle={styles.a} />;
export const OnBoth = () => <Both classStyle={styles.a} />;`,
    [VIA_USE]: `import * as css from '@plumeria/core';
import { styles } from './styles';
export const UseAlone = ({ classStyle }: { classStyle?: css.StaticStyles }) => (
  <span className={css.use(classStyle)} />
);
export const UseWithBase = ({
  classStyle,
}: {
  classStyle?: css.StaticStyles;
}) => <span className={css.use(styles.base, classStyle)} />;
export const UseListed = ({ classStyle }: { classStyle?: css.StaticStyles }) => (
  <span className={css.use([styles.base, classStyle])} />
);`,
    [DEFAULT_FN]: `import * as css from '@plumeria/core';
import { styles } from './styles';
export default function DefaultFn({ classStyle }: { classStyle?: css.Style }) {
  return <div classStyle={[styles.base, classStyle]} />;
}`,
    [DEFAULT_ARROW]: `import * as css from '@plumeria/core';
import { styles } from './styles';
export default ({ classStyle }: { classStyle?: css.Style }) => (
  <div classStyle={[styles.base, classStyle]} />
);`,
    [WRAPPED]: `import * as css from '@plumeria/core';
import { forwardRef, memo } from 'react';
import { styles } from './styles';
export const Memo = memo(({ classStyle }: { classStyle?: css.Style }) => (
  <div classStyle={[styles.base, classStyle]} />
));
export const Forwarded = forwardRef(
  ({ classStyle }: { classStyle?: css.Style }, ref: any) => (
    <div ref={ref} classStyle={[styles.base, classStyle]} />
  ),
);
export default memo(function Card({ classStyle }: { classStyle?: css.Style }) {
  return <div classStyle={[styles.base, classStyle]} />;
});`,
    [COMPARED]: `import * as css from '@plumeria/core';
import { memo } from 'react';
import { styles } from './styles';
const withOptions = (options: unknown, component: any) => component;
const options = { displayName: 'WithOptions' };
function Inner({ classStyle }: { classStyle?: css.Style }) {
  return <div classStyle={[styles.base, classStyle]} />;
}
export const MemoCompared = memo(
  ({ classStyle }: { classStyle?: css.Style }) => (
    <div classStyle={[styles.base, classStyle]} />
  ),
  ({ classStyle: a }: any, { classStyle: b }: any) => a === b,
);
export const MemoInner = memo(
  Inner,
  ({ classStyle: a }: any, { classStyle: b }: any) => a === b,
);
export const WithOptions = withOptions(
  options,
  ({ classStyle }: { classStyle?: css.Style }) => (
    <div classStyle={[styles.base, classStyle]} />
  ),
);
`,
    [PLAIN]: `import '@plumeria/core';
import { memo } from 'react';
function Plain({ className }: { className?: string }) {
  return <div className={className} />;
}
export const PassesClassName = memo(
  Plain,
  ({ classStyle: a }: any, { classStyle: b }: any) => a === b,
);`,
    [AMBIGUOUS]: `import * as css from '@plumeria/core';
const withFallback = (component: any, fallback: any) => component;
export const Both = withFallback(
  ({ classStyle }: { classStyle?: css.Style }) => <div classStyle={classStyle} />,
  (error: unknown) => <p>{String(error)}</p>,
);`,
    [UNSEEN]: `import '@plumeria/core';
import { styles } from './styles';
import { Alone } from './Receivers';
export const Unseen = () => <Alone classStyle={styles.b} />;`,
  };

  const compile = async (filePath: string) => {
    const result = await transformSource({
      source: sources[filePath],
      moduleId: filePath,
      filePath,
      root: DIR,
      cwd: DIR,
      styleProp: DEFAULT_STYLE_PROP,
      propertyPolicy: undefined,
      isDev: false,
      addDependency: () => {},
    });
    return result.code;
  };

  // A declaration can span lines, so it is read from its name to the next one.
  const declarationOf = (code: string, name: string) => {
    const start = code.indexOf(`const ${name} =`);
    const next = code.indexOf('\nexport const ', start + 1);
    return code.slice(start, next === -1 ? undefined : next);
  };

  beforeAll(() => {
    // Unseen.tsx is left off the disk, so the scan has no entry for the call
    // site it holds.
    for (const [filePath, source] of Object.entries(sources))
      if (filePath !== UNSEEN) fs.writeFileSync(filePath, source);
  });

  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

  describe('the receiving half', () => {
    it('gives a component a table keyed by the styles its callers pass', async () => {
      const code = await compile(RECEIVERS);

      // one entry per style reaching it, whatever the prop is called
      expect(declarationOf(code, 'Alone')).toMatch(
        /className=\{\(\{("\w+":"[\w ]+",?)+\}\[classStyle\] \|\| ""\)\}/,
      );
      expect(declarationOf(code, 'Renamed')).toMatch(/\[styleArray\] \|\| ""/);
    });

    it('keeps the component base outside the table it looks up', async () => {
      const code = await compile(RECEIVERS);
      expect(declarationOf(code, 'Merged')).toMatch(/"\w+" \+ " " \+ \(\{/);
    });

    it.each([
      ['DefaultFn', () => DEFAULT_FN, 'export default function'],
      ['DefaultArrow', () => DEFAULT_ARROW, 'export default ('],
      ['Memo', () => WRAPPED, 'export const Memo'],
      ['Forwarded', () => WRAPPED, 'export const Forwarded'],
      ['Card', () => WRAPPED, 'export default memo'],
    ])('gives %s the same table', async (_name, file, marker) => {
      const code = await compile(file());
      const start = code.indexOf(marker);
      const next = code.indexOf('\nexport ', start + 1);
      expect(code.slice(start, next === -1 ? undefined : next)).toMatch(
        /\[classStyle\] \|\| ""\)/,
      );
    });
  });

  describe('the call site', () => {
    it('resolves a style on an element where it stands', async () => {
      expect(declarationOf(await compile(APP), 'OnElement')).toContain(
        'className={"',
      );
    });

    // A component the scan never saw keeps the element's reading, which is what
    // one forwarding `className` to its own element needs.
    it('resolves a style on a component it does not know', async () => {
      expect(declarationOf(await compile(APP), 'OnForwarder')).toContain(
        'className={"',
      );
    });

    // Its own declaration says it applies the prop to the attribute an element
    // takes, so it is handed the key its table is built to look up.
    it('hands the key to a component that applies the prop', async () => {
      const code = await compile(APP);
      expect(declarationOf(code, 'OnAlone')).toMatch(/classStyle=\{"\w+"\}/);
      expect(declarationOf(code, 'OnMerged')).toMatch(/classStyle=\{"\w+"\}/);
    });

    // A default export and a component a call such as `memo` or `forwardRef`
    // wraps are given the same table, so they are handed the key as well, not
    // the element's reading their table never looks up.
    it.each([
      'OnDefaultFn',
      'OnDefaultArrow',
      'OnMemo',
      'OnForwarded',
      'OnWrappedDefault',
    ])('hands the key to the component %s renders', async (name) => {
      expect(declarationOf(await compile(APP), name)).toMatch(
        /classStyle=\{"\w+"\}/,
      );
    });

    // The component is the argument that renders, wherever it sits, and a
    // component name the call takes stands for that component. A comparator or
    // an options value is neither.
    it.each(['OnMemoCompared', 'OnMemoInner', 'OnWithOptions'])(
      'hands the key to the component %s renders through a call',
      async (name) => {
        expect(declarationOf(await compile(APP), name)).toMatch(
          /classStyle=\{"\w+"\}/,
        );
      },
    );

    it('builds a table where the wrapped component applies the prop', async () => {
      const code = await compile(COMPARED);
      expect(code.match(/\[classStyle\] \|\| ""\)/g)).toHaveLength(3);
    });

    // memo(Plain) is Plain, so a style passed to it is read as one passed to
    // Plain, which does not apply it.
    it('reads a style passed through memo(Plain) as one passed to Plain', async () => {
      expect(declarationOf(await compile(APP), 'OnPassesClassName')).toContain(
        'className={"',
      );
      await expect(compile(PLAIN)).rejects.toThrow(
        /"classStyle" is a style received through a prop but is never applied/,
      );
    });

    // Two arguments render, and nothing tells which one the style is for.
    it('stops the build when the component cannot be told', async () => {
      await expect(compile(AMBIGUOUS)).rejects.toThrow(
        /"Both" is made by a call with more than one argument that could be the component/,
      );
    });

    // The same mechanism, reached by a name the element does not take.
    it('hands a component the key when the prop has a name of its own', async () => {
      expect(declarationOf(await compile(APP), 'OnRenamed')).toMatch(
        /styleArray=\{"\w+"\}/,
      );
    });

    it('keeps a conditional a conditional', async () => {
      expect(declarationOf(await compile(APP), 'Conditional')).toMatch(
        /classStyle=\{on && "\w+"\}/,
      );
    });

    // `css.use()` is the other place a received style may be applied, and the
    // call site cannot see which of the two a component chose, nor which shape of
    // the call it used. All of them are the same receiver.
    it.each(['UseAlone', 'UseWithBase', 'UseListed'])(
      'hands the key to %s, which applies it through css.use()',
      async (name) => {
        expect(declarationOf(await compile(APP), `On${name}`)).toMatch(
          /classStyle=\{"\w+"\}/,
        );
        expect(declarationOf(await compile(VIA_USE), name)).toMatch(
          /\[classStyle\] \|\| ""/,
        );
      },
    );

    // Only the base differs between the shapes: the lookup is the same, and the
    // one with no base has nothing concatenated in front of it.
    it('concatenates a base only where the call has one', async () => {
      const code = await compile(VIA_USE);

      expect(declarationOf(code, 'UseAlone')).not.toMatch(
        /"\w+" \+ " " \+ \(\{/,
      );
      expect(declarationOf(code, 'UseWithBase')).toMatch(
        /"\w+" \+ " " \+ \(\{/,
      );
      expect(declarationOf(code, 'UseListed')).toMatch(/"\w+" \+ " " \+ \(\{/);
    });

    // A dynamic style resolves to a class name and the custom properties the
    // element carries, so the key travels with them and the receiver spreads them
    // onto the element it renders.
    it('carries the variables of a dynamic style with the key', async () => {
      const code = await compile(APP);

      expect(declarationOf(code, 'Dynamic')).toMatch(
        /classStyle=\{\{ key: "\w+", vars: \{ "--[\w-]+": /,
      );
      expect(declarationOf(code, 'DynamicListed')).toMatch(
        /classStyle=\{\{ key: "\w+", vars: \{/,
      );

      const receivers = await compile(RECEIVERS);
      expect(declarationOf(receivers, 'Merged')).toContain(
        '[((classStyle && classStyle.key) || classStyle)]',
      );
      expect(declarationOf(receivers, 'Merged')).toContain(
        'style={{ ...(classStyle && classStyle.vars) }}',
      );
    });

    it('resolves a dynamic style on an element where it stands', async () => {
      const code = declarationOf(await compile(APP), 'DynamicOnElement');
      expect(code).toContain('className={"');
      expect(code).toMatch(/style=\{\{ "--[\w-]+": /);
    });

    // Without an entry there is no key to hand over. Reading the attribute as the
    // element's leaves the call site where it was, rather than emitting one that
    // nothing resolves.
    it('falls back to the element reading for a call site it has no entry for', async () => {
      const result = await transformSource({
        source: sources[UNSEEN],
        moduleId: UNSEEN,
        filePath: UNSEEN,
        root: DIR,
        cwd: DIR,
        styleProp: DEFAULT_STYLE_PROP,
        propertyPolicy: undefined,
        isDev: false,
        addDependency: () => {},
      });
      expect(declarationOf(result.code, 'Unseen')).toContain('className={"');
    });
  });
});
