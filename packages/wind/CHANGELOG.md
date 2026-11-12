# @plumeria/wind

## 22.0.10

### Patch Changes

- b902845: Bump version to 22.0.10

## 22.0.9

### Patch Changes

- 34134e9: Bump version to 22.0.9

## 22.0.8

### Patch Changes

- 6f46d7f: - Update: stop adding `rimraf .next` before `dev` and `build` on Next.js in init, since a kept `.next` builds safely
  - Update: README of core, unplugin, eslint-plugin, inspector, headlessui, codemod and wind

## 22.0.7

### Patch Changes

- 6b1d5c0: Bump version to 22.0.7

## 22.0.6

### Patch Changes

- 69c3408: Bump version to 22.0.6

## 22.0.5

### Patch Changes

- 1f02fad: Bump version to 22.0.5

## 22.0.4

### Patch Changes

- a0aebf5: Bump version to 22.0.4

## 22.0.3

### Patch Changes

- c6588e0: Bump version to 22.0.3

## 22.0.2

### Patch Changes

- 0e2d23c: Bump version to 22.0.2

## 22.0.1

### Patch Changes

- ba00e3a: Bump version to 22.0.1

## 22.0.0

### Major Changes

- eb43320: Bump version to 22.0.0

### Patch Changes

- Updated dependencies [eb43320]
  - @plumeria/core@22.0.0

## 21.2.7

### Patch Changes

- 83e304f: Bump version to 21.2.7

## 21.2.6

### Patch Changes

- d708d87: Bump version to 21.2.6

## 21.2.5

### Patch Changes

- 40fb1e0: Bump version to 21.2.5

## 21.2.4

### Patch Changes

- 6c025b8: Bump version to 21.2.4

## 21.2.3

### Patch Changes

- 1f5ad12: Bump version to 21.2.3

## 21.2.2

### Patch Changes

- 30cfad5: Bump version to 21.2.2

## 21.2.1

### Patch Changes

- 2089b8a: - Update: use a namespace import in README.md

## 21.2.0

### Minor Changes

- fb82771: - Feat: a package can share its Plumeria definitions as source: when its `exports` point a `plumeria` condition at its TypeScript files, as in `"plumeria": "./src/index.ts"`, an app that lists it in its dependencies reads the definitions it exports, such as `css.createStatic` values, `css.create` styles and `css.keyframes` names, as it reads a local module, including subpath and pattern exports and packages linked from a pnpm store
  - Feat: `@plumeria/wind` provides the Tailwind CSS v4.3.3 design tokens, such as the color palettes, spacing, type scale, radius, shadows and animations, as `css.createStatic` values; each value is compiled into the styles that read it, so the package adds nothing to the bundle
  - Feat: a definition read by name through a namespace import, such as `tokens.blue[500]` after `import * as tokens from './tokens'`, compiles as it does through `import { blue }`; a string key, destructuring, a rest element or the namespace passed as a whole still stops the build and asks for a named import
  - Fix: an import whose names are all compiled away, such as a `css.createStatic` import read only inside `css.create`, is removed from the output, so the bundler no longer resolves or loads that module; an import still read at runtime, rendered as a component or re-exported is kept
  - Fix: reading a module's exports before the first project scan, as `resolveExport` and `resolveExportValue` can, no longer leaves that module out of the scan
  - Fix: `no-combinator` checks only the `css.createStatic` values that start with `:` or `[`, the ones that become a selector when used as a key, so a value with spaces, such as a shadow or a font stack, is no longer reported
  - Update: `no-unknown-css-properties` accepts `fit-tolerance`, `min-size` and `max-size`, from the latest MDN and webref data
