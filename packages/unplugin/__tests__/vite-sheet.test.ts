// The shared sheet is served when it loads, so the CSS that Vite hashes and
// runs through its CSS pipeline is the CSS that ships. Only a real build shows
// both, so this builds a one-file app twice in a child Node process against
// the built adapter in dist, as vite-manifest.test.ts does.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

const PACKAGE = path.resolve(__dirname, '..');
const ADAPTER = path.join(PACKAGE, 'dist', 'vite.mjs');
const DIR = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-vite-sheet-')),
);

const BUILD = `
import { build } from 'vite';
import plumeria from ${JSON.stringify(pathToFileURL(ADAPTER).href)};
const root = process.env.FIXTURE_ROOT;
const processed = {
  postcssPlugin: 'mark-processed',
  Declaration: { color: (decl) => { if (!decl.value.endsWith('/*processed*/')) decl.value += ' /*processed*/'; } },
};
const result = await build({
  root,
  configFile: false,
  logLevel: 'silent',
  plugins: [plumeria({ lint: false })],
  css: { postcss: { plugins: [processed] } },
  build: {
    write: false,
    minify: false,
    cssMinify: false,
    rolldownOptions: {
      input: root + '/main.tsx',
      external: [/^react/, /^@plumeria\\/core/],
    },
  },
});
const { output } = Array.isArray(result) ? result[0] : result;
const css = output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css'));
process.stdout.write(JSON.stringify(css.map((file) => [file.fileName, String(file.source)])));
`;

const buildWith = (color: string): [string, string][] => {
  fs.writeFileSync(
    path.join(DIR, 'main.tsx'),
    `
import * as css from '@plumeria/core';
const styles = css.create({ box: { color: '${color}' } });
export const Card = () => <div sx={styles.box} />;
`,
  );
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
  return JSON.parse(child.stdout);
};

afterAll(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

it('hashes and processes the shared sheet with the CSS it ships', () => {
  const teal = buildWith('teal');
  const navy = buildWith('navy');

  expect(teal).toHaveLength(1);
  expect(navy).toHaveLength(1);
  const [[tealName, tealCss]] = teal;
  const [[navyName, navyCss]] = navy;
  expect(tealCss).toMatch(/teal \/\*processed\*\//);
  expect(navyCss).toMatch(/navy \/\*processed\*\//);
  expect(tealName).not.toBe(navyName);
});
