import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  installCommand,
  migrateManifest,
  migrateManifests,
} from '../src/package-json';
import { toTypedCSS } from '../src/transforms/migrate-to-typedcss';

// any range is carried over as is
const range = 'workspace:*';

describe('migrateManifest', () => {
  it('swaps each package and keeps its range and position', () => {
    const manifest = {
      dependencies: { '@plumeria/core': range, react: '^19.0.0' },
      devDependencies: {
        '@plumeria/eslint-plugin': range,
        '@plumeria/unplugin': range,
        '@plumeria/compiler': range,
      },
    };
    expect(migrateManifest(manifest, toTypedCSS)).toHaveLength(3);
    expect(manifest).toEqual({
      dependencies: { '@typedcss/css': range, react: '^19.0.0' },
      devDependencies: {
        '@typedcss/eslint-plugin': range,
        '@typedcss/unplugin': range,
        '@plumeria/compiler': range,
      },
    });
    expect(Object.keys(manifest.dependencies)).toEqual([
      '@typedcss/css',
      'react',
    ]);
  });

  it('moves the runtime into dependencies', () => {
    const manifest: Record<string, Record<string, string>> = {
      dependencies: { react: '^19.0.0' },
      devDependencies: {
        '@plumeria/core': range,
        '@plumeria/next-plugin': range,
      },
    };
    migrateManifest(manifest, toTypedCSS);
    expect(manifest).toEqual({
      dependencies: { '@typedcss/css': range, react: '^19.0.0' },
      devDependencies: { '@typedcss/next-plugin': range },
    });
  });

  it('drops a section the move leaves empty', () => {
    const manifest: Record<string, Record<string, string>> = {
      devDependencies: { '@plumeria/core': range },
    };
    migrateManifest(manifest, toTypedCSS);
    expect(manifest).toEqual({
      dependencies: { '@typedcss/css': range },
    });
  });

  it('leaves a manifest without Plumeria alone', () => {
    const manifest = { dependencies: { react: '^19.0.0' } };
    expect(migrateManifest(manifest, toTypedCSS)).toEqual([]);
    expect(manifest).toEqual({ dependencies: { react: '^19.0.0' } });
  });

  it('keeps an existing target and runtime dependency', () => {
    const manifest = {
      dependencies: { '@typedcss/css': '^1.0.0' },
      optionalDependencies: {
        '@typedcss/unplugin': '^1.0.0',
        '@plumeria/core': range,
        '@plumeria/unplugin': range,
      },
    };

    migrateManifest(manifest, toTypedCSS);

    expect(manifest).toEqual({
      dependencies: { '@typedcss/css': '^1.0.0' },
      optionalDependencies: { '@typedcss/unplugin': '^1.0.0' },
    });
  });
});

describe('migrateManifests', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-codemod-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('finds manifests recursively, skips generated directories, and writes them', () => {
    const nested = path.join(directory, 'packages', 'app');
    const skipped = path.join(directory, 'node_modules', 'dependency');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(skipped, { recursive: true });
    const manifest = path.join(nested, 'package.json');
    fs.writeFileSync(
      manifest,
      '{\n\t"devDependencies": {\n\t\t"@plumeria/core": "workspace:*"\n\t}\n}\n',
    );
    fs.writeFileSync(
      path.join(skipped, 'package.json'),
      '{"dependencies":{"@plumeria/core":"*"}}',
    );
    const ordinaryFile = path.join(directory, 'notes.txt');
    fs.writeFileSync(ordinaryFile, 'notes');

    const changes = migrateManifests(
      [directory, manifest, ordinaryFile, path.join(directory, 'missing')],
      toTypedCSS,
      false,
    );

    expect(changes).toEqual([
      {
        file: manifest,
        moved: ['@plumeria/core → @typedcss/css'],
      },
    ]);
    expect(fs.readFileSync(manifest, 'utf8')).toBe(
      '{\n\t"dependencies": {\n\t\t"@typedcss/css": "workspace:*"\n\t}\n}\n',
    );
  });

  it('ignores invalid and unchanged manifests and supports dry runs', () => {
    const invalid = path.join(directory, 'package.json');
    const unchangedDirectory = path.join(directory, 'unchanged');
    const changedDirectory = path.join(directory, 'changed');
    fs.mkdirSync(unchangedDirectory);
    fs.mkdirSync(changedDirectory);
    fs.writeFileSync(invalid, '{');
    fs.writeFileSync(
      path.join(unchangedDirectory, 'package.json'),
      '{"dependencies":{"react":"*"}}',
    );
    const changed = path.join(changedDirectory, 'package.json');
    const original = '{"dependencies":{"@plumeria/unplugin":"*"}}';
    fs.writeFileSync(changed, original);

    expect(migrateManifests([directory], toTypedCSS, true)).toEqual([
      {
        file: changed,
        moved: ['@plumeria/unplugin → @typedcss/unplugin'],
      },
    ]);
    expect(fs.readFileSync(changed, 'utf8')).toBe(original);

    expect(migrateManifests([changed], toTypedCSS, false)).toHaveLength(1);
    expect(fs.readFileSync(changed, 'utf8')).toBe(
      '{\n  "dependencies": {\n    "@typedcss/unplugin": "*"\n  }\n}',
    );
  });
});

describe('installCommand', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-install-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('uses packageManager from the nearest ancestor manifest', () => {
    const nested = path.join(directory, 'packages', 'app');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@11.0.0' }),
    );

    expect(installCommand(nested)).toBe('pnpm install');
  });

  it.each([
    ['pnpm-lock.yaml', 'pnpm install'],
    ['yarn.lock', 'yarn install'],
    ['bun.lock', 'bun install'],
    ['bun.lockb', 'bun install'],
    ['package-lock.json', 'npm install'],
  ])('uses %s when no package manager is declared', (lockfile, command) => {
    fs.writeFileSync(path.join(directory, 'package.json'), '{}');
    fs.writeFileSync(path.join(directory, lockfile), '');

    expect(installCommand(directory)).toBe(command);
  });

  it('falls back to npm when no manifest or lockfile exists', () => {
    expect(installCommand(directory)).toBe('npm install');
  });
});
