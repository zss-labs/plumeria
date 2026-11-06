import fs from 'node:fs';
import path from 'node:path';

const SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

// @typedcss/css ships the runtime, so it always belongs in dependencies.
const RUNTIME = '@typedcss/css';

const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.git',
]);

type Manifest = Record<string, unknown> & {
  [section in (typeof SECTIONS)[number]]?: Record<string, string>;
};

export interface ManifestChange {
  file: string;
  moved: string[];
}

/**
 * Swap the Plumeria packages for their typedcss counterparts in a manifest,
 * keeping each version range and the key order.
 */
export function migrateManifest(
  manifest: Manifest,
  convert: (name: string) => string | null,
): string[] {
  const moved: string[] = [];
  let runtime: string | undefined;

  for (const section of SECTIONS) {
    const deps = manifest[section];
    if (!deps) continue;
    const entries: [string, string][] = [];
    let changed = false;
    for (const [name, range] of Object.entries(deps)) {
      const target = convert(name);
      if (!target) {
        entries.push([name, range]);
        continue;
      }
      changed = true;
      moved.push(`${name} → ${target}`);
      if (target === RUNTIME && section !== 'dependencies') {
        runtime ??= range;
        continue;
      }
      if (!entries.some(([existing]) => existing === target)) {
        entries.push([target, range]);
      }
    }
    if (changed) manifest[section] = Object.fromEntries(entries);
  }

  if (runtime !== undefined) {
    const deps = (manifest.dependencies ??= {});
    if (!(RUNTIME in deps)) {
      manifest.dependencies = Object.fromEntries(
        [...Object.entries(deps), [RUNTIME, runtime]].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
  }

  for (const section of SECTIONS) {
    const deps = manifest[section];
    if (deps && Object.keys(deps).length === 0) delete manifest[section];
  }

  return moved;
}

function findManifests(target: string, found: string[]): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (path.basename(target) === 'package.json') found.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) {
        findManifests(path.join(target, entry.name), found);
      }
    } else if (entry.name === 'package.json') {
      found.push(path.join(target, entry.name));
    }
  }
}

export function migrateManifests(
  targets: string[],
  convert: (name: string) => string | null,
  dryRun: boolean,
): ManifestChange[] {
  const files: string[] = [];
  for (const target of targets) findManifests(path.resolve(target), files);

  const changes: ManifestChange[] = [];
  for (const file of new Set(files)) {
    const text = fs.readFileSync(file, 'utf8');
    let manifest: Manifest;
    try {
      manifest = JSON.parse(text) as Manifest;
    } catch {
      continue;
    }
    const moved = migrateManifest(manifest, convert);
    if (moved.length === 0) continue;
    changes.push({ file, moved });
    if (dryRun) continue;
    const indent = /^[ \t]+/m.exec(text)?.[0] ?? '  ';
    const newline = text.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(file, JSON.stringify(manifest, null, indent) + newline);
  }
  return changes;
}

const LOCKFILES: [string, string][] = [
  ['pnpm-lock.yaml', 'pnpm install'],
  ['yarn.lock', 'yarn install'],
  ['bun.lock', 'bun install'],
  ['bun.lockb', 'bun install'],
  ['package-lock.json', 'npm install'],
];

/** The install command for the project at `cwd`, from its lockfile. */
export function installCommand(cwd: string): string {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
      ) as { packageManager?: string };
      const name = manifest.packageManager?.split('@')[0];
      if (name) return `${name} install`;
    } catch {
      // no manifest here
    }
    for (const [lockfile, command] of LOCKFILES) {
      if (fs.existsSync(path.join(dir, lockfile))) return command;
    }
    if (path.dirname(dir) === dir) return 'npm install';
  }
}
