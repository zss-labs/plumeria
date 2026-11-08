# example-rolldown

A minimal Plumeria example using Rolldown, through `@plumeria/unplugin`.

## Run

From the repository root, install once:

```sh
pnpm install
```

Then in this directory:

```sh
pnpm build
```

This runs `rolldown -c` and writes the output to `dist/`.

## What to look at

- `rolldown.config.js` — registers `plumeria.rolldown()` with the bundler.
- `src/` — the example app; styles are written with `css.create` and applied with the `sx` prop.
- `plumeria.d.ts` — declares the styling prop.

## Docs

- [Rolldown integration](https://plumeria.dev/docs/integration/rolldown)
- [Installation](https://plumeria.dev/docs/installation)
