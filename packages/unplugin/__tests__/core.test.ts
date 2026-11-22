jest.mock('@plumeria/eslint-plugin/guard', () => ({
  lintOverrides: jest.requireActual('@plumeria/eslint-plugin/guard')
    .lintOverrides,
  startLintGuard: jest.fn(),
}));
let mockCompiledSource = '';
jest.mock('@plumeria/compiler', () => ({
  DEFAULT_STYLE_PROP: 'sx',
  needsCompile: jest.requireActual('@plumeria/compiler').needsCompile,
  sourcePackages: jest.requireActual('@plumeria/compiler').sourcePackages,
  optimizer: jest.fn((css: string) => css),
  scanAll: jest.fn(),
  resolvePropertyPolicy: jest.fn(() => ({ policy: true })),
  transformSource: jest.fn(
    ({
      source,
      addDependency,
    }: {
      source: string;
      addDependency: (path: string) => void;
    }) => {
      mockCompiledSource = source;
      addDependency('/dependency.ts');
      return { code: 'transformed' };
    },
  ),
  compileCSS: jest.fn(() =>
    mockCompiledSource.includes('EMPTY')
      ? ''
      : mockCompiledSource.includes('SECOND')
        ? '.second {}'
        : '.generated {}',
  ),
  globFiles: jest.fn(() => []),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unpluginFactory } from '../src/core';

const { globFiles: mockGlobFiles } = jest.requireMock<{
  globFiles: jest.Mock;
}>('@plumeria/compiler');

const { transformSource: mockTransformSource } = jest.requireMock<{
  transformSource: jest.Mock;
}>('@plumeria/compiler');
const { optimizer: mockOptimizer, resolvePropertyPolicy: mockPolicy } =
  jest.requireMock<{
    optimizer: jest.Mock;
    resolvePropertyPolicy: jest.Mock;
  }>('@plumeria/compiler');

const SOURCE = `import '@plumeria/core';`;
const createPlugin = (options?: Parameters<typeof unpluginFactory>[0]) =>
  unpluginFactory(options, { framework: 'rollup' } as never) as any;

beforeEach(() => jest.clearAllMocks());

it('exposes metadata and applies plugin options', () => {
  const plugin = createPlugin({
    include: '**/*.tsx',
    styleProp: 'css',
    withoutPhysicalProperties: true,
  });

  expect(plugin).toMatchObject({ name: '@plumeria/unplugin', enforce: 'pre' });
  expect(plugin.__plumeriaInternal.unpluginMeta).toEqual({
    framework: 'rollup',
  });
  expect(plugin.transformInclude('/project/Card.tsx')).toBe(true);
  expect(plugin.transformInclude('/project/Card.ts')).toBe(false);
  expect(mockPolicy).toHaveBeenCalledWith(
    expect.objectContaining({ withoutPhysicalProperties: true }),
  );
});

it('resolves and identifies virtual CSS ids', () => {
  const plugin = createPlugin();

  expect(plugin.resolveId('/project/Card.zero.css?direct')).toBe(
    '/project/Card.zero.css?direct',
  );
  expect(plugin.resolveId('./Card.zero.css?direct', '/project/source.ts')).toBe(
    '/project/Card.zero.css?direct',
  );
  expect(plugin.resolveId('./Card.zero.css', '/project/source.ts')).toBe(
    '/project/Card.zero.css',
  );
  expect(plugin.resolveId('/project/source.ts')).toBeNull();
  expect(plugin.loadInclude('/project/Card.zero.css?direct')).toBe(true);
  expect(plugin.loadInclude('/project/Card.tsx')).toBe(false);
});

it('keeps unresolved relative virtual CSS ids intact', () => {
  const plugin = createPlugin();

  expect(plugin.resolveId('Card.zero.css')).toBe('Card.zero.css');
  expect(plugin.resolveId('Card.zero.css?direct')).toBe('Card.zero.css?direct');
});

it('skips dependencies, unrelated sources, and excluded files', async () => {
  const plugin = createPlugin({ exclude: '**/excluded.ts' });

  await expect(
    plugin.transform.handler(SOURCE, '/project/node_modules/pkg/index.ts'),
  ).resolves.toBeNull();
  await expect(
    plugin.transform.handler('export {};', '/project/source.ts'),
  ).resolves.toBeNull();
  await expect(
    plugin.transform.handler(SOURCE, '/project/excluded.ts?raw'),
  ).resolves.toBeNull();

  expect(mockTransformSource).not.toHaveBeenCalled();
});

it('updates and removes an existing target without a watch callback', async () => {
  const plugin = createPlugin();
  const id = '/project/source.ts';

  await plugin.transform.handler.call({}, SOURCE, id);
  await plugin.transform.handler.call({}, SOURCE, id);
  expect(plugin.__plumeriaInternal.targets).toEqual([
    {
      id,
      dependencies: [
        '/dependency.ts',
        '/project/node_modules/.cache/plumeria/hash-stamp',
      ],
    },
  ]);

  await plugin.transform.handler.call({}, `${SOURCE} EMPTY`, id);
  expect(plugin.__plumeriaInternal.targets).toEqual([]);
});

it('stores and loads generated CSS through virtual and filesystem ids', async () => {
  const plugin = createPlugin({ styleProp: 'css' });
  const addWatchFile = jest.fn();
  const id = '/project/source.tsx?raw';

  plugin.__plumeriaInternal.setRoot('/project');
  const result = await plugin.transform.handler.call(
    { addWatchFile },
    SOURCE,
    id,
  );

  expect(result).toEqual({
    code: 'transformed\nimport "/source.zero.css";',
    map: null,
  });
  expect(addWatchFile).toHaveBeenCalledWith('/dependency.ts');
  expect(mockTransformSource).toHaveBeenCalledWith(
    expect.objectContaining({
      moduleId: id,
      filePath: '/project/source.tsx',
      root: '/project',
      styleProp: 'css',
      propertyPolicy: { policy: true },
      isDev: false,
    }),
  );
  expect(plugin.load('/source.zero.css?direct')).toBe('.generated {}');
  expect(plugin.load('/project/source.zero.css')).toBe('.generated {}');
  expect(plugin.load('/missing.zero.css')).toBe('');
});

it('compiles the stylesheet of the transformed file alone', async () => {
  const { compileCSS: mockCompileCSS } = jest.requireMock<{
    compileCSS: jest.Mock;
  }>('@plumeria/compiler');
  const plugin = createPlugin({
    styleProp: 'css',
    withoutLogicalProperties: true,
  });
  plugin.__plumeriaInternal.setRoot('/project');

  await plugin.transform.handler(SOURCE, '/project/app/[slug]/page.tsx');
  await plugin.transform.handler(SOURCE, '/outside/Card.tsx');

  expect(mockCompileCSS).toHaveBeenNthCalledWith(1, {
    include: [],
    exclude: [],
    files: ['/project/app/[slug]/page.tsx'],
    cwd: '/project',
    styleProp: 'css',
    withoutLogicalProperties: true,
    withoutPhysicalProperties: undefined,
    sources: { '/project/app/[slug]/page.tsx': SOURCE },
  });
  expect(mockCompileCSS).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      files: ['/outside/Card.tsx'],
      cwd: '/outside',
    }),
  );
});

it('scopes the transform scan to the root rather than the process cwd', async () => {
  const plugin = createPlugin();
  plugin.__plumeriaInternal.setRoot('/project');

  await plugin.transform.handler(SOURCE, '/project/Card.tsx');
  await plugin.transform.handler(SOURCE, '/outside/Card.tsx');

  expect(mockTransformSource).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ root: '/project', cwd: '/project' }),
  );
  expect(mockTransformSource).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ root: '/project', cwd: '/outside' }),
  );
});

it('uses a custom CSS import formatter and permits omitting the import', async () => {
  const plugin = createPlugin();
  const formatter = jest.fn(() => null);
  plugin.__plumeriaInternal.setRoot('/project');
  plugin.__plumeriaInternal.setCssImport(formatter);

  await expect(
    plugin.transform.handler(SOURCE, '/project/Card.ts'),
  ).resolves.toEqual({
    code: 'transformed',
    map: null,
  });
  expect(formatter).toHaveBeenCalledWith({
    id: '/project/Card.ts',
    cssId: '/Card.zero.css',
    cssFilename: '/project/Card.zero.css',
    css: '.generated {}',
  });

  plugin.__plumeriaInternal.setCssImport(null);
  await expect(
    plugin.transform.handler(SOURCE, '/project/Card.ts'),
  ).resolves.toEqual(
    expect.objectContaining({ code: 'transformed\nimport "/Card.zero.css";' }),
  );
});

it('stops a module the shared stylesheet cannot read', async () => {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-sheet-scope-')),
  );
  const root = path.join(dir, 'app');
  const kit = path.join(root, 'node_modules', 'ui-kit');
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(kit, 'src', 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ dependencies: { 'ui-kit': '1.0.0' } }),
  );
  fs.writeFileSync(
    path.join(kit, 'package.json'),
    JSON.stringify({
      name: 'ui-kit',
      exports: { '.': { plumeria: './src/index.ts', default: './index.js' } },
    }),
  );
  for (const file of [
    'Card.ts',
    'dist/Card.ts',
    '../Shared.ts',
    'node_modules/ui-kit/src/Card.ts',
    'node_modules/ui-kit/src/dist/Card.ts',
  ]) {
    fs.writeFileSync(path.join(root, file), SOURCE);
  }
  const plugin = createPlugin();
  plugin.__plumeriaInternal.setRoot(root);
  plugin.__plumeriaInternal.setCssImport(
    () => '\nimport "/__plumeria_sheet__.zero.css";',
  );

  for (const file of ['Card.ts', 'node_modules/ui-kit/src/Card.ts']) {
    await expect(
      plugin.transform.handler(SOURCE, path.join(root, file)),
    ).resolves.toEqual(expect.objectContaining({ map: null }));
  }
  for (const file of [
    '../Shared.ts',
    'dist/Card.ts',
    'node_modules/ui-kit/src/dist/Card.ts',
  ]) {
    await expect(
      plugin.transform.handler(SOURCE, path.join(root, file)),
    ).rejects.toThrow(/is outside the project files the shared stylesheet/);
  }
  await expect(
    plugin.transform.handler(SOURCE, path.join(root, 'Virtual.ts')),
  ).rejects.toThrow(/has no file on disk/);

  plugin.__plumeriaInternal.setCssImport(null);
  await expect(
    plugin.transform.handler(SOURCE, path.join(root, '../Shared.ts')),
  ).resolves.toEqual(expect.objectContaining({ map: null }));
  fs.rmSync(dir, { recursive: true, force: true });
});

it('falls back to empty CSS for a formatter and handles an empty first pass', async () => {
  const plugin = createPlugin();
  const formatter = jest.fn(() => '');
  plugin.__plumeriaInternal.setCssImport(formatter);
  mockOptimizer.mockReturnValueOnce(undefined);

  await plugin.transform.handler(SOURCE, '/project/Card.ts');
  expect(formatter).toHaveBeenCalledWith(expect.objectContaining({ css: '' }));

  const emptyPlugin = createPlugin();
  await expect(
    emptyPlugin.transform.handler(`${SOURCE} EMPTY`, '/project/Empty.ts'),
  ).resolves.toEqual({ code: 'transformed', map: null });
  expect(emptyPlugin.__plumeriaInternal.targets).toEqual([]);
});

it('accumulates development CSS and keeps re-added sheets latest', async () => {
  const plugin = createPlugin();
  plugin.__plumeriaInternal.setRoot('/project');
  plugin.__plumeriaInternal.setDev(true);

  await plugin.transform.handler(SOURCE, '/project/Card.ts');
  await plugin.transform.handler(`${SOURCE} SECOND`, '/project/Card.ts');
  await plugin.transform.handler(SOURCE, '/project/Card.ts');

  expect(plugin.load('/Card.zero.css')).toBe('.second {}.generated {}');
  expect(
    plugin.__plumeriaInternal.devCssSheets.get('/project/Card.zero.css'),
  ).toEqual(new Set(['.second {}', '.generated {}']));
  expect(mockOptimizer).toHaveBeenLastCalledWith('.second {}.generated {}');
  expect(mockOptimizer).toHaveBeenCalledTimes(3);
});

it('filters the project files through include and exclude patterns of either kind', () => {
  const { compileCSS: mockCompileCSS } = jest.requireMock<{
    compileCSS: jest.Mock;
  }>('@plumeria/compiler');
  mockGlobFiles.mockReturnValueOnce([
    '/project/a.tsx',
    '/project/skip/b.tsx',
    '/project/legacy/c.tsx',
    '/project/d.js',
  ]);
  const plugin = createPlugin({
    styleProp: 'css',
    include: /\.tsx?$/,
    exclude: ['**/skip/**', /legacy/],
  });
  plugin.__plumeriaInternal.setRoot('/project');
  mockCompileCSS.mockReturnValueOnce('.project {}');

  expect(plugin.__plumeriaInternal.projectCss()).toBe('.project {}');
  expect(mockGlobFiles).toHaveBeenCalledWith(
    ['**/*.{js,jsx,ts,tsx}'],
    ['**/node_modules/**', '**/dist/**'],
    '/project',
  );
  expect(mockCompileCSS).toHaveBeenCalledWith({
    include: [],
    exclude: [],
    files: ['/project/a.tsx'],
    cwd: '/project',
    styleProp: 'css',
    withoutLogicalProperties: undefined,
    withoutPhysicalProperties: undefined,
  });
  expect(mockOptimizer).toHaveBeenLastCalledWith('.project {}');
});

it('compiles the project sheet from the listed files as they are on disk', async () => {
  const { compileCSS: mockCompileCSS } = jest.requireMock<{
    compileCSS: jest.Mock;
  }>('@plumeria/compiler');
  const plugin = createPlugin();
  plugin.__plumeriaInternal.setRoot('/project');
  await plugin.transform.handler(`${SOURCE} SECOND`, '/project/Card.tsx');
  await plugin.transform.handler(SOURCE, '/project/virtual.tsx?inline');
  mockGlobFiles.mockReturnValueOnce([
    '/project/Card.tsx',
    '/project/Other.tsx',
  ]);

  plugin.__plumeriaInternal.projectCss();

  const [options] = mockCompileCSS.mock.calls.at(-1)!;
  expect(options.files).toEqual(['/project/Card.tsx', '/project/Other.tsx']);
  expect(options).not.toHaveProperty('sources');
});

describe('the lint guard', () => {
  const { startLintGuard } = jest.requireMock<{ startLintGuard: jest.Mock }>(
    '@plumeria/eslint-plugin/guard',
  );
  const create = (lint?: boolean) =>
    unpluginFactory(lint === undefined ? {} : { lint }, {} as never) as any;
  const run = () => ({
    context: '/project',
    hooks: {
      run: { tap: (_name: string, fn: () => void) => fn() },
      beforeRun: { tap: jest.fn() },
      watchRun: { tap: jest.fn() },
    },
  });

  beforeEach(() => startLintGuard.mockClear());

  it('starts on a webpack or rspack run', () => {
    create().webpack(run());
    create().rspack(run());
    expect(startLintGuard).toHaveBeenCalledTimes(2);
  });

  it('rescans before webpack runs and watch runs', () => {
    const { scanAll } = jest.requireMock<{ scanAll: jest.Mock }>(
      '@plumeria/compiler',
    );
    const bundler = run();
    scanAll.mockClear();
    create().webpack(bundler);

    bundler.hooks.beforeRun.tap.mock.calls[0][1]();
    bundler.hooks.watchRun.tap.mock.calls[0][1]();

    expect(scanAll).toHaveBeenCalledTimes(2);
    expect(scanAll).toHaveBeenCalledWith('/project', 'sx');
  });

  it('starts on a rollup or rolldown build outside watch mode', () => {
    const plugin = create();
    plugin.rollup.buildStart.call({ meta: { watchMode: true } });
    plugin.rolldown.buildStart.call({ meta: { watchMode: true } });
    expect(startLintGuard).not.toHaveBeenCalled();
    plugin.rollup.buildStart.call({ meta: { watchMode: false } });
    plugin.rolldown.buildStart.call({ meta: { watchMode: false } });
    expect(startLintGuard).toHaveBeenCalledTimes(2);
  });

  it('starts on a vite build and a farm production build', () => {
    const plugin = create();
    plugin.vite.config({}, { command: 'serve' });
    plugin.farm.config({ compilation: { mode: 'development' } });
    expect(startLintGuard).not.toHaveBeenCalled();
    plugin.vite.config({}, { command: 'build' });
    plugin.farm.config({ compilation: { mode: 'production' } });
    expect(startLintGuard).toHaveBeenCalledTimes(2);
  });

  it('lints with the spelling rule the options turn on', () => {
    const plugin = unpluginFactory(
      { withoutLogicalProperties: true },
      {} as never,
    ) as any;
    plugin.vite.config({}, { command: 'build' });
    expect(startLintGuard).toHaveBeenCalledWith({
      rules: { '@plumeria/no-logical-properties': 'error' },
    });
  });

  it('lints with the styling prop the options name', () => {
    const plugin = unpluginFactory(
      { styleProp: 'classStyle' },
      {} as never,
    ) as any;
    plugin.vite.config({}, { command: 'build' });
    expect(startLintGuard).toHaveBeenCalledWith({
      settings: { plumeria: { styleProp: 'classStyle' } },
    });
  });

  it('does not start with lint: false', () => {
    const plugin = create(false);
    plugin.webpack(run());
    plugin.rollup.buildStart.call({ meta: { watchMode: false } });
    plugin.vite.config({}, { command: 'build' });
    plugin.farm.config({ compilation: { mode: 'production' } });
    expect(startLintGuard).not.toHaveBeenCalled();
  });
});
