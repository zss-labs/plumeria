# @plumeria/react

## 22.3.4

### Patch Changes

- 594b324: - Update: Leave className and style written beside sx in place, so an attribute added after them overrides them, instead of merging them.
  - Fix: Write a generated attribute that collides with a written one as a spread with a string key, so the output has no duplicate JSX attributes.
  - Update: Let the className and style passed to a styled component win over the generated ones.
  - Refactor: Take the style prop of a styled component from the element props that core declares.
  - Feat: Report className and style passed to a styled component in no-mixed-styling-props, including one imported from another module.

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

- 25f8700: - Update: Say when to use styled in the README
  - Update: Drop the @plumeria/core side-effect import from the README examples
  - Update: Add styled-components to keywords

## 22.3.0

### Minor Changes

- 7b8bb51: Release @plumeria/react
