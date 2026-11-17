---
'@plumeria/unplugin': patch
'@plumeria/compiler': patch
'@plumeria/utils': patch
---

- Fix: serve one shared stylesheet compiled from the project files when it loads in Vite, Rollup, Rolldown, Farm, esbuild and Bun builds, so media queries from different modules are ordered together and the bundler hashes and processes the CSS it ships.
- Fix: point a webpack or rspack production build at one stylesheet rebuilt after every module, and restore each module's CSS from the cached build info so a cached build keeps its styles.
- Fix: stop a build with an error when a module whose styles go into the shared stylesheet is outside the project root, under `node_modules` or `dist`, or has no file on disk, instead of shipping its classes without their CSS.
- Fix: stop forcing `build.cssCodeSplit` off in Vite so the app's own CSS follows Vite's default splitting.
- Fix: read the build mode from the config Farm passes to the compiler hook so a production build is not switched back to development.
- Fix: reject a lone surrogate in a style value string in `@plumeria/compiler` instead of silently dropping the rule, as keys and template strings already were.
- Fix: reject lone surrogate strings in style keys, values and templates in `@plumeria/utils`, with the same error as the compiler.
- Feat: expose `globFiles` from `@plumeria/compiler` to list the project files as absolute paths.
