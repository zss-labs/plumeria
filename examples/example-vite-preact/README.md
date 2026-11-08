# example-vite-preact

A minimal Plumeria example using Vite + Preact, through `@plumeria/unplugin`.

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

- `vite.config.ts` — registers `plumeria.vite()` alongside `@preact/preset-vite` with the bundler.
- `src/` — the example app; styles are written with `css.create` and applied with the `sx` prop.
- `types.d.ts` — declares the `sx` prop on Preact's JSX types.

## Docs

- [Frameworks (Preact on Vite)](https://plumeria.dev/docs/integration/frameworks)
- [Installation](https://plumeria.dev/docs/installation)
