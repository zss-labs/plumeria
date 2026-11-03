---
'@plumeria/compiler': patch
'@plumeria/unplugin': patch
'@plumeria/turbopack-loader': patch
'@plumeria/next-plugin': patch
'@plumeria/eslint-plugin': patch
---

- Fix: resolve and compile component source from packages exposing the plumeria condition
- Fix: full-reload when a prop-driven update reaches a module that cannot accept it
- Fix: keep node_modules out of the lint guard
- Feat: `sourcePackages()` in the compiler lists the packages exposing the plumeria condition, so the bundler plugins share the compiler's discovery instead of scanning dependencies themselves
