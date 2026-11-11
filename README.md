# Plumeria

[![OpenSSF Best Practices](https://img.shields.io/cii/level/15164?label=openssf&color=10B981)](https://www.bestpractices.dev/projects/15164)
[![Tests](https://img.shields.io/github/actions/workflow/status/zss-labs/plumeria/tests.yml?logo=github&logoColor=white&label=tests&color=10B981)](https://github.com/zss-labs/plumeria/actions/workflows/tests.yml)
![Codecov](https://img.shields.io/codecov/c/github/zss-labs/plumeria?logo=codecov&logoColor=white&color=6366F1)

**Plumeria** is a React styling library for reliable interfaces. When styles are combined in an array, the one on the right wins, not the one imported or loaded last: the compiler merges styles at build time, and an overridden property never reaches the element. What ships is class names and CSS. A value the compiler cannot resolve stops the build until it is fixed.

> The compiler is written in Rust with oxc, so builds are fast — see the [benchmark](#benchmark). The CSS types and the property list the linter checks against are both generated from MDN data.

## Example

Pass styles to the `sx` prop as an array of static and dynamic styles. At build time, the compiler resolves `sx` into a static `className`; dynamic values are passed as CSS variables through the `style` attribute — no runtime library is involved.

```tsx
import * as css from '@plumeria/core';

const styles = css.create({
  text: {
    fontSize: 12,
    color: 'gray'
  },
  active: {
    color: 'navy'
  },
  scale: (value) => ({
    scale: value
  })
});

export default function App({ active }) {
  const scale = useScale(); // from your own hook
  return (
    <div
      sx={[
        styles.text,
        active && styles.active,
        styles.scale(scale)
      ]}
    />
  );
}
```

**Compiled:**

```tsx
<div
  className={
    'xhrr6ses xhxthtyw' +
    ' ' +
    ({ '0': 'xuifcaas', '1': 'xvbwmxqp' }[active ? '1' : '0'] || 'xuifcaas')
  }
  style={{ '--xfuma1qq-value': scale }}
/>
```

**Generated CSS:**

```css
.xhrr6ses:not(#\#) {
  font-size: 12px;
}
.xuifcaas {
  color: gray;
}
.xhxthtyw {
  scale: var(--xfuma1qq-value);
}
.xvbwmxqp {
  color: navy;
}
```

`text` and `active` both set `color`, and the element only ever receives one of the two classes: the merge is already decided in the compiled `className`. The `:not(#\#)` on `font-size` ranks a longhand above its shorthand without depending on stylesheet order — see [Specificity](https://plumeria.dev/docs/specificity).

Explore the [documentation](https://plumeria.dev/) for the core principles, full API reference, and integrations.

## Getting started

```sh
npx @plumeria/init
```

It detects the bundler and the package manager, asks what it cannot detect — which spelling of a two-named property the project writes, what the styling prop is called, whether `.jsx`/`.tsx` files apply styles only through the styling prop, and whether to set up ESLint — then installs the packages and writes the configs. It shows the plan before writing anything.

## Benchmark

For how Plumeria compares with other libraries, see the [side-by-side benchmark](https://github.com/refirst11/css-compiler-bench).

## API Stability

Plumeria publishes frequently. To make that legible, every public API is rated for **future** change likelihood — not past churn.

| Rating | Label         | Meaning                                                     |
| ------ | ------------- | ----------------------------------------------------------- |
| ★★★★★  | **Frozen**    | Bug fixes ship continuously. The signature will not change. |
| ★★★★☆  | **Stable**    | Additive only. Existing signatures will not move.           |
| ★★★☆☆  | **Candidate** | Shape is settled. Details may still change.                 |

### Core API — `@plumeria/core`

| API                       | Rating | Label  |
| ------------------------- | ------ | ------ |
| `css.create`              | ★★★★★  | Frozen |
| `css.createTheme`         | ★★★★★  | Frozen |
| `css.createStatic`        | ★★★★★  | Frozen |
| `css.keyframes`           | ★★★★★  | Frozen |
| `css.viewTransitionClass` | ★★★★★  | Frozen |
| `css.positionTry`         | ★★★★☆  | Stable |
| `css.varType`             | ★★★★☆  | Stable |
| `css.marker`              | ★★★★☆  | Stable |
| `css.extended`            | ★★★★☆  | Stable |
| `css.use`                 | ★★★★★  | Frozen |

### Bundler Integrations

| Package                      | Rating | Label  |
| ---------------------------- | ------ | ------ |
| `@plumeria/next-plugin`      | ★★★★☆  | Stable |
| `@plumeria/unplugin`         | ★★★★☆  | Stable |
| `@plumeria/turbopack-loader` | ★★★★☆  | Stable |

### Tooling

| Package                   | Rating | Label     |
| ------------------------- | ------ | --------- |
| `@plumeria/init`          | ★★★★☆  | Stable    |
| `@plumeria/codemod`       | ★★★☆☆  | Candidate |
| `@plumeria/eslint-plugin` | ★★★★☆  | Stable    |
| `@plumeria/headlessui`    | ★★★★☆  | Stable    |
| `@plumeria/inspector`     | ★★★☆☆  | Candidate |
| `@plumeria/swc-jest`      | ★★★★☆  | Stable    |
| `@plumeria/wind`          | ★★★★☆  | Stable    |

### Internal

| Package              | Rating | Label  |
| -------------------- | ------ | ------ |
| `@plumeria/compiler` | ★★★★☆  | Stable |
| `@plumeria/utils`    | ★★★★☆  | Stable |

## Not planned

A predefined utility atom vocabulary, a runtime style merger, and fallback chains are not planned. The compiler resolves every style at build time from the definitions it can see, and none of the three fits that model. For one-off styles, give them a local name in `css.create` — the naming requirement is deliberate.

`@plumeria/wind` provides design values as static tokens, not a utility atom vocabulary.

## Structure

Every package is released under the same version.

- `.github`
  - Contains workflows used by GitHub Actions.
  - Contains other templates.
- `examples`
  - Example applications using Plumeria.
- `packages`
  - Contains the individual packages managed in the monorepo.
  - [codemod](https://github.com/zss-labs/plumeria/tree/main/packages/codemod)
  - [compiler](https://github.com/zss-labs/plumeria/tree/main/packages/compiler)
  - [core](https://github.com/zss-labs/plumeria/tree/main/packages/core)
  - [eslint-plugin](https://github.com/zss-labs/plumeria/tree/main/packages/eslint-plugin)
  - [headlessui](https://github.com/zss-labs/plumeria/tree/main/packages/headlessui)
  - [init](https://github.com/zss-labs/plumeria/tree/main/packages/init)
  - [inspector](https://github.com/zss-labs/plumeria/tree/main/packages/inspector)
  - [next-plugin](https://github.com/zss-labs/plumeria/tree/main/packages/next-plugin)
  - [swc-jest](https://github.com/zss-labs/plumeria/tree/main/packages/swc-jest)
  - [turbopack-loader](https://github.com/zss-labs/plumeria/tree/main/packages/turbopack-loader)
  - [unplugin](https://github.com/zss-labs/plumeria/tree/main/packages/unplugin)
  - [utils](https://github.com/zss-labs/plumeria/tree/main/packages/utils)
  - [wind](https://github.com/zss-labs/plumeria/tree/main/packages/wind)
- `test-e2e`
  - Contains e2e tests built with Playwright and Next.js for final quality assurance.

## Contributing

We welcome contributions of all kinds — bug reports, feature ideas, pull requests.

[Contributing Guide](https://github.com/zss-labs/plumeria/blob/main/.github/CONTRIBUTING.md)

## Acknowledgements

- [Linaria](https://linaria.dev/) - for the zero-runtime architecture
- [React Native](https://reactnative.dev/docs/stylesheet) - for the shape of `StyleSheet.create`
- [React Native for Web](https://necolas.github.io/react-native-web/) - for generating atomic CSS from CSS-in-JS
- [StyleX](https://stylexjs.com/) - for the design philosophy Plumeria inherits
- [Tailwind CSS](https://tailwindcss.com/) - for the design values `@plumeria/wind` carries

## License

Plumeria is [MIT licensed](https://github.com/zss-labs/plumeria/blob/main/LICENSE).
