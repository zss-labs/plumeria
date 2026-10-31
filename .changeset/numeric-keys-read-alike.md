---
'@plumeria/compiler': patch
'@plumeria/utils': patch
'@plumeria/eslint-plugin': patch
---

- Fix: a `css.createStatic` or `css.createTheme` key read by number, such as `blue[500]`, compiles like `blue['500']`, instead of dropping the declaration without an error in a style imported from another file or in `css.keyframes`, and instead of stopping the build in a template literal, a computed key or the module that defines it
- Fix: a key read through a const, such as `blue[k]` after `const k = '500'`, compiles like the quoted key in a style imported from another file and in the module that defines it
- Fix: the lint rules that read a static value, such as `validate-at-rules`, check `[bp[500]]` as they check `[bp['500']]`
