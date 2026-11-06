---
'@plumeria/core': major
'@plumeria/compiler': major
'@plumeria/utils': major
'@plumeria/eslint-plugin': major
'@plumeria/init': major
'@plumeria/codemod': major
'@plumeria/inspector': major
'@plumeria/next-plugin': major
---

- Update: the default styling prop is `sx` instead of `classStyle`, in the compiler, the bundler plugins, the ESLint rules, `@plumeria/init` and the codemod transforms; run `npx @plumeria/codemod rename-prop classStyle sx` to move a codebase over, or keep the old name with `styleProp: 'classStyle'`
- Update: replace `@plumeria/core/class-style` with `@plumeria/core/sx` to declare `sx` on React's `HTMLAttributes` and `SVGAttributes`
- Update: remove bidirectional CSS Modules migration and its round-trip checks
- Feat: add a codemod to migrate Plumeria imports and dependencies to TypedCSS
- Fix: preserve marker declarations when merging pseudo selectors
- Fix: use optional mapped keys for nested style namespaces
- Update: exclude system colors from generated CSS color types
