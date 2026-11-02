---
'@plumeria/compiler': patch
'@plumeria/utils': patch
'@plumeria/unplugin': patch
'@plumeria/eslint-plugin': patch
---

- Fix: a style passed to a default export, or to a component that `memo` or `forwardRef` wraps, is handed to that component and applied
- Fix: the component a call makes is the argument that renders, wherever it sits, so `memo(Component, compare)` and a wrapper that takes options first pass a style on, and a component name the call takes, as in `memo(Inner, compare)`, stands for that component
- Fix: a call with more than one argument that could be the component stops the build with an error when a style is passed to it, instead of guessing which one receives it
- Fix: `no-style-prop-relay` reads the component a call wraps as the compiler does, so it no longer checks a comparator or an options value in place of the component
- Fix: a value read through a call handed a definition, such as `pick(T).w`, is reported as unresolvable instead of being read as the definition
- Fix: a namespace import reads its exports when the file already declares a name such as `t$blue`, and when it sits next to a default import, as in `import def, * as t from './tokens'`
- Fix: the Vite plugin leaves a package that exports only Plumeria source, under a `plumeria` condition with no fallback, out of dependency pre-bundling
- Refactor: namespace reads are resolved on the AST instead of by rewriting the source
