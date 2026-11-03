---
'@plumeria/eslint-plugin': patch
'@plumeria/init': patch
---

- Feat: opt-in `no-use-in-jsx` rule that disallows `css.use()` in `.jsx` and `.tsx` files, so the styling prop is the one way to apply styles there
- Feat: init asks whether `.jsx` and `.tsx` files apply styles only through the styling prop, and turns on `no-use-in-jsx` unless told otherwise with `--allow-use`
