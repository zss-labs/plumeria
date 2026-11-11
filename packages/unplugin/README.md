# @plumeria/unplugin

Bundler plugin for Plumeria, built on [unplugin](https://github.com/unjs/unplugin).  
It compiles the styling prop away and emits the project's stylesheet at build time, on every bundler below. For Next.js, use [`@plumeria/next-plugin`](https://www.npmjs.com/package/@plumeria/next-plugin).

## Compatible Bundlers

- [Vite](https://vitejs.dev/)
- [Webpack](https://webpack.js.org/)
- [Rspack](https://www.rspack.dev/)
- [Farm](https://farmfe.org/)
- [Esbuild](https://esbuild.github.io/)
- [Rollup](https://rollupjs.org/)
- [Rolldown](https://rolldown.rs/)
- [Bun](https://bun.sh/)

## Installation

```bash
npm install -D @plumeria/unplugin
# or
yarn add -D @plumeria/unplugin
# or
pnpm add -D @plumeria/unplugin
# or
bun add -D @plumeria/unplugin
```

## How to Use

Import `@plumeria/unplugin` in the configuration file of each bundler, and register it as a plugin by calling the bundler-specific method (`vite()`, `webpack()`, etc.).

### Vite

```js
//vite.config.js
import { defineConfig } from 'vite';
import plumeria from '@plumeria/unplugin';

export default defineConfig({ 
  plugins: [ 
    plumeria.vite(), 
  ],
});
```

### Webpack

```js
// webpack.config.js
import plumeria from '@plumeria/unplugin';

export default { 
  plugins: [ 
    plumeria.webpack(), 
  ],
};
```

### Rspack

```js
// rspack.config.js
import plumeria from '@plumeria/unplugin';

export default  { 
  plugins: [ 
    plumeria.rspack(), 
  ],
};
```

### Farm

```js
// farm.config.js
import { defineConfig } from '@farmfe/core';
import plumeria from '@plumeria/unplugin';

export default defineConfig({ 
  plugins: [ 
    plumeria.farm({ devEmitToDisk: true }), 
  ],
});
```

`devEmitToDisk` writes the stylesheet to a file in development, so Farm's file watcher picks up style changes.

### Esbuild

```js
// build.js
import { build } from 'esbuild';
import plumeria from '@plumeria/unplugin';

build({ 
  entryPoints: ['src/index.tsx'], 
  bundle: true, 
  outfile: 'dist/out.js', 
  plugins: [ 
    plumeria.esbuild(), 
  ],
}).catch(() => process.exit(1));
```

### Rollup

```js
// rollup.config.js
import plumeria from '@plumeria/unplugin';
export default {
  input: 'src/index.tsx',
  plugins: [
    plumeria.rollup(),
  ],
};
```

### Rolldown

```js
// rolldown.config.js
import plumeria from '@plumeria/unplugin';
export default {
  input: 'src/index.tsx',
  plugins: [
    plumeria.rolldown(),
  ],
};
```

### Bun

```js
// build.js
import plumeria from '@plumeria/unplugin';
await Bun.build({
  entrypoints: ['./src/index.tsx'],
  outdir: './dist',
  plugins: [
    plumeria.bun(),
  ],
});
```

### Declaring the styling prop

Then declare the styling prop once in your project. `@plumeria/core` ships no prop declaration of its own, so nothing is accepted on host elements until you do:

```ts
// plumeria.d.ts
/// <reference types="@plumeria/core/sx" />
```

## Options

Options are passed when calling the plugin.

```js
plumeria.vite({
  include: ['**/*.{ts,tsx}'],
  exclude: ['**/node_modules/**'],
  devEmitToDisk: false,
  styleProp: 'classStyle',
});
```

| Option | Default | Description |
| :-- | :-- | :-- |
| `include` | `ts/tsx/js/jsx` | Files to transform. |
| `exclude` | — | Files to skip. |
| `devEmitToDisk` | `false` | Write CSS to disk in development so the bundler's watcher drives HMR. |
| `styleProp` | `'sx'` | The JSX prop that carries styles. |
| `withoutLogicalProperties` | `false` | Reject the logical name of a property that also has a physical name. Takes `true` or `{ sizes?: boolean }`. |
| `withoutPhysicalProperties` | `false` | Reject the physical name of a property that also has a logical name. Takes `true` or `{ sizes?: boolean }`. |
| `lint` | `true` | Lint with `@plumeria/eslint-plugin` during a production build, integrated into the build so it needs no setup. Every bundler except esbuild and Bun. `false` builds without it. |

The two spelling options contradict each other, so enabling both is a configuration error. See [the docs](https://plumeria.dev/docs/api/plugins/unplugin) for why the pair has to be settled and how it lines up with the lint rules.

### styleProp

Renaming the prop takes two steps, and they have to agree. Tell the plugin:

```js
plumeria.vite({ styleProp: 'classStyle' });
```

and declare the same name for TypeScript instead of referencing the default:

```ts
// plumeria.d.ts
import type { Style } from '@plumeria/core';

declare global {
  namespace React {
    interface HTMLAttributes<T> {
      classStyle?: Style
    }
    interface SVGAttributes<T> {
      classStyle?: Style
    }
  }
}
```

If the two disagree, the prop type-checks but is never compiled away. [`@plumeria/eslint-plugin`](https://www.npmjs.com/package/@plumeria/eslint-plugin) reads the same name from `settings.plumeria.styleProp`.

## Development and HMR

- **Vite / Farm / Webpack / Rspack**: a style change reaches the browser through the dev server's HMR.
- **esbuild / Rollup / Rolldown / Bun**: these have no HMR of their own, so styles are recompiled on the next build or watch rebuild.

## License

Plumeria is [MIT licensed](https://github.com/zss-labs/plumeria/blob/main/LICENSE).
