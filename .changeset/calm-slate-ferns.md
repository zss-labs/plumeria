---
'@plumeria/compiler': patch
'@plumeria/utils': patch
'@plumeria/eslint-plugin': patch
'@plumeria/swc-jest': patch
'@plumeria/turbopack-loader': patch
'@plumeria/unplugin': patch
'@plumeria/next-plugin': patch
---

- Fix: an import whose bindings are only used by styles that compile into class names becomes a side-effect import, such as `import './tokens'`, so the module's side effects still run without leaving unused bindings behind
