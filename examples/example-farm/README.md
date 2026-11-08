# example-farm

A minimal Plumeria example using Farm, through `@plumeria/unplugin`.

## Run

From the repository root, install once:

```sh
pnpm install
```

Then in this directory:

```sh
pnpm dev
pnpm build
pnpm preview
```

## What to look at

- `farm.config.ts` — registers `plumeria.farm({ devEmitToDisk: true })` alongside the React plugin with the bundler.
- `src/` — the example app; styles are written with `css.create` and applied with the `sx` prop.
- `plumeria.d.ts` — declares the styling prop.

## Docs

- [Farm integration](https://plumeria.dev/docs/integration/farm)
- [Installation](https://plumeria.dev/docs/installation)
