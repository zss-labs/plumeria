# example-webpack

A minimal Plumeria example using webpack, through `@plumeria/unplugin`.

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

- `webpack.config.js` — registers `plumeria.webpack()` with the bundler.
- `src/` — the example app; styles are written with `css.create` and applied with the `sx` prop.
- `plumeria.d.ts` — declares the styling prop.

## Docs

- [webpack integration](https://plumeria.dev/docs/integration/webpack)
- [Installation](https://plumeria.dev/docs/installation)
