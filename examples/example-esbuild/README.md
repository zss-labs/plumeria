# example-esbuild

A minimal Plumeria example using esbuild, through `@plumeria/unplugin`.

## Run

From the repository root, install once:

```sh
pnpm install
```

Then in this directory:

```sh
pnpm build
```

This runs `node build.js` and writes the bundle to `dist/bundle.js`.

## What to look at

- `build.js` — registers `plumeria.esbuild()` with the bundler.
- `src/` — the example app; styles are written with `css.create` and applied with the `sx` prop.
- `plumeria.d.ts` — declares the styling prop.

## Docs

- [esbuild integration](https://plumeria.dev/docs/integration/esbuild)
- [Installation](https://plumeria.dev/docs/installation)
