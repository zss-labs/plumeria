import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ transformSource }) => {
  const DIR = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-import-elision-')),
  );
  let count = 0;

  const SHARED = {
    'collection.ts': `import * as css from '@plumeria/core';
export const collection = css.create({ card: { padding: 16 } });
`,
    'tokens.ts': `import * as css from '@plumeria/core';
export const tokens = css.createStatic({ navy: 'navy' });
export const label = 'hi';
export const unused = 'unused';
`,
    'Card.tsx': `export const Card = () => null;
`,
  };

  const transform = async (app: string) => {
    const cwd = path.join(DIR, String(count++));
    const files: Record<string, string> = { ...SHARED, 'app.tsx': app };
    for (const [name, source] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
      fs.writeFileSync(path.join(cwd, name), source);
    }
    const filePath = path.join(cwd, 'app.tsx');
    const { code } = await transformSource({
      source: app,
      moduleId: filePath,
      filePath,
      root: cwd,
      cwd,
      isDev: false,
    });
    return code;
  };

  it('removes an import whose bindings were only used by styles', async () => {
    const code = await transform(`import * as css from '@plumeria/core';
import { collection } from './collection';
import { tokens } from './tokens';
const styles = css.create({ main: { color: tokens.navy } });
export const App = () => <div classStyle={[styles.main, collection.card]} />;
`);
    expect(code).not.toContain("from './collection'");
    expect(code).not.toContain("from './tokens'");
  });

  it('keeps an import whose binding is still read at runtime', async () => {
    const code = await transform(`import * as css from '@plumeria/core';
import { tokens, label } from './tokens';
const styles = css.create({ main: { color: tokens.navy } });
export const App = () => <p classStyle={styles.main}>{label}</p>;
`);
    expect(code).toContain("import { tokens, label } from './tokens';");
  });

  it('keeps side-effect imports and imports the source never used', async () => {
    const code = await transform(`import * as css from '@plumeria/core';
import './global.css';
import { unused } from './tokens';
import { collection } from './collection';
export const App = () => <div classStyle={collection.card} />;
`);
    expect(code).toContain("import './global.css';");
    expect(code).toContain("import { unused } from './tokens';");
    expect(code).not.toContain("from './collection'");
  });

  it('keeps an import still rendered as a component', async () => {
    const code = await transform(`import * as css from '@plumeria/core';
import { Card } from './Card';
import { tokens } from './tokens';
const styles = css.create({ main: { color: tokens.navy } });
export const App = () => <Card classStyle={styles.main} />;
`);
    expect(code).toContain("import { Card } from './Card';");
    expect(code).not.toContain("from './tokens'");
  });

  it('keeps an import that is re-exported', async () => {
    const code = await transform(`import * as css from '@plumeria/core';
import { tokens } from './tokens';
const styles = css.create({ main: { color: tokens.navy } });
export const App = () => <div classStyle={styles.main} />;
export { tokens };
`);
    expect(code).toContain("import { tokens } from './tokens';");
  });

  it('removes an import whose name is only shadowed by a runtime local', async () => {
    const code = await transform(`import * as css from '@plumeria/core';
import { tokens } from './tokens';
const styles = css.create({ main: { color: tokens.navy } });
export const App = ({ tokens }: { tokens: string }) => (
  <p classStyle={styles.main}>{tokens}</p>
);
`);
    expect(code).not.toContain("from './tokens'");
  });

  it('keeps type-only imports untouched', async () => {
    const code = await transform(`import * as css from '@plumeria/core';
import type { Properties } from 'csstype';
import { tokens } from './tokens';
const styles = css.create({ main: { color: tokens.navy } });
export const box: Properties = {};
export const App = () => <div classStyle={styles.main} />;
`);
    expect(code).toContain("import type { Properties } from 'csstype';");
    expect(code).not.toContain("from './tokens'");
  });

  it('removes an import that shares its name with an intrinsic tag', async () => {
    const code = await transform(`import * as css from '@plumeria/core';
import { tokens as div } from './tokens';
const styles = css.create({ main: { color: div.navy } });
export const App = () => <div classStyle={styles.main} />;
`);
    expect(code).not.toContain("from './tokens'");
  });
});
