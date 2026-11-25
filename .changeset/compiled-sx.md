---
'@plumeria/compiler': patch
'@plumeria/core': patch
'@plumeria/utils': patch
---

- Perf: Compile dynamic sx arguments with local temporaries and shared helpers, preserving evaluation order.
- Perf: Emit a shared class once when both branches of a condition select it.
- Fix: Resolve marker, extended, and function keys through their import bindings and respect shadowed names.
- Update: Show the current compiled output in the core README.
