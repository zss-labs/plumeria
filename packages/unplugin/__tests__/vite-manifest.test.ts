// The CSS bundle plugin finds the single sheet by the original file name Vite
// records for it. Only a real Vite build shows that name is there and that the
// manifest picks the link up, so this builds a one-file app.
//
// Vite ships only ESM, which Jest cannot load, so the build runs in a child
// Node process against the built adapter in dist, as CI builds before Jest.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

const PACKAGE = path.resolve(__dirname, '..');
const ADAPTER = path.join(PACKAGE, 'dist', 'vite.mjs');
const DIR = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-vite-manifest-')),
);

const BUILD = `
import { build } from 'vite';
import plumeria from ${JSON.stringify(pathToFileURL(ADAPTER).href)};
const root = process.env.FIXTURE_ROOT;
const result = await build({
  root,
  configFile: false,
  logLevel: 'silent',
  plugins: [plumeria({ lint: false })],
  build: {
    write: false,
    manifest: true,
    rolldownOptions: {
      input: root + '/main.tsx',
      external: [/^react/, /^@plumeria\\/core/],
    },
  },
});
const { output } = Array.isArray(result) ? result[0] : result;
const assets = Object.fromEntries(
  output
    .filter((file) => file.type === 'asset')
    .map((file) => [file.fileName, String(file.source)]),
);
process.stdout.write(JSON.stringify(assets));
`;

beforeAll(() => {
  fs.writeFileSync(
    path.join(DIR, 'main.tsx'),
    `
import * as css from '@plumeria/core';
const styles = css.create({ box: { color: 'teal' } });
export const Card = () => <div sx={styles.box} />;
`,
  );
});

afterAll(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

it('lists the emitted CSS bundle under the entry in the Vite manifest', () => {
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', BUILD],
    {
      cwd: PACKAGE,
      encoding: 'utf8',
      env: { ...process.env, FIXTURE_ROOT: DIR },
    },
  );
  expect(child.stderr).toBe('');
  const assets: Record<string, string> = JSON.parse(child.stdout);
  const manifest = JSON.parse(assets['.vite/manifest.json']);

  const { css } = manifest['main.tsx'];
  expect(css).toHaveLength(1);
  expect(assets[css[0]]).toContain('teal');
});
