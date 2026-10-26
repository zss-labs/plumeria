---
'@plumeria/compiler': patch
'@plumeria/utils': patch
'@plumeria/eslint-plugin': patch
'@plumeria/swc-jest': patch
'@plumeria/turbopack-loader': patch
'@plumeria/unplugin': patch
'@plumeria/next-plugin': patch
---

- Fix: a dynamic style parameter inside a color, filter or scale function, such as `hsl()`, `brightness()` or `scaleX()`, no longer gets a `px` unit
