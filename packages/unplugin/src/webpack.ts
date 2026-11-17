import { createWebpackPlugin } from 'unplugin';
import {
  unpluginFactory,
  EXTENSION_PATTERN,
  type PluginOptions,
  type CssImportContext,
} from './core';
import * as fs from 'fs';
import * as path from 'path';
import compiler from '@plumeria/compiler';

const { optimizer } = compiler;

const ZERO_CSS_SUFFIX = '(?:$|\\?|%3F)';
const VIRTUAL_CSS_PATH = new RegExp(`\\.zero\\.css${ZERO_CSS_SUFFIX}`);
const SHEET_NAME = '__plumeria_sheet__.zero.css';

export function attachWebpackHooks(plugin: any) {
  const { setDev, setRoot, setCssImport } = plugin.__plumeriaInternal;

  let sheetPath: string | null = null;

  const isSheet = (id: string): boolean =>
    sheetPath !== null && decodeURIComponent(id).includes(SHEET_NAME);

  const sheetCss = (): string => {
    const { cssLookup } = plugin.__plumeriaInternal;
    return optimizer(
      [...cssLookup.keys()]
        .sort()
        .map((key: string) => cssLookup.get(key))
        .join(''),
    );
  };

  const cssFileOf = (id: string): string =>
    `${id.split('?', 1)[0].replace(EXTENSION_PATTERN, '')}.zero.css`;

  const baseTransform = plugin.transform;
  plugin.transform = {
    ...baseTransform,
    async handler(this: any, code: string, id: string) {
      const result = await baseTransform.handler.call(this, code, id);
      const buildInfo =
        this.getNativeBuildContext?.().loaderContext?._module?.buildInfo;
      const css = plugin.__plumeriaInternal.cssLookup.get(cssFileOf(id));
      if (buildInfo && css !== undefined) buildInfo.plumeriaCss = css;
      return result;
    },
  };

  const restoreModuleCss = (module: any): void => {
    const css = module.buildInfo?.plumeriaCss;
    if (typeof css !== 'string' || !module.resource) return;
    const { cssLookup } = plugin.__plumeriaInternal;
    const cssFilename = cssFileOf(module.resource);
    if (!cssLookup.has(cssFilename)) cssLookup.set(cssFilename, css);
  };

  setCssImport(({ id, cssFilename }: CssImportContext) => {
    if (sheetPath) return `\nimport ${JSON.stringify(`${sheetPath}?sheet`)};`;
    let rel = path.relative(path.dirname(id), cssFilename).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return `\nimport "${rel}?t=${Date.now()}";`;
  });

  plugin.transformInclude = (id: string) => {
    const [pathId] = id.split('?', 1);
    return (
      /\.(ts|tsx|js|jsx)$/.test(pathId) &&
      (!pathId.includes('node_modules') ||
        plugin.__plumeriaInternal.inSource(pathId)) &&
      !pathId.endsWith('.html')
    );
  };

  plugin.loadInclude = (id: string) => {
    const [pathId] = id.split('?', 1);
    return pathId.endsWith('.zero.css');
  };

  plugin.resolveId = function (id: string, importer?: string) {
    const [pathId, query] = id.split('?');
    const { cssLookup } = plugin.__plumeriaInternal;

    if (sheetPath && pathId === sheetPath) {
      return query ? `${sheetPath}?${query}` : sheetPath;
    }

    if (pathId.endsWith('.zero.css')) {
      let resolvedAbsolute: string | null = null;

      if (cssLookup.has(pathId)) {
        resolvedAbsolute = pathId;
      } else if (importer) {
        const resolved = path
          .resolve(path.dirname(importer), pathId)
          .replace(/\\/g, '/');
        if (cssLookup.has(resolved)) {
          resolvedAbsolute = resolved;
        }
      }

      if (resolvedAbsolute) {
        return query ? `${resolvedAbsolute}?${query}` : resolvedAbsolute;
      }
    }
    return plugin.__plumeriaInternal.resolveSource(id);
  };

  plugin.load = function (this: any, id: string) {
    const [pathId] = id.split('?', 1);
    const { cssLookup, targets } = plugin.__plumeriaInternal;

    if (isSheet(pathId)) return { code: sheetCss(), moduleType: 'css' };

    const sourceTarget = targets.find(
      (t: any) =>
        `${t.id.replace(/\.(ts|tsx|js|jsx)$/, '')}.zero.css` === pathId,
    );
    if (sourceTarget && typeof this.addDependency === 'function') {
      this.addDependency(sourceTarget.id);
    }

    const css = cssLookup.get(pathId);
    if (css == null) return null;

    return { code: css, moduleType: 'css' };
  };

  const hookFn = function (this: any, compiler: any) {
    if (compiler.isChild()) return;
    const host = this;
    plugin.webpack?.(compiler);

    setRoot(compiler.context);
    if (compiler.options.mode === 'development') {
      setDev(true);
    } else {
      sheetPath = path.join(compiler.context, SHEET_NAME).replace(/\\/g, '/');
      compiler.hooks.thisCompilation.tap(
        '@plumeria/unplugin:sheet',
        (compilation: any) => {
          compilation.hooks.finishModules.tapAsync(
            '@plumeria/unplugin:sheet',
            (modules: Iterable<any>, callback: (error?: Error) => void) => {
              const list = [...modules];
              list.forEach(restoreModuleCss);
              const sheets = list.filter(
                (module) => module.resource && isSheet(module.resource),
              );
              Promise.all(
                sheets.map(async (sheet) => {
                  if (host?.__vfs && !fs.existsSync(sheet.resource)) {
                    await host.__vfs.writeModule(sheet.resource, '');
                  }
                  await new Promise<void>((resolve, reject) =>
                    compilation.rebuildModule(sheet, (error: Error | null) =>
                      error ? reject(error) : resolve(),
                    ),
                  );
                }),
              ).then(() => callback(), callback);
            },
          );
        },
      );
    }
    const rules = compiler.options.module?.rules;

    if (rules && Array.isArray(rules)) {
      const cssRule = rules.find(
        (rule: any) =>
          rule &&
          rule.test &&
          rule.test instanceof RegExp &&
          rule.test.test('test.css'),
      );

      if (cssRule) {
        rules.unshift({
          ...cssRule,
          test: VIRTUAL_CSS_PATH,
          type: 'css/auto',
          enforce: 'pre',
        });
      } else {
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i] as any;
          if (
            rule &&
            rule.type === 'javascript/auto' &&
            Array.isArray(rule.use) &&
            rule.use.some(
              (u: any) => u?.loader && String(u.loader).includes('load.mjs'),
            )
          ) {
            const origInclude = rule.include;
            rule.include = (id: string) => {
              if (VIRTUAL_CSS_PATH.test(id)) return false;
              return typeof origInclude === 'function' ? origInclude(id) : true;
            };

            rules.unshift({
              include: (id: string) => {
                if (!VIRTUAL_CSS_PATH.test(id)) return false;
                return typeof origInclude === 'function'
                  ? origInclude(id)
                  : true;
              },
              enforce: rule.enforce,
              use: rule.use,
              type: 'css/auto',
            });
            break;
          }
        }
      }
    }
  };

  return {
    ...plugin,
    webpack: hookFn,
    rspack: hookFn,
  };
}

export default createWebpackPlugin<PluginOptions | undefined>(
  /* istanbul ignore next -- The callback is exercised through attachWebpackHooks. */
  (options, meta) => {
    return attachWebpackHooks(unpluginFactory(options, meta));
  },
);
