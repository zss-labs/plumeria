---
'@plumeria/compiler': minor
'@plumeria/utils': minor
'@plumeria/eslint-plugin': minor
'@plumeria/swc-jest': minor
'@plumeria/turbopack-loader': minor
'@plumeria/unplugin': minor
'@plumeria/next-plugin': minor
'@plumeria/wind': minor
---

- Feat: a package can share its Plumeria definitions as source: when its `exports` point a `plumeria` condition at its TypeScript files, as in `"plumeria": "./src/index.ts"`, an app that lists it in its dependencies reads the definitions it exports, such as `css.createStatic` values, `css.create` styles and `css.keyframes` names, as it reads a local module, including subpath and pattern exports and packages linked from a pnpm store
- Feat: `@plumeria/wind` provides the Tailwind CSS v4.3.3 design tokens, such as the color palettes, spacing, type scale, radius, shadows and animations, as `css.createStatic` values; each value is compiled into the styles that read it, so the package adds nothing to the bundle
- Feat: a definition read by name through a namespace import, such as `tokens.blue[500]` after `import * as tokens from './tokens'`, compiles as it does through `import { blue }`; a string key, destructuring, a rest element or the namespace passed as a whole still stops the build and asks for a named import
- Fix: an import whose names are all compiled away, such as a `css.createStatic` import read only inside `css.create`, is removed from the output, so the bundler no longer resolves or loads that module; an import still read at runtime, rendered as a component or re-exported is kept
- Fix: reading a module's exports before the first project scan, as `resolveExport` and `resolveExportValue` can, no longer leaves that module out of the scan
- Fix: `no-combinator` checks only the `css.createStatic` values that start with `:` or `[`, the ones that become a selector when used as a key, so a value with spaces, such as a shadow or a font stack, is no longer reported
- Update: `no-unknown-css-properties` accepts `fit-tolerance`, `min-size` and `max-size`, from the latest MDN and webref data
