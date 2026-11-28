---
'@plumeria/compiler': patch
'@plumeria/utils': patch
---

- Perf: Merge complementary branches on a stable condition into one class.
- Perf: Write the style selected by a stable condition directly.
- Perf: Read a module-level const after its declaration as stable.
- Perf: Evaluate the style steps in style when the class reads only stable conditions.
- Perf: Evaluate unused bound tests in a sequence instead of a helper.
- Perf: Read a stable argument in place even when a unit is added.
- Perf: Read a single leading test in place instead of a helper.
- Perf: Drop an overridden className or style written next to sx.
- Perf: Write a style guarded by `&&` on a stable condition directly, without a temporary.
- Perf: Write relayed variables of a stable call into each branch instead of copying a temporary.
- Perf: Fold static classes into a single lookup table so the receiving component joins no class strings at runtime.
- Refactor: Drop the parentheses around an identifier guard of a direct style.
