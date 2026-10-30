import * as fs from 'fs';
import * as path from 'path';

interface Pattern {
  prefix: string;
  suffix: string;
  wildcard: boolean;
  basePath: string;
  targets: string[];
}

interface TsConfig {
  extends?: string | string[];
  references?: { path?: string }[];
  compilerOptions?: { paths?: Record<string, string[]> };
}

interface PackageManifest {
  exports?: unknown;
  tsconfig?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface SourcePackage {
  name: string;
  dir: string;
  exports: unknown;
  linked: string;
  manifestMtime: number | undefined;
}

const CONFIG_DIR = '${configDir}';

type PathsMatcher = (specifier: string) => string[];

let cachedPathsMatcher: PathsMatcher | null | undefined = undefined;
let cachedSourcePackages: SourcePackage[] | undefined = undefined;

const SOURCE_CONDITION = 'plumeria';

function stripComments(text: string): string {
  let out = '';
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (char === '\\') {
        out += char + (text[i + 1] ?? '');
        i++;
        continue;
      }
      if (char === '"') inString = false;
      out += char;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }

    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      out += ' ';
      continue;
    }

    out += char;
  }

  return out;
}

function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (char === '\\') {
        out += char + (text[i + 1] ?? '');
        i++;
        continue;
      }
      if (char === '"') inString = false;
      out += char;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === ',') {
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === '}' || text[next] === ']') continue;
    }

    out += char;
  }

  return out;
}

function readConfig<T = TsConfig>(configPath: string): T | null {
  let text: string;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch {
    return null;
  }

  try {
    const config = JSON.parse(
      stripTrailingCommas(stripComments(text.replace(/^\uFEFF/, ''))),
    );
    return config && typeof config === 'object' ? config : null;
  } catch {
    return null;
  }
}

function configFileAt(candidate: string): string {
  return fs.statSync(candidate, { throwIfNoEntry: false })?.isDirectory()
    ? path.join(candidate, 'tsconfig.json')
    : candidate;
}

function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
}

function resolveQuietly(specifier: string, basePath: string): string | null {
  try {
    return require.resolve(specifier, { paths: [basePath] });
  } catch {
    return null;
  }
}

function resolveExtendsPath(
  specifier: string,
  basePath: string,
): string | null {
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
    const resolved = configFileAt(path.resolve(basePath, specifier));
    if (isFile(resolved)) return resolved;
    const withExtension = resolved + '.json';
    return isFile(withExtension) ? withExtension : null;
  }

  const packageName = packageNameOf(specifier);
  const exported = () => {
    const resolved = resolveQuietly(specifier, basePath);
    return resolved?.endsWith('.json') ? resolved : null;
  };

  if (specifier !== packageName) return exported();

  const manifestPath = resolveQuietly(`${packageName}/package.json`, basePath);
  if (!manifestPath) return exported();

  const manifest = readConfig<PackageManifest>(manifestPath);
  if (manifest?.exports !== undefined) {
    const resolved = exported();
    if (resolved) return resolved;
  }

  const packageDir = path.dirname(manifestPath);

  if (typeof manifest?.tsconfig === 'string') {
    const declared = configFileAt(path.resolve(packageDir, manifest.tsconfig));
    if (isFile(declared)) return declared;
  }

  const fallback = path.join(packageDir, 'tsconfig.json');
  return isFile(fallback) ? fallback : null;
}

function patternsOf(
  paths: Record<string, string[]> | undefined,
  basePath: string,
  entryPath: string,
): Pattern[] | null {
  if (!paths || typeof paths !== 'object') return null;

  const patterns: Pattern[] = [];

  for (const [alias, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;

    const written = targets.filter(
      (target): target is string => typeof target === 'string',
    );
    if (written.length === 0) continue;

    const star = alias.indexOf('*');

    patterns.push({
      prefix: star < 0 ? alias : alias.slice(0, star),
      suffix: star < 0 ? '' : alias.slice(star + 1),
      wildcard: star >= 0,
      basePath,
      targets: written.map((target) =>
        target.startsWith(CONFIG_DIR)
          ? path.join(entryPath, target.slice(CONFIG_DIR.length))
          : target,
      ),
    });
  }

  return patterns;
}

function collectPatterns(
  configPath: string,
  seen: Set<string>,
  entryPath: string = path.dirname(configPath),
): Pattern[] | null {
  if (seen.has(configPath)) return null;
  seen.add(configPath);

  const config = readConfig(configPath);
  if (!config) return null;

  const basePath = path.dirname(configPath);

  const own = patternsOf(config.compilerOptions?.paths, basePath, entryPath);
  if (own) return own;

  const inherited = Array.isArray(config.extends)
    ? config.extends.slice().reverse()
    : config.extends
      ? [config.extends]
      : [];

  for (const specifier of inherited) {
    const resolved = resolveExtendsPath(specifier, basePath);
    if (!resolved) continue;
    const patterns = collectPatterns(resolved, seen, entryPath);
    if (patterns) return patterns;
  }

  for (const reference of config.references ?? []) {
    if (!reference?.path) continue;
    const patterns = collectPatterns(
      configFileAt(path.resolve(basePath, reference.path)),
      seen,
    );
    if (patterns) return patterns;
  }

  return null;
}

function buildMatcher(patterns: Pattern[]): PathsMatcher {
  const exact = patterns.filter((pattern) => !pattern.wildcard);
  const wildcard = patterns
    .filter((pattern) => pattern.wildcard)
    .sort((a, b) => b.prefix.length - a.prefix.length);

  return (specifier: string) => {
    for (const pattern of exact) {
      if (pattern.prefix === specifier) {
        return pattern.targets.map((target) =>
          path.resolve(pattern.basePath, target),
        );
      }
    }

    for (const pattern of wildcard) {
      if (
        specifier.length >= pattern.prefix.length + pattern.suffix.length &&
        specifier.startsWith(pattern.prefix) &&
        specifier.endsWith(pattern.suffix)
      ) {
        const matched = specifier.slice(
          pattern.prefix.length,
          specifier.length - pattern.suffix.length,
        );
        return pattern.targets.map((target) =>
          path.resolve(pattern.basePath, target.replace('*', matched)),
        );
      }
    }

    return [];
  };
}

function loadPathsMatcher(configPath: string): PathsMatcher | null {
  const patterns = collectPatterns(configPath, new Set());
  return patterns ? buildMatcher(patterns) : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasSubpaths = (exports: unknown): exports is Record<string, unknown> =>
  isRecord(exports) && Object.keys(exports).some((key) => key.startsWith('.'));

const sourceTargetOf = (entry: unknown): string | null => {
  if (!isRecord(entry)) return null;
  const target = entry[SOURCE_CONDITION];
  return typeof target === 'string' ? target : null;
};

function sourceTarget(pkg: SourcePackage, subpath: string): string | null {
  const { exports } = pkg;
  if (!hasSubpaths(exports))
    return subpath === '.' ? sourceTargetOf(exports) : null;
  if (Object.hasOwn(exports, subpath)) return sourceTargetOf(exports[subpath]);
  let best: { key: string; star: number; matched: string } | null = null;
  for (const key of Object.keys(exports)) {
    const star = key.indexOf('*');
    if (star < 0 || key.indexOf('*', star + 1) >= 0) continue;
    const suffix = key.slice(star + 1);
    if (
      subpath.length < key.length ||
      !subpath.startsWith(key.slice(0, star)) ||
      !subpath.endsWith(suffix)
    )
      continue;
    if (
      best &&
      (star < best.star ||
        (star === best.star && key.length <= best.key.length))
    )
      continue;
    best = {
      key,
      star,
      matched: subpath.slice(star, subpath.length - suffix.length),
    };
  }
  if (!best) return null;
  const target = sourceTargetOf(exports[best.key]);
  return target === null ? null : target.replaceAll('*', best.matched);
}

const sourceDirOf = (dir: string, target: string): string => {
  const star = target.indexOf('*');
  if (star < 0) return path.dirname(path.resolve(dir, target));
  const base = target.slice(0, star);
  return base.endsWith('/')
    ? path.resolve(dir, base)
    : path.dirname(path.resolve(dir, base));
};

export function sourceDirsOf(pkg: SourcePackage): string[] {
  const entries = hasSubpaths(pkg.exports)
    ? Object.values(pkg.exports)
    : [pkg.exports];
  const dirs = [
    ...new Set(
      entries
        .map(sourceTargetOf)
        .filter((target): target is string => target !== null)
        .map((target) => sourceDirOf(pkg.dir, target))
        .filter((dir) => dir === pkg.dir || dir.startsWith(pkg.dir + path.sep)),
    ),
  ].sort();
  return dirs.filter(
    (dir) =>
      !dirs.some((other) => other !== dir && dir.startsWith(other + path.sep)),
  );
}

const manifestMtimeOf = (dir: string): number | undefined =>
  fs.statSync(path.join(dir, 'package.json'), { throwIfNoEntry: false })
    ?.mtimeMs;

const realpathOf = (linked: string): string | null => {
  try {
    return fs.realpathSync(linked);
  } catch {
    return null;
  }
};

export function sourcePackagesStale(): boolean {
  return (
    cachedSourcePackages?.some(
      (pkg) =>
        realpathOf(pkg.linked) !== pkg.dir ||
        manifestMtimeOf(pkg.dir) !== pkg.manifestMtime,
    ) ?? false
  );
}

function loadSourcePackages(cwd: string): SourcePackage[] {
  const manifest = readConfig<PackageManifest>(path.join(cwd, 'package.json'));
  if (!manifest) return [];
  const names = [
    ...new Set(
      (
        [
          'dependencies',
          'devDependencies',
          'peerDependencies',
          'optionalDependencies',
        ] as const
      ).flatMap((field) =>
        isRecord(manifest[field]) ? Object.keys(manifest[field]) : [],
      ),
    ),
  ].sort();
  const packages: SourcePackage[] = [];
  for (const name of names) {
    let linked: string | null = null;
    for (let dir = cwd; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', name);
      if (fs.statSync(candidate, { throwIfNoEntry: false })?.isDirectory()) {
        linked = candidate;
        break;
      }
      if (dir === path.dirname(dir)) break;
    }
    if (!linked) continue;
    const dir = fs.realpathSync(linked);
    const exports = readConfig<PackageManifest>(
      path.join(dir, 'package.json'),
    )?.exports;
    if (exports === undefined) continue;
    const pkg = {
      name,
      dir,
      exports,
      linked,
      manifestMtime: manifestMtimeOf(dir),
    };
    if (sourceDirsOf(pkg).length > 0) packages.push(pkg);
  }
  return packages;
}

export function resetImportResolutionCache(cwd: string = process.cwd()): void {
  cachedPathsMatcher = loadPathsMatcher(path.join(cwd, 'tsconfig.json'));
  cachedSourcePackages = loadSourcePackages(cwd);
}

export function getSourcePackages(): SourcePackage[] {
  cachedSourcePackages ??= loadSourcePackages(process.cwd());
  return cachedSourcePackages;
}

function resolveSourcePackage(importPath: string): string | null {
  const name = packageNameOf(importPath);
  const pkg = getSourcePackages().find((p) => p.name === name);
  if (!pkg) return null;
  const target = sourceTarget(pkg, `.${importPath.slice(name.length)}`);
  if (target === null) return null;
  const resolved = path.resolve(pkg.dir, target);
  return isFile(resolved) ? resolved : null;
}

function getPathsMatcher(): PathsMatcher | null {
  if (cachedPathsMatcher !== undefined) return cachedPathsMatcher;

  const tsConfigPath = path.join(process.cwd(), 'tsconfig.json');
  cachedPathsMatcher = fs.existsSync(tsConfigPath)
    ? loadPathsMatcher(tsConfigPath)
    : null;

  return cachedPathsMatcher;
}

const extensions = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
];

const rewritten: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
};

function isFile(candidate: string): boolean {
  return fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() ?? false;
}

function resolveWithExtension(basePath: string): string | null {
  if (isFile(basePath)) return basePath;

  const extension = path.extname(basePath);
  for (const replacement of rewritten[extension] ?? []) {
    const candidate = basePath.slice(0, -extension.length) + replacement;
    if (isFile(candidate)) return candidate;
  }

  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (isFile(fullPath)) return fullPath;
  }
  return null;
}

export function resolveImportPath(
  importPath: string,
  importerPath: string,
): string | null {
  if (importPath === '@plumeria/core') return null;

  if (importPath.startsWith('.')) {
    return resolveWithExtension(
      path.resolve(path.dirname(importerPath), importPath),
    );
  }

  const matchPaths = getPathsMatcher();

  if (matchPaths) {
    for (const candidate of matchPaths(importPath)) {
      const result = resolveWithExtension(candidate);
      if (result) return result;
    }
  }

  const sourcePackage = resolveSourcePackage(importPath);
  if (sourcePackage) return sourcePackage;

  let currentDir = path.dirname(importerPath);
  while (currentDir !== path.parse(currentDir).root) {
    if (fs.existsSync(path.join(currentDir, 'package.json'))) {
      return resolveWithExtension(path.resolve(currentDir, importPath));
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}
