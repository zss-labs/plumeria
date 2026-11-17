import webpack, { attachWebpackHooks } from '../src/webpack';

const ABSOLUTE_CSS = '/project/Card.zero.css';
const VIRTUAL_CSS = '/Card.zero.css';

const createBase = () => ({
  name: 'base',
  __plumeriaInternal: {
    cssFileLookup: new Map([[VIRTUAL_CSS, ABSOLUTE_CSS]]),
    cssLookup: new Map([[ABSOLUTE_CSS, '.card {}']]),
    targets: [{ id: '/project/Card.tsx', dependencies: [] }],
    setDev: jest.fn(),
    setRoot: jest.fn(),
    setCssImport: jest.fn(),
    resolveSource: jest.fn(() => null),
    inSource: jest.fn(() => false),
  },
  transform: {
    order: 'pre',
    handler: jest.fn(async (code: string) => {
      if (code === 'null') return null;
      if (code === 'plain') return { code: 'plain' };
      return { code: `import "${VIRTUAL_CSS}";` };
    }),
  },
});

const compilerWith = (rules: unknown, mode = 'development') => ({
  isChild: () => false,
  context: '/project',
  hooks: { thisCompilation: { tap: jest.fn() } },
  options: { mode, module: { rules } },
});

it('imports the stylesheet by a relative path with a cache-busting query', async () => {
  const base = createBase();
  const plugin = attachWebpackHooks(base) as any;

  const [cssImport] = base.__plumeriaInternal.setCssImport.mock.calls[0];

  expect(
    cssImport({
      id: '/project/Card.tsx',
      cssId: VIRTUAL_CSS,
      cssFilename: ABSOLUTE_CSS,
      css: '.card {}',
    }),
  ).toMatch(/^\nimport "\.\/Card\.zero\.css\?t=\d+";$/);

  expect(
    cssImport({
      id: '/project/src/Card.tsx',
      cssId: VIRTUAL_CSS,
      cssFilename: ABSOLUTE_CSS,
      css: '.card {}',
    }),
  ).toMatch(/^\nimport "\.\.\/Card\.zero\.css\?t=\d+";$/);

  expect(plugin.transform.order).toBe('pre');
  await expect(
    plugin.transform.handler('null', '/project/Card.tsx'),
  ).resolves.toBeNull();
  await expect(
    plugin.transform.handler('plain', '/project/Card.tsx'),
  ).resolves.toEqual({ code: 'plain' });
});

it('keeps the extracted CSS in the build info the module is cached with', async () => {
  const base = createBase();
  const plugin = attachWebpackHooks(base) as any;
  const buildInfo: Record<string, unknown> = {};
  const context = (info?: Record<string, unknown>) => ({
    getNativeBuildContext: () => ({
      loaderContext: { _module: info && { buildInfo: info } },
    }),
  });

  await plugin.transform.handler.call(
    context(buildInfo),
    'css',
    '/project/Card.tsx?x',
  );
  expect(buildInfo.plumeriaCss).toBe('.card {}');

  const other: Record<string, unknown> = {};
  await plugin.transform.handler.call(
    context(other),
    'css',
    '/project/Other.tsx',
  );
  await plugin.transform.handler.call(context(), 'css', '/project/Card.tsx');
  await plugin.transform.handler.call({}, 'css', '/project/Card.tsx');
  expect(other).toEqual({});
});

it('covers unresolved ids and queried absolute ids', () => {
  const plugin = attachWebpackHooks(createBase()) as any;

  expect(plugin.resolveId(`${ABSOLUTE_CSS}?direct`)).toBe(
    `${ABSOLUTE_CSS}?direct`,
  );
  expect(plugin.resolveId('Card.zero.css')).toBeNull();
  expect(plugin.resolveId('/project/source.ts')).toBeNull();
});

it('loads CSS with and without a matching source target', () => {
  const plugin = attachWebpackHooks(createBase()) as any;

  expect(plugin.load.call({}, ABSOLUTE_CSS)).toEqual({
    code: '.card {}',
    moduleType: 'css',
  });
  plugin.__plumeriaInternal.targets.length = 0;
  expect(plugin.load.call({ addDependency: jest.fn() }, ABSOLUTE_CSS)).toEqual({
    code: '.card {}',
    moduleType: 'css',
  });
});

it('configures root without enabling development for production compilers', () => {
  const base = createBase();
  const plugin = attachWebpackHooks(base) as any;

  plugin.webpack(compilerWith(undefined, 'production'));

  expect(base.__plumeriaInternal.setRoot).toHaveBeenCalledWith('/project');
  expect(base.__plumeriaInternal.setDev).not.toHaveBeenCalled();
});

it('points a production build at one stylesheet rebuilt after every module', () => {
  const SHEET = '/project/__plumeria_sheet__.zero.css';
  const base = createBase();
  base.__plumeriaInternal.cssLookup.set(ABSOLUTE_CSS, '.card { color: red }');
  const plugin = attachWebpackHooks(base) as any;
  const compiler = compilerWith([], 'production');
  plugin.webpack(compiler);

  const [cssImport] = base.__plumeriaInternal.setCssImport.mock.calls[0];
  expect(
    cssImport({
      id: '/project/src/Card.tsx',
      cssId: VIRTUAL_CSS,
      cssFilename: ABSOLUTE_CSS,
      css: '',
    }),
  ).toBe(`\nimport "${SHEET}?sheet";`);
  expect(plugin.resolveId(`${SHEET}?sheet`)).toBe(`${SHEET}?sheet`);
  expect(plugin.resolveId(SHEET)).toBe(SHEET);
  expect(plugin.load.call({}, encodeURIComponent(`${SHEET}?sheet`))).toEqual({
    code: expect.stringContaining('.card'),
    moduleType: 'css',
  });
});

it('restores cached module CSS and rebuilds every module reading the sheet', async () => {
  const SHEET = '/project/__plumeria_sheet__.zero.css';
  const base = createBase();
  const plugin = attachWebpackHooks(base) as any;
  const compiler = compilerWith([], 'production');
  const writeModule = jest.fn(async () => {});
  plugin.webpack.call({ __vfs: { writeModule } }, compiler);

  const [, onCompilation] = compiler.hooks.thisCompilation.tap.mock.calls[0];
  let finishModules: any;
  const rebuildModule = jest.fn((_module: unknown, done: any) => done(null));
  onCompilation({
    hooks: {
      finishModules: {
        tapAsync: (_name: string, fn: unknown) => (finishModules = fn),
      },
    },
    rebuildModule,
  });
  const finish = (modules: unknown[]) =>
    new Promise((resolve) => finishModules(modules, resolve));

  const { cssLookup } = base.__plumeriaInternal;
  cssLookup.clear();
  cssLookup.set('/project/Kept.zero.css', '.kept {}');
  await expect(
    finish([
      {},
      { buildInfo: { plumeriaCss: '.orphan {}' } },
      { resource: '/project/Plain.tsx', buildInfo: {} },
      {
        resource: '/project/Card.tsx?raw',
        buildInfo: { plumeriaCss: '.cached {}' },
      },
      {
        resource: '/project/Kept.tsx',
        buildInfo: { plumeriaCss: '.stale {}' },
      },
    ]),
  ).resolves.toBeUndefined();
  expect([...cssLookup]).toEqual([
    ['/project/Kept.zero.css', '.kept {}'],
    ['/project/Card.zero.css', '.cached {}'],
  ]);
  expect(rebuildModule).not.toHaveBeenCalled();

  const outer = {
    resource: `/project/_virtual_${encodeURIComponent(SHEET)}`,
  };
  const inner = { resource: outer.resource };
  await expect(finish([outer, inner])).resolves.toBeUndefined();
  expect(rebuildModule.mock.calls.map(([module]) => module)).toEqual([
    outer,
    inner,
  ]);
  expect(writeModule).toHaveBeenCalledWith(outer.resource, '');

  const failure = new Error('rebuild failed');
  rebuildModule.mockImplementationOnce((_module, done) => done(failure));
  await expect(finish([outer])).resolves.toBe(failure);
});

it('rebuilds the sheet without a virtual file system', async () => {
  const base = createBase();
  const plugin = attachWebpackHooks(base) as any;
  const compiler = compilerWith([], 'production');
  plugin.webpack(compiler);

  const [, onCompilation] = compiler.hooks.thisCompilation.tap.mock.calls[0];
  let finishModules: any;
  const rebuildModule = jest.fn((_module: unknown, done: any) => done(null));
  onCompilation({
    hooks: {
      finishModules: {
        tapAsync: (_name: string, fn: unknown) => (finishModules = fn),
      },
    },
    rebuildModule,
  });
  const sheet = { resource: '/project/__plumeria_sheet__.zero.css' };

  await new Promise((resolve) => finishModules([sheet], resolve));
  expect(rebuildModule).toHaveBeenCalledWith(sheet, expect.any(Function));
});

it('adapts a matching JavaScript rule when no CSS rule exists', () => {
  const originalInclude = jest.fn((id: string) => !id.includes('blocked'));
  const sourceRule = {
    type: 'javascript/auto',
    enforce: 'pre',
    include: originalInclude,
    use: [null, {}, { loader: '/unplugin/load.mjs' }],
  };
  const rules: any[] = [null, { type: 'other', use: [] }, sourceRule];

  (attachWebpackHooks(createBase()) as any).rspack(compilerWith(rules));

  expect(rules).toHaveLength(4);
  expect(sourceRule.include('/project/Card.zero.css')).toBe(false);
  expect(sourceRule.include('/project/Card.tsx')).toBe(true);
  expect(rules[0].include('/project/Card.tsx')).toBe(false);
  expect(rules[0].include('/project/Card.zero.css')).toBe(true);
  expect(rules[0].include('/blocked.zero.css')).toBe(false);
});

it('adapts a JavaScript rule without an include callback', () => {
  const sourceRule: any = {
    type: 'javascript/auto',
    use: [{ loader: '/unplugin/load.mjs' }],
  };
  const rules = [sourceRule];

  (attachWebpackHooks(createBase()) as any).webpack(compilerWith(rules));

  expect(sourceRule.include('/project/Card.tsx')).toBe(true);
  expect(rules[0].include('/project/Card.zero.css')).toBe(true);
});

it('creates the default webpack adapter', () => {
  expect(webpack()).toBeDefined();
});
