# @plumeria/codemod

Codemods for migrating Plumeria APIs.
No install needed — run it with `npx`.

```sh
npx @plumeria/codemod rename-prop sx classStyle
npx @plumeria/codemod rename-api viewTransition viewTransitionClass
npx @plumeria/codemod migrate-to-typedcss
```

Commit before running, so the rewrite can be reverted with `git checkout`.

## `rename-prop`

Renames the styling prop across your source. The names are arguments, so it
works for any rename, not just default prop:

```sh
npx @plumeria/codemod rename-prop <from> <to> [paths...]
```

| Option        | Effect                                          |
| ------------- | ----------------------------------------------- |
| `-d, --dry-run` | report what would change without writing        |
| `--no-types`  | leave TypeScript declarations untouched         |

Paths default to the current directory. `node_modules`, `dist`, `build`, `out`,
`.next` and `coverage` are skipped.

### What it rewrites

JSX attributes:

```diff
- <div sx={styles.card} />
+ <div classStyle={styles.card} />
```

And property signatures annotated with Plumeria's `Style`, which covers the
global augmentation in your `plumeria.d.ts` as well as your own component props:

```diff
  interface CardProps {
-   sx?: Style;
+   classStyle?: Style;
  }
```

The annotation has to be `Style` for the rename to happen, so an unrelated
interface that happens to use the same key is left alone.

### What it reports instead of rewriting

Where the prop is destructured or read off an object, renaming it would change a
local binding and not just the prop, so those are listed for you to handle:

```
2 occurrence(s) need a manual rename — "sx" is bound to a local name there:
  src/components/Card.tsx:8:12
  src/components/Card.tsx:14:22
```

## After the rename

The rewrite only touches your source. Point the rest of the toolchain at the new
name too:

```js
// next.config.ts / unplugin options
withPlumeria(nextConfig, { styleProp: 'classStyle' });
```

```js
// eslint.config.js
settings: { plumeria: { styleProp: 'classStyle' } }
```

## `rename-api`

Renames a Plumeria API after it has changed its name in a release:

```sh
npx @plumeria/codemod rename-api <from> <to> [paths...]
```

| Option          | Effect                                   |
| --------------- | ---------------------------------------- |
| `-d, --dry-run` | report what would change without writing |

`<to>` has to be an API `@plumeria/core` exports, so a typo is reported instead
of written. Paths default to the current directory, with the same directories
skipped as `rename-prop`.

### What it rewrites

Calls through the namespace or default import of `@plumeria/core`:

```diff
  import * as css from '@plumeria/core';
- const fade = css.viewTransition({ old: { opacity: 0 } });
+ const fade = css.viewTransitionClass({ old: { opacity: 0 } });
```

And named imports, together with every reference to them. An alias keeps its
local name, so only the import changes:

```diff
- import { viewTransition, viewTransition as vt } from '@plumeria/core';
- const fade = viewTransition({ old: { opacity: 0 } });
+ import { viewTransitionClass, viewTransitionClass as vt } from '@plumeria/core';
+ const fade = viewTransitionClass({ old: { opacity: 0 } });
  const slide = vt({ new: { opacity: 1 } });
```

## `migrate-to-typedcss`

Moves a codebase from Plumeria to typedcss:

```sh
npx @plumeria/codemod migrate-to-typedcss [paths...]
```

| Option          | Effect                                   |
| --------------- | ---------------------------------------- |
| `-d, --dry-run` | report what would change without writing |

### What it rewrites

Imports, re-exports, `import()` and `require()` of the packages a project
depends on point at their typedcss counterparts, keeping any subpath:

| Plumeria                  | typedcss                  |
| ------------------------- | ------------------------- |
| `@plumeria/core`          | `@typedcss/css`           |
| `@plumeria/unplugin`      | `@typedcss/unplugin`      |
| `@plumeria/next-plugin`   | `@typedcss/next-plugin`   |
| `@plumeria/eslint-plugin` | `@typedcss/eslint-plugin` |

```diff
- import * as css from '@plumeria/core';
- import typedcss from '@plumeria/unplugin/vite';
+ import * as css from '@typedcss/css';
+ import typedcss from '@typedcss/unplugin/vite';
```

And `withPlumeria` from `@plumeria/next-plugin` becomes `withTypedCSS`, together
with every reference to it. An alias keeps its local name:

```diff
- import { withPlumeria } from '@plumeria/next-plugin';
- export default withPlumeria(nextConfig);
+ import { withTypedCSS } from '@typedcss/next-plugin';
+ export default withTypedCSS(nextConfig);
```

The same packages are swapped in every `package.json` under the paths, keeping
each version range. `@typedcss/css` ships the runtime, so it lands in
`dependencies` even when `@plumeria/core` was a dev dependency:

```diff
  "dependencies": {
+   "@typedcss/css": "^22.0.0",
    "next": "^16.0.0"
  },
  "devDependencies": {
-   "@plumeria/core": "^22.0.0",
-   "@plumeria/next-plugin": "^22.0.0"
+   "@typedcss/next-plugin": "^22.0.0"
  }
```

Nothing is installed for you. The codemod reads your lockfile and prints the
command to run next, such as `pnpm install`.
