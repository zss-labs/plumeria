---
'@plumeria/core': patch
---

- Perf: Check the `classStyle` prop against a lighter type and map created styles without a conditional wrapper, so type checking spends about 12% less time on files with many styles
