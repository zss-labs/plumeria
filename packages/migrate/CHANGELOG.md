# @plumeria/migrate

## 22.4.2

### Patch Changes

- 4efe3f9: Bump version to 22.4.2

## 22.4.1

### Patch Changes

- 2bee8c2: Bump version to 22.4.1

## 22.4.0

### Minor Changes

- 49bf156: Bump version to 22.4.0

## 22.3.4

### Patch Changes

- 594b324: Bump version to 22.3.4

## 22.3.3

### Patch Changes

- b0c8583: Bump version to 22.3.3

## 22.3.2

### Patch Changes

- 0d6bb5f: - Feat: Move styled-components to `styled` from @plumeria/react, renaming `.ts` and `.js` stylesheets to `.tsx` and `.jsx`
  - Feat: Add `--to sx` to keep writing `css.create` and the styling prop for styled-components
  - Feat: Hold styled components rendered with `as`, spread from a variable or used as a value, and those with type arguments or a custom element tag
  - Update: Say styled components belong in `.tsx` or `.jsx` files in the React README

## 22.3.1

### Patch Changes

- 25f8700: Bump version to 22.3.1

## 22.3.0

### Minor Changes

- cd31419: Bump version to 22.3.0

## 22.2.5

### Patch Changes

- ae33979: Bump version to 22.2.5

## 22.2.4

### Patch Changes

- 2861ec6: Bump version to 22.2.4

## 22.2.3

### Patch Changes

- db2ffbf: Bump version to 22.2.3

## 22.2.2

### Patch Changes

- cafc969: Bump version to 22.2.2

## 22.2.1

### Patch Changes

- 001350b: - Feat: Migrate named styles and styled components imported from Emotion and styled-components files. Keep shared definitions intact when consumers re-export them or load them dynamically from a fixed path.
  - Update: Skip the side-effect core import when CSS Modules, vanilla-extract, or StyleX consumers use the configured style prop.
  - Fix: Remove leftover blank lines when merging vanilla-extract styles and handle CRLF line endings when removing imports.
  - Fix: Mark the migrate CLI executable.

## 22.2.0

### Minor Changes

- a53916a: - Feat: Add `@plumeria/migrate` for CSS Modules, vanilla-extract, Emotion, styled-components, StyleX, and Tailwind CSS. Preview changes with `--dry-run` and review holds for styles that need manual migration.
  - Update: Pin core to cssdefs 1.0.2 and generate the ESLint property list from the same definitions.
  - Feat: Extend ESLint value validation to every CSSDefs property and suggest corrections for mistyped keywords and kebab-case property names.
  - Update: Remove the `migrate-to-typedcss` codemod and its `migrateToTypedCSS` export.
  - Refactor: Simplify script setup in `@plumeria/init`.
