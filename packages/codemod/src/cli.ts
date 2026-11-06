import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ESLint } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';
import { renameProp } from './transforms/rename-prop';
import { renameApi } from './transforms/rename-api';
import {
  migrateToTypedCSS,
  toTypedCSS,
} from './transforms/migrate-to-typedcss';
import { installCommand, migrateManifests } from './package-json';
import type { Linter } from 'eslint';

const { version } = require('../package.json') as { version: string };

const TRANSFORMS = [
  'rename-prop',
  'rename-api',
  'migrate-to-typedcss',
] as const;

const APIS = [
  'create',
  'createTheme',
  'createStatic',
  'keyframes',
  'viewTransitionClass',
  'positionTry',
  'varType',
  'marker',
  'extended',
  'use',
];

const SOURCE_FILES = '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}';

const IGNORES = [
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/coverage/**',
];

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Renaming onto one of these would collide with a prop React already handles.
const RESERVED = new Set(['className', 'key', 'ref', 'children', 'style']);

const USAGE = `plumeria-codemod — codemods for migrating Plumeria APIs

Usage
  npx @plumeria/codemod rename-prop <from> <to> [paths...]
  npx @plumeria/codemod rename-api <from> <to> [paths...]
  npx @plumeria/codemod migrate-to-typedcss [paths...]

Options
  -d, --dry-run    report what would change without writing
      --no-types   leave TypeScript declarations untouched (rename-prop)
  -h, --help       show this message
  -v, --version    show the version

Examples
  npx @plumeria/codemod rename-prop classStyle sx
  npx @plumeria/codemod rename-prop classStyle sx src app --dry-run
  npx @plumeria/codemod rename-api viewTransition viewTransitionClass
  npx @plumeria/codemod migrate-to-typedcss src --dry-run

Paths default to the current directory. After the rewrite, point the toolchain
at the new name with \`styleProp\` on your bundler plugin, and with
\`settings: { plumeria: { styleProp: '<to>' } }\` in your ESLint config.`;

class UsageError extends Error {}

interface RenameOptions {
  transform: (typeof TRANSFORMS)[number];
  from: string;
  to: string;
  targets: string[];
  dryRun: boolean;
  includeTypes: boolean;
}

function parseArgs(argv: string[]): RenameOptions | null {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return null;
  }
  if (argv.includes('-v') || argv.includes('--version')) {
    console.log(version);
    return null;
  }

  const positional: string[] = [];
  let dryRun = false;
  let includeTypes = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-d':
      case '--dry-run':
        dryRun = true;
        break;
      case '--no-types':
        includeTypes = false;
        break;
      default:
        if (arg.startsWith('-'))
          throw new UsageError(`unknown option "${arg}"`);
        positional.push(arg);
    }
  }

  const [transform, ...rest] = positional;

  if (!TRANSFORMS.includes(transform as (typeof TRANSFORMS)[number])) {
    throw new UsageError(
      `unknown transform "${transform}". Available: ${TRANSFORMS.join(', ')}`,
    );
  }

  if (transform === 'migrate-to-typedcss') {
    return {
      transform: 'migrate-to-typedcss',
      from: 'Plumeria',
      to: 'typedcss',
      targets: rest.length > 0 ? rest : ['.'],
      dryRun,
      includeTypes,
    };
  }

  const [from, to, ...targets] = rest;

  if (!from || !to) {
    throw new UsageError(`${transform} needs both <from> and <to>`);
  }
  if (from === to) {
    throw new UsageError(`<from> and <to> are both "${from}"`);
  }
  if (transform === 'rename-api') {
    if (!APIS.includes(to)) {
      throw new UsageError(
        `"${to}" is not a Plumeria API. Available: ${APIS.join(', ')}`,
      );
    }
    return {
      transform: 'rename-api',
      from,
      to,
      targets: targets.length > 0 ? targets : ['.'],
      dryRun,
      includeTypes,
    };
  }
  if (!IDENTIFIER.test(to)) {
    throw new UsageError(`"${to}" is not a valid identifier`);
  }
  if (RESERVED.has(to)) {
    throw new UsageError(`"${to}" is already used by React`);
  }

  return {
    transform: 'rename-prop',
    from,
    to,
    targets: targets.length > 0 ? targets : ['.'],
    dryRun,
    includeTypes,
  };
}

function buildConfig(options: RenameOptions): Linter.Config[] {
  const { transform, from, to, includeTypes } = options;
  const rule =
    transform === 'migrate-to-typedcss'
      ? {
          plugins: {
            codemod: { rules: { 'migrate-to-typedcss': migrateToTypedCSS } },
          },
          rules: { 'codemod/migrate-to-typedcss': 'error' },
        }
      : transform === 'rename-api'
        ? {
            plugins: { codemod: { rules: { 'rename-api': renameApi } } },
            rules: { 'codemod/rename-api': ['error', { from, to }] },
          }
        : {
            plugins: { codemod: { rules: { 'rename-prop': renameProp } } },
            rules: {
              'codemod/rename-prop': ['error', { from, to, includeTypes }],
            },
          };

  return [
    { ignores: IGNORES },
    {
      files: [SOURCE_FILES],
      languageOptions: {
        parser: tsParser as unknown as Linter.Parser,
        parserOptions: {
          sourceType: 'module',
          ecmaFeatures: { jsx: true },
        },
      },
      ...rule,
    },
  ] as Linter.Config[];
}

function warnIfDirty(): void {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (status.trim()) {
      console.warn(
        '! git working tree is not clean. Commit first so the rewrite can be reverted.\n',
      );
    }
  } catch {
    // ignore
  }
}

export async function main(argv: string[]): Promise<number> {
  let options: RenameOptions | null;

  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`✖ ${error.message}\n`);
    console.error(USAGE);
    return 1;
  }

  if (!options) return 0;

  const code = await rewriteSource(options);
  if (options.transform !== 'migrate-to-typedcss') return code;
  migratePackages(options);
  return code;
}

function migratePackages({ targets, dryRun }: RenameOptions): void {
  const cwd = process.cwd();
  const changes = migrateManifests(targets, toTypedCSS, dryRun);
  if (changes.length === 0) return;

  console.log('');
  for (const { file, moved } of changes) {
    console.log(`  ${path.relative(cwd, file)}`);
    for (const entry of moved) console.log(`    ${entry}`);
  }
  if (dryRun) {
    console.log(`\n${changes.length} package.json file(s) would be updated.`);
    return;
  }
  console.log(`\n✔ updated ${changes.length} package.json file(s).`);
  console.log(
    `\nNext: run \`${installCommand(cwd)}\` to install the @typedcss/* packages.`,
  );
}

async function rewriteSource(options: RenameOptions): Promise<number> {
  const { from, to, targets, dryRun } = options;
  const baseConfig = {
    overrideConfigFile: true as const,
    overrideConfig: buildConfig(options),
    errorOnUnmatchedPattern: false,
  };

  const results = await new ESLint(baseConfig).lintFiles(targets);

  const cwd = process.cwd();
  const relative = (filePath: string) => path.relative(cwd, filePath) || '.';

  const changes: { file: string; count: number }[] = [];
  const manual: string[] = [];
  const unparsed: string[] = [];
  let total = 0;

  for (const result of results) {
    let count = 0;
    for (const message of result.messages) {
      if (message.fatal) {
        unparsed.push(`${relative(result.filePath)}: ${message.message}`);
      } else if (message.fix) {
        count++;
      } else {
        manual.push(
          `${relative(result.filePath)}:${message.line}:${message.column}`,
        );
      }
    }
    if (count > 0) {
      changes.push({ file: relative(result.filePath), count });
      total += count;
    }
  }

  if (total === 0 && manual.length === 0) {
    console.log(`No "${from}" found.`);
    return unparsed.length > 0 ? report(unparsed) : 0;
  }

  if (total === 0) {
    console.log(`Every remaining "${from}" needs a manual rename.`);
  } else {
    for (const { file, count } of changes) {
      console.log(`  ${file}  ${count}`);
    }

    if (dryRun) {
      console.log(
        `\n${total} occurrence(s) in ${changes.length} file(s) would become "${to}".`,
      );
      console.log('Run without --dry-run to apply.');
    } else {
      warnIfDirty();
      const applied = await new ESLint({ ...baseConfig, fix: true }).lintFiles(
        targets,
      );
      await ESLint.outputFixes(applied);
      console.log(
        options.transform === 'migrate-to-typedcss'
          ? `\n✔ rewrote ${total} Plumeria import(s) and plugin(s) to typedcss in ${changes.length} file(s).`
          : `\n✔ renamed ${total} occurrence(s) of "${from}" to "${to}" in ${changes.length} file(s).`,
      );
    }
  }

  if (manual.length > 0) {
    console.log(
      `\n${manual.length} occurrence(s) need a manual rename — "${from}" is bound to a local name there:`,
    );
    for (const location of manual) console.log(`  ${location}`);
  }

  return unparsed.length > 0 ? report(unparsed) : 0;
}

function report(unparsed: string[]): number {
  console.error(`\n✖ ${unparsed.length} file(s) could not be parsed:`);
  for (const failure of unparsed) console.error(`  ${failure}`);
  return 1;
}
