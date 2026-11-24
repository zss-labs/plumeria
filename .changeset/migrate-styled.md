---
'@plumeria/migrate': patch
'@plumeria/react': patch
---

- Feat: Move styled-components to `styled` from @plumeria/react, renaming `.ts` and `.js` stylesheets to `.tsx` and `.jsx`
- Feat: Add `--to sx` to keep writing `css.create` and the styling prop for styled-components
- Feat: Hold styled components rendered with `as`, spread from a variable or used as a value, and those with type arguments or a custom element tag
- Update: Say styled components belong in `.tsx` or `.jsx` files in the React README
