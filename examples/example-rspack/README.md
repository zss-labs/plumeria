# example-rspack

A minimal Plumeria example using Rspack, through `@plumeria/unplugin`.

## Run

From the repository root, install once:

```sh
pnpm install
```

Then in this directory:

```sh
pnpm dev
pnpm build
```

## What to look at

- `rspack.config.js` — registers `plumeria.rspack()` with the bundler.
- `src/` — the example app; styles are written with `css.create` and applied with the `sx` prop.
- `plumeria.d.ts` — declares the styling prop.

## Docs

- [Rspack integration](https://plumeria.dev/docs/integration/rspack)
- [Installation](https://plumeria.dev/docs/installation)
