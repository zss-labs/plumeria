import type { NextConfig } from 'next';
import type { LoaderOptions } from '@plumeria/turbopack-loader';
import type { TurbopackLoaderItem } from 'next/dist/server/config-shared';
import type { Configuration } from 'webpack';
import type { WebpackConfigContext } from 'next/dist/server/config-shared';
import * as fs from 'fs';
import * as path from 'path';
import {
  devGenerationsPath,
  inSourcePackage,
  resolveSourcePackage,
  sourcePackages,
} from '@plumeria/turbopack-loader';
import { lintOverrides } from '@plumeria/eslint-plugin/guard';
import { startNextLintGuard } from './lint';

type TurbopackConfig = NonNullable<NextConfig['turbopack']>;
type TurbopackRules = NonNullable<TurbopackConfig['rules']>;
type TurbopackRuleValue = TurbopackRules[string];

const isRuleConfigItem = (
  rule: TurbopackRuleValue,
): rule is Extract<TurbopackRuleValue, { loaders?: TurbopackLoaderItem[] }> =>
  !Array.isArray(rule) && typeof rule === 'object' && rule !== null;

type PlumeriaTurbopackRules = Record<
  string,
  { loaders: TurbopackLoaderItem[]; condition?: unknown; as?: string }
>;

export type PlumeriaOptions = LoaderOptions & { lint?: boolean };

const loaderVersion = (): string =>
  JSON.parse(
    fs.readFileSync(
      path.join(
        path.dirname(require.resolve('@plumeria/turbopack-loader')),
        '..',
        'package.json',
      ),
      'utf8',
    ),
  ).version;

export function withPlumeria(
  nextConfig: NextConfig = {},
  { lint = true, ...options }: PlumeriaOptions = {},
): NextConfig {
  if (lint) startNextLintGuard(lintOverrides(options));

  const globalRef = global as typeof global & {
    __PLUMERIA_DEV_CSS_RESET__?: boolean;
  };
  if (
    process.env.NODE_ENV === 'development' &&
    !globalRef.__PLUMERIA_DEV_CSS_RESET__
  ) {
    globalRef.__PLUMERIA_DEV_CSS_RESET__ = true;
    fs.rmSync(devGenerationsPath(process.cwd()), { force: true });
  }

  const originalWebpack = nextConfig.webpack;
  const turbopackOptions: Record<string, unknown> = {
    ...options,
    version: loaderVersion(),
  };

  const packages = sourcePackages(process.cwd());
  const turbopackAliases = Object.fromEntries(
    packages.flatMap((pkg) => {
      const exports = pkg.exports as Record<string, any>;
      const map = Object.keys(exports).some((key) => key.startsWith('.'))
        ? exports
        : { '.': exports };
      return Object.entries(map).flatMap(([subpath, entry]) =>
        typeof entry?.plumeria === 'string'
          ? [
              [
                pkg.name + subpath.slice(1),
                `./${path
                  .relative(
                    process.cwd(),
                    path.resolve(pkg.dir, entry.plumeria),
                  )
                  .replace(/\\/g, '/')}`,
              ],
            ]
          : [],
      );
    }),
  );
  const packageRequest = new RegExp(
    `^(${packages
      .map((pkg) => pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})(/|$)`,
  );

  const turbopackLoaders: TurbopackLoaderItem[] = [
    {
      loader: '@plumeria/turbopack-loader',
      options: turbopackOptions as Record<string, never>,
    },
  ];

  const styleProp = options.styleProp ?? 'sx';
  const escapedStyleProp = styleProp.replaceAll('$', '\\$');
  const start = /^\w/.test(styleProp) ? '(?:^|[^\\w.])' : '';
  const end = /\w$/.test(styleProp) ? '\\b' : '';
  const content = new RegExp(
    `@plumeria/core|${start}${escapedStyleProp}${end}`,
  );

  const ruleItem = {
    loaders: turbopackLoaders,
    condition: {
      all: [{ not: 'foreign' }, { content }],
    },
  };

  const cssLoader = {
    loader: '@plumeria/turbopack-loader/css',
    options: turbopackOptions as Record<string, never>,
  };

  const plumeriaRules: PlumeriaTurbopackRules = {
    '*.ts': ruleItem,
    '*.tsx': ruleItem,
    '*.js': ruleItem,
    '*.jsx': ruleItem,
    'zero-virtual.css': { loaders: [cssLoader], as: '*.css' },
  };

  const mergeTurbopackRules = (
    existingRules: TurbopackRules = {},
    newRules: PlumeriaTurbopackRules,
  ): TurbopackRules => {
    const mergedRules = { ...existingRules };

    for (const [key, newRule] of Object.entries(newRules)) {
      const existing = mergedRules[key];

      if (existing && isRuleConfigItem(existing)) {
        const newLoaders = newRule.loaders;

        const existingLoaders = Array.isArray(existing.loaders)
          ? existing.loaders
          : existing.loaders
            ? [existing.loaders]
            : [];

        mergedRules[key] = {
          ...existing,
          loaders: [...newLoaders, ...existingLoaders],
        };
      } else {
        mergedRules[key] = newRule as TurbopackRuleValue;
      }
    }
    return mergedRules;
  };

  return {
    ...nextConfig,
    transpilePackages: [
      ...(nextConfig.transpilePackages ?? []),
      ...packages.map((pkg) => pkg.name),
    ],
    turbopack: {
      ...nextConfig?.turbopack,
      resolveAlias: {
        ...turbopackAliases,
        ...nextConfig?.turbopack?.resolveAlias,
      },
      rules: mergeTurbopackRules(nextConfig?.turbopack?.rules, plumeriaRules),
    },

    webpack(config: Configuration, context: WebpackConfigContext) {
      if (typeof originalWebpack === 'function') {
        config = originalWebpack(config, context);
      }

      const existingIgnored = config.watchOptions?.ignored;
      const plumeriaIgnored = ['node_modules', '.next', '.git'];

      const mergedIgnored =
        existingIgnored instanceof RegExp
          ? existingIgnored
          : Array.from(
              new Set([
                ...(Array.isArray(existingIgnored)
                  ? existingIgnored
                  : existingIgnored
                    ? [existingIgnored]
                    : []),
                ...plumeriaIgnored,
              ]),
            );

      config.watchOptions = {
        ...config.watchOptions,
        ignored: mergedIgnored,
      };

      if (packages.length > 0) {
        config.plugins = [
          ...(config.plugins ?? []),
          new context.webpack.NormalModuleReplacementPlugin(
            packageRequest,
            (resource: { request: string }) => {
              const target = resolveSourcePackage(packages, resource.request);
              if (target) resource.request = target;
            },
          ),
        ];
      }

      config.module?.rules?.unshift({
        enforce: 'pre',
        test: /\.(tsx|ts|jsx|js)$/,
        exclude: (file: string) =>
          /\.next|\.git/.test(file) ||
          (file.includes('node_modules') && !inSourcePackage(packages, file)),
        use: { loader: '@plumeria/turbopack-loader', options },
      });

      config.module?.rules?.unshift({
        enforce: 'pre',
        test: /zero-virtual\.css$/,
        use: { loader: '@plumeria/turbopack-loader/css', options },
      });

      return config;
    },
  };
}
