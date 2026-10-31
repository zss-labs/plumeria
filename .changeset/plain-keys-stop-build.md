---
'@plumeria/core': patch
'@plumeria/compiler': patch
'@plumeria/utils': patch
'@plumeria/codemod': patch
---

- Fix: a computed key the build cannot inline, such as `[MOBILE]` read from a plain module, stops the build and points at `css.createStatic` instead of dropping the rule without an error
- Fix: a spread of a function call, such as `...mixin()`, stops the build instead of dropping what it returns without an error
- Fix: a shorthand holding a runtime value, such as `{ margin }`, stops the build like the same property written out instead of dropping the declaration without an error
- Fix: a shorthand holding `css.keyframes`, such as `{ animationName }`, compiles like the same property written out
- Fix: a method or an accessor in a style, such as `get margin() { ... }`, stops the build instead of dropping the declaration without an error
- Fix: `migrate --from plumeria` joins a `classStyle` list member it cannot name, such as a prop, as a class string, instead of exporting the styles and leaving a list that no longer builds
- Update: lead README.md with what decides the winning style
