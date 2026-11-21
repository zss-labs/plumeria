---
'@plumeria/compiler': patch
'@plumeria/utils': patch
---

- Perf: Resolve conflicting styles with one priority chain per property instead of a table over every combination of conditions.
- Perf: Omit the null prototype from decision tables whose keys only come from the compiler.
- Fix: Evaluate each condition once and in argument order when it feeds several chains.
- Fix: Read the gate of a ternary nested inside `&&` once.
- Fix: Fall back past unregistered keys such as `constructor` and keep a variant named `__proto__` in lookup tables.
