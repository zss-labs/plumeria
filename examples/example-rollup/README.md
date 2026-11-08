# example-rollup

A minimal Plumeria example using Rollup, through `@plumeria/unplugin`.

## Run

From the repository root, install once:

```sh
pnpm install
```

Then in this directory:

```sh
pnpm build
```

This runs `rollup -c` and writes the output to `dist/`.

## What to look at

- `rollup.config.js` — registers `plumeria.rollup()` with the bundler.
- `src/` — the example app; styles are written with `css.create` and applied with the `sx` prop.
- `plumeria.d.ts` — declares the styling prop.

## Docs

- [Rollup integration](https://plumeria.dev/docs/integration/rollup)
- [Installation](https://plumeria.dev/docs/installation)
