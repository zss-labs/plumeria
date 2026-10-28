---
'@plumeria/eslint-plugin': patch
'@plumeria/unplugin': patch
'@plumeria/next-plugin': patch
---

- Fix: `no-unused-keys` treats any non-literal bracket key, such as `styles[item.kind]`, as dynamic access instead of reporting every key as unused
- Fix: `no-unused-keys` recognizes dynamic access that appears before the `css.create` call, such as inside a hoisted function
