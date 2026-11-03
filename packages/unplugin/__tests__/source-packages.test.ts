// A dependency that exports Plumeria source through the `plumeria` condition
// is resolved to that source and compiled like an app file, while the rest of
// node_modules stays untouched.
jest.mock('@plumeria/eslint-plugin/guard', () => ({
  lintOverrides: jest.requireActual('@plumeria/eslint-plugin/guard')
    .lintOverrides,
  startLintGuard: jest.fn(),
}));
jest.mock('@plumeria/compiler', () => ({
  DEFAULT_STYLE_PROP: 'classStyle',
  needsCompile: jest.requireActual('@plumeria/compiler').needsCompile,
  sourcePackages: jest.requireActual('@plumeria/compiler').sourcePackages,
  optimizer: jest.fn((css: string) => css),
  resolvePropertyPolicy: jest.fn(() => ({ policy: true })),
  transformSource: jest.fn(() => ({ code: 'transformed' })),
  compileCSS: jest.fn(() => ''),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unpluginFactory } from '../src/core';
import { attachWebpackHooks } from '../src/webpack';

const { transformSource: mockTransformSource } = jest.requireMock<{
  transformSource: jest.Mock;
}>('@plumeria/compiler');

const ROOT = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-unplugin-package-')),
);
const PKG = path.join(ROOT, 'node_modules', 'ui-kit');
const SOURCE = `import '@plumeria/core';`;

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

beforeAll(() => {
  write(
    path.join(ROOT, 'package.json'),
    JSON.stringify({ dependencies: { 'ui-kit': '1.0.0', plain: '1.0.0' } }),
  );
  write(
    path.join(PKG, 'package.json'),
    JSON.stringify({
      name: 'ui-kit',
      exports: {
        '.': { plumeria: './src/index.ts', default: './dist/index.js' },
        './*': { plumeria: './src/*.tsx', default: './dist/*.js' },
      },
    }),
  );
  write(
    path.join(ROOT, 'node_modules', 'plain', 'package.json'),
    JSON.stringify({ name: 'plain', exports: './index.js' }),
  );
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));
beforeEach(() => jest.clearAllMocks());

const createPlugin = () => {
  const plugin = unpluginFactory({ lint: false }, {
    framework: 'vite',
  } as never) as any;
  plugin.__plumeriaInternal.setRoot(ROOT);
  return plugin;
};

it('resolves the package and its wildcard subpaths to source', () => {
  const plugin = createPlugin();

  expect(plugin.resolveId('ui-kit')).toBe(path.join(PKG, 'src', 'index.ts'));
  expect(plugin.resolveId('ui-kit/Button')).toBe(
    path.join(PKG, 'src', 'Button.tsx'),
  );
  expect(plugin.resolveId('plain')).toBeNull();
  expect(plugin.resolveId('ui-kitx')).toBeNull();
  expect(plugin.__plumeriaInternal.resolveSource('ui-kit')).toBe(
    path.join(PKG, 'src', 'index.ts'),
  );
});

it('compiles files under the exported source directory only', async () => {
  const plugin = createPlugin();
  const button = path.join(PKG, 'src', 'Button.tsx');

  await expect(
    plugin.transform.handler.call({}, SOURCE, button),
  ).resolves.not.toBeNull();
  expect(mockTransformSource).toHaveBeenCalledWith(
    expect.objectContaining({ filePath: button, cwd: ROOT }),
  );

  await expect(
    plugin.transform.handler.call({}, SOURCE, path.join(PKG, 'dist', 'a.js')),
  ).resolves.toBeNull();
  await expect(
    plugin.transform.handler.call(
      {},
      SOURCE,
      path.join(ROOT, 'node_modules', 'plain', 'index.js'),
    ),
  ).resolves.toBeNull();
  expect(mockTransformSource).toHaveBeenCalledTimes(1);
  expect(plugin.__plumeriaInternal.inSource(button)).toBe(true);
});

it('rereads the packages when the root changes', () => {
  const plugin = createPlugin();
  expect(plugin.resolveId('ui-kit')).not.toBeNull();

  plugin.__plumeriaInternal.setRoot(path.join(ROOT, 'node_modules'));
  expect(plugin.resolveId('ui-kit')).toBeNull();
});

it('lets the webpack adapter include and resolve package source', () => {
  const plugin = createPlugin();
  attachWebpackHooks(plugin);

  expect(plugin.transformInclude(path.join(PKG, 'src', 'Button.tsx'))).toBe(
    true,
  );
  expect(plugin.transformInclude(path.join(PKG, 'dist', 'a.js'))).toBe(false);
  expect(plugin.resolveId('ui-kit/Button')).toBe(
    path.join(PKG, 'src', 'Button.tsx'),
  );
});
