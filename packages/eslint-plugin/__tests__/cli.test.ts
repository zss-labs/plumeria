import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cliOverrides, stylePropFromESLint, takeStyleProp } from '../src/cli';

describe('takeStyleProp', () => {
  it('takes the styling prop out of the oxlint arguments', () => {
    expect(takeStyleProp(['--style-prop', 'classStyle', '--fix'])).toEqual({
      styleProp: 'classStyle',
      rest: ['--fix'],
    });
    expect(takeStyleProp(['src', '--style-prop=classStyle'])).toEqual({
      styleProp: 'classStyle',
      rest: ['src'],
    });
    expect(takeStyleProp(['--fix'])).toEqual({ rest: ['--fix'] });
  });

  it('throws when the flag has no prop name', () => {
    expect(() => takeStyleProp(['--style-prop'])).toThrow(
      '--style-prop needs a prop name',
    );
    expect(() => takeStyleProp(['--style-prop='])).toThrow(
      '--style-prop needs a prop name',
    );
  });
});

describe('stylePropFromESLint', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'plumerialint-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const fakeESLint = (
    settings: Record<string, unknown> | null,
    { loadESLint = true } = {},
  ) => {
    const dir = path.join(cwd, 'node_modules', 'eslint');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'eslint', main: 'index.js' }),
    );
    fs.writeFileSync(
      path.join(dir, 'index.js'),
      `const settings = ${JSON.stringify(settings)};
class ESLint {
  async calculateConfigForFile(file) {
    if (!settings) throw new Error('Could not find config file.');
    return file.endsWith('index.js') ? { settings } : undefined;
  }
}
exports.ESLint = ESLint;
${loadESLint ? 'exports.loadESLint = async () => ESLint;' : ''}
`,
    );
  };

  it('returns nothing without eslint', async () => {
    await expect(stylePropFromESLint(cwd)).resolves.toBeUndefined();
  });

  it('returns nothing when eslint cannot be loaded', async () => {
    const dir = path.join(cwd, 'node_modules', 'eslint');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'eslint', main: 'index.js' }),
    );
    fs.writeFileSync(path.join(dir, 'index.js'), `throw new Error('broken');`);
    await expect(stylePropFromESLint(cwd)).resolves.toBeUndefined();
  });

  it('returns nothing without an eslint config', async () => {
    fakeESLint(null);
    await expect(stylePropFromESLint(cwd)).resolves.toBeUndefined();
  });

  it('returns nothing when no probed file has the setting', async () => {
    fakeESLint({});
    await expect(stylePropFromESLint(cwd)).resolves.toBeUndefined();
  });

  it('reads the styling prop from the eslint settings', async () => {
    fakeESLint({ plumeria: { styleProp: 'classStyle' } });
    await expect(stylePropFromESLint(cwd)).resolves.toBe('classStyle');
  });

  it('reads the settings through an eslint without loadESLint', async () => {
    fakeESLint(
      { plumeria: { styleProp: 'classStyle' } },
      { loadESLint: false },
    );
    await expect(stylePropFromESLint(cwd)).resolves.toBe('classStyle');
  });

  it('prefers the flag over the eslint settings', async () => {
    fakeESLint({ plumeria: { styleProp: 'classStyle' } });
    await expect(
      cliOverrides(['--style-prop', 'css', '--fix'], cwd),
    ).resolves.toEqual({
      overrides: { settings: { plumeria: { styleProp: 'css' } } },
      rest: ['--fix'],
    });
    await expect(cliOverrides([], cwd)).resolves.toEqual({
      overrides: { settings: { plumeria: { styleProp: 'classStyle' } } },
      rest: [],
    });
  });
});
