import * as path from 'path';
import * as os from 'os';

const mockCompileCSS = jest.fn((_options: unknown) => '.production {}');
const mockTransformSource = jest.fn((_options: unknown) => ({
  code: 'transformed',
  dependencies: [] as string[],
}));
const mockWriteFileSync = jest.fn();

jest.mock('@plumeria/compiler', () => ({
  compileCSS: (options: unknown) => mockCompileCSS(options),
  DEFAULT_STYLE_PROP: 'sx',
  needsCompile: jest.requireActual('@plumeria/compiler').needsCompile,
  sourcePackages: jest.requireActual('@plumeria/compiler').sourcePackages,
  optimizer: (css: string) => css,
  resolvePropertyPolicy: () => ({}),
  transformSource: (options: unknown) => mockTransformSource(options),
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

import loader, {
  VIRTUAL_FILE_PATH,
  devBridge,
  generationId,
  inSourcePackage,
  resolveSourcePackage,
  sourcePackages,
  watchSources,
} from '../src/index';

type Loader = (this: unknown, source: string) => Promise<void>;

const runLoader = (
  source: string,
  context: Record<string, unknown> = {},
): Promise<string> =>
  new Promise((resolve, reject) => {
    (loader as unknown as Loader).call(
      {
        resourcePath: path.resolve(__dirname, '..', 'fixture.tsx'),
        async: () => (error: Error | null, content?: string) =>
          error ? reject(error) : resolve(content as string),
        addDependency: () => {},
        clearDependencies: () => {},
        ...context,
      },
      source,
    );
  });

const SOURCE = `import '@plumeria/core';`;
const originalNodeEnv = process.env.NODE_ENV;
const setNodeEnv = (value: string | undefined) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
};

afterEach(() => {
  setNodeEnv(originalNodeEnv);
  mockCompileCSS.mockClear();
  mockTransformSource.mockClear();
  mockWriteFileSync.mockClear();
});

it('returns sources outside the loader scope unchanged', async () => {
  await expect(runLoader('export {};')).resolves.toBe('export {};');
  await expect(
    runLoader(SOURCE, {
      resourcePath: '/project/node_modules/dependency.ts',
    }),
  ).resolves.toBe(SOURCE);

  expect(mockTransformSource).not.toHaveBeenCalled();
});

it('supports query options and prefixes a same-directory virtual import', async () => {
  const output = await runLoader(SOURCE, {
    query: { styleProp: 'classStyle' },
  });

  expect(mockTransformSource).toHaveBeenCalledWith(
    expect.objectContaining({ styleProp: 'classStyle' }),
  );
  expect(output).toBe('transformed\nimport "./zero-virtual.css";');
});

it.each(['development', 'production'])(
  'leaves the stylesheet to the CSS loader in %s',
  async (mode) => {
    setNodeEnv(mode);

    await runLoader(SOURCE);

    expect(mockTransformSource).toHaveBeenCalled();
    expect(mockCompileCSS).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  },
);

it('exposes helpers and watches only source files', () => {
  const actualFs = jest.requireActual<typeof import('fs')>('fs');
  const dir = actualFs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-watch-'));
  actualFs.mkdirSync(path.join(dir, 'src'));
  actualFs.mkdirSync(path.join(dir, 'node_modules'));
  actualFs.writeFileSync(path.join(dir, 'src', 'index.ts'), '');
  actualFs.writeFileSync(path.join(dir, 'src', 'note.txt'), '');
  actualFs.writeFileSync(path.join(dir, 'node_modules', 'ignored.ts'), '');
  actualFs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const dependencies: string[] = [];
  watchSources({ addDependency: (file) => dependencies.push(file) }, dir);
  expect(dependencies).toEqual([path.join(dir, 'src', 'index.ts')]);
  expect(VIRTUAL_FILE_PATH).toMatch(/zero-virtual\.css$/);
  expect(generationId('css')).toHaveLength(16);
  expect(sourcePackages(dir)).toEqual([]);
  expect(resolveSourcePackage([], 'missing')).toBeNull();
  expect(inSourcePackage([], path.join(dir, 'src', 'index.ts'))).toBe(false);
  actualFs.rmSync(dir, { recursive: true, force: true });
});

it('skips a development bridge when the edited file has disappeared', () => {
  setNodeEnv('development');
  const resourcePath = path.join(os.tmpdir(), 'missing-plumeria-module.tsx');
  const module = { resourcePath, code: 'first', dependencies: [] };
  expect(devBridge(module, {}, process.cwd())).toBe('');
  expect(devBridge({ ...module, code: 'second' }, {}, process.cwd())).toBe('');
});
