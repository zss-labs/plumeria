---
'@plumeria/codemod': patch
'@plumeria/compiler': patch
'@plumeria/eslint-plugin': patch
---

- Feat: Add the `use-to-prop` codemod to migrate `className={css.use(...)}` to the styling prop.
- Feat: Expose style objects in compiler scan results and detect order-dependent overlaps between styles composed across modules.
