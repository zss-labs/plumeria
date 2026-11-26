---
'@plumeria/compiler': patch
'@plumeria/eslint-plugin': patch
'@plumeria/react': patch
'@plumeria/utils': patch
---

- Update: Leave className and style written beside sx in place, so an attribute added after them overrides them, instead of merging them.
- Fix: Write a generated attribute that collides with a written one as a spread with a string key, so the output has no duplicate JSX attributes.
- Update: Let the className and style passed to a styled component win over the generated ones.
- Refactor: Take the style prop of a styled component from the element props that core declares.
- Feat: Report className and style passed to a styled component in no-mixed-styling-props, including one imported from another module.
