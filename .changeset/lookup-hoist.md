---
'@plumeria/compiler': patch
'@plumeria/utils': patch
---

- Perf: Build each lookup table once per module instead of on every render, including for functions an import cycle calls before the module evaluates.
