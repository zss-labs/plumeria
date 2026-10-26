---
'@plumeria/init': patch
'@plumeria/eslint-plugin': patch
'@plumeria/next-plugin': patch
'@plumeria/unplugin': patch
---

- Fix: write `plumeria.d.ts` into `src/` when the project has one, so a tsconfig that includes only `src`, such as the Vite React template, reads the `classStyle` declaration
- Fix: `expand-border-shorthands` writes the longhands in the order `sort-properties` expects, so a single `oxlint --fix` pass settles both rules
- Fix: `sort-properties` keeps the trailing comma and moves each property's comments with it when it reorders an object
