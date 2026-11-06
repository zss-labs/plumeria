// A dependency exporting Plumeria source is transpiled by Next.js, resolved to
// that source by both Turbopack and webpack, and passed through the loader.
jest.mock('../src/lint', () => ({ startNextLintGuard: jest.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WebpackConfigContext } from 'next/dist/server/config-shared';
import { withPlumeria } from '../src/index';

const ROOT = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-next-package-')),
);
const PKG = path.join(ROOT, 'node_modules', 'ui-kit');
const LEGACY = path.join(ROOT, 'node_modules', 'legacy-kit');

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

beforeAll(() => {
  write(
    path.join(ROOT, 'package.json'),
    JSON.stringify({
      dependencies: { 'ui-kit': '1.0.0', 'legacy-kit': '1.0.0' },
    }),
  );
  write(
    path.join(PKG, 'package.json'),
    JSON.stringify({
      name: 'ui-kit',
      exports: {
        '.': { plumeria: './src/index.ts', default: './dist/index.js' },
        './*': { plumeria: './src/*.tsx', default: './dist/*.js' },
        './plain': { default: './dist/plain.js' },
      },
    }),
  );
  write(
    path.join(LEGACY, 'package.json'),
    JSON.stringify({
      name: 'legacy-kit',
      exports: { plumeria: './src/index.ts', default: './dist/index.js' },
    }),
  );
  jest.spyOn(process, 'cwd').mockReturnValue(ROOT);
});

afterAll(() => {
  jest.restoreAllMocks();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

it('transpiles the package and aliases its exports for Turbopack', () => {
  const config = withPlumeria(
    {
      transpilePackages: ['other'],
      turbopack: { resolveAlias: { 'ui-kit': './custom.ts' } },
    },
    { lint: false },
  );

  expect(config.transpilePackages).toEqual(['other', 'legacy-kit', 'ui-kit']);
  expect(config.turbopack?.resolveAlias).toEqual({
    'ui-kit': './custom.ts',
    'ui-kit/*': './node_modules/ui-kit/src/*.tsx',
    'legacy-kit': './node_modules/legacy-kit/src/index.ts',
  });
});

it('replaces package requests and loads package source under webpack', () => {
  const replacements: Array<[RegExp, (resource: { request: string }) => void]> =
    [];
  class NormalModuleReplacementPlugin {
    constructor(
      pattern: RegExp,
      replace: (resource: { request: string }) => void,
    ) {
      replacements.push([pattern, replace]);
    }
  }
  const config = withPlumeria({}, { lint: false }).webpack!(
    { module: { rules: [] } },
    {
      webpack: { NormalModuleReplacementPlugin },
    } as never as WebpackConfigContext,
  );

  const [[pattern, replace]] = replacements;
  expect(pattern.test('ui-kit/Button')).toBe(true);
  expect(pattern.test('ui-kitx')).toBe(false);
  const resource = { request: 'ui-kit/Button' };
  replace(resource);
  expect(resource.request).toBe(path.join(PKG, 'src', 'Button.tsx'));
  const unknown = { request: 'ui-kit' };
  replace(unknown);
  expect(unknown.request).toBe(path.join(PKG, 'src', 'index.ts'));
  const unresolved = { request: 'legacy-kit/missing' };
  replace(unresolved);
  expect(unresolved.request).toBe('legacy-kit/missing');

  const loaderRule = config.module.rules.find(
    (rule: { exclude?: unknown }) => typeof rule.exclude === 'function',
  );
  expect(loaderRule.exclude(path.join(PKG, 'src', 'Button.tsx'))).toBe(false);
  expect(loaderRule.exclude(path.join(PKG, 'dist', 'index.js'))).toBe(true);
  expect(loaderRule.exclude(path.join(ROOT, 'node_modules', 'x', 'a.ts'))).toBe(
    true,
  );
  expect(loaderRule.exclude(path.join(ROOT, '.next', 'a.ts'))).toBe(true);
  expect(loaderRule.exclude(path.join(ROOT, 'app', 'page.tsx'))).toBe(false);
});
