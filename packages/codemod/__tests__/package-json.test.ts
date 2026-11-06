import { migrateManifest } from '../src/package-json';
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
});
