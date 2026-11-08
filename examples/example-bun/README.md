# example-bun

A minimal Plumeria example using Bun, through `@plumeria/unplugin`.

## Run

From the repository root, install once:

```sh
pnpm install
```

Then in this directory:

```sh
pnpm build
```

This runs `bun run build.js`, so Bun must be installed. There is no dev server in this example.

## What to look at

- `build.js` — registers `plumeria.bun()` with the bundler.
- `src/` — the example app; styles are written with `css.create` and applied with the `sx` prop.
- `plumeria.d.ts` — declares the styling prop.

## Docs

- [Bun integration](https://plumeria.dev/docs/integration/bun)
- [Installation](https://plumeria.dev/docs/installation)
