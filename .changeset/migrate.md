---
'@plumeria/codemod': minor
'@plumeria/core': minor
'@plumeria/eslint-plugin': minor
'@plumeria/init': minor
'@plumeria/migrate': minor
---

- Feat: Add `@plumeria/migrate` for CSS Modules, vanilla-extract, Emotion, styled-components, StyleX, and Tailwind CSS. Preview changes with `--dry-run` and review holds for styles that need manual migration.
- Update: Pin core to cssdefs 1.0.2 and generate the ESLint property list from the same definitions.
- Feat: Extend ESLint value validation to every CSSDefs property and suggest corrections for mistyped keywords and kebab-case property names.
- Update: Remove the `migrate-to-typedcss` codemod and its `migrateToTypedCSS` export.
- Refactor: Simplify script setup in `@plumeria/init`.
