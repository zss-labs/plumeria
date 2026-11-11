# @plumeria/core

![License](https://img.shields.io/badge/License-MIT-10B981)
![npm](https://img.shields.io/npm/v/@plumeria/core?&color=10B981)

![Web](https://img.shields.io/badge/Web-atomic-6366F1?logo=npm&logoColor=white)
![Types](https://img.shields.io/badge/Types-100%25-6366F1?logo=npm&logoColor=white)
![Runtime](https://img.shields.io/badge/Runtime-never-6366F1?logo=npm&logoColor=white)

**Plumeria** is a React styling library for reliable interfaces. When styles are combined in an array, the one on the right wins, not the one imported or loaded last: the compiler merges styles at build time, and an overridden property never reaches the element. What ships is class names and CSS. A value the compiler cannot resolve stops the build until it is fixed.

> The compiler is written in Rust with oxc, so builds are fast — see the [benchmark](https://github.com/refirst11/css-compiler-bench). The CSS types and the property list the linter checks against are both generated from MDN data.

## Installation

```sh
npx @plumeria/init
```

It detects the bundler and the package manager, installs the packages, and writes the configs.

To set up by hand, three pieces are needed:

- `@plumeria/core`, which contains type definitions only. Every import is compiled away, so it is a dev dependency.
- A bundler integration that compiles the styles at build time — [`@plumeria/next-plugin`](https://www.npmjs.com/package/@plumeria/next-plugin) for Next.js, or [`@plumeria/unplugin`](https://www.npmjs.com/package/@plumeria/unplugin) for Vite, Webpack, and others.
- One declaration file naming the JSX prop that carries styles — see [Declaring the styling prop](#declaring-the-styling-prop).

```sh
pnpm add -D @plumeria/core
```

See the [installation guide](https://plumeria.dev/docs/installation) for full setup, and [`@plumeria/eslint-plugin`](https://www.npmjs.com/package/@plumeria/eslint-plugin) for the linting rules.

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

## Declaring the styling prop

The prop name is a build-time setting — `styleProp` on the bundler plugin — so `@plumeria/core` declares no prop of its own. Baking one in would let the types and the compiler disagree. Add one file to your project naming the prop you compile with.

For the default, `sx`, reference the declaration that ships with the package:

```ts
// plumeria.d.ts
/// <reference types="@plumeria/core/sx" />
```

If you renamed the prop, declare that name on React's attribute interfaces instead. `Style` is the type of anything the prop accepts — a style, a conditional, or an array of them:

```ts
// plumeria.d.ts
import type { Style } from '@plumeria/core';

declare global {
  namespace React {
    interface HTMLAttributes<T> {
      classStyle?: Style
    }
    interface SVGAttributes<T> {
      classStyle?: Style
    }
  }
}
```

```tsx
<div classStyle={[styles.text, active && styles.active]} />
```

Declaration merging is additive, so several names can coexist during a migration. Whichever you declare has to match what the bundler plugin was given — if they disagree the prop type-checks but is never compiled away.

## API Stability

Plumeria publishes frequently. To make that legible, every public API is rated for **future** change likelihood — not past churn.

| Rating | Label      | Meaning                                                     |
| ------ | ---------- | ----------------------------------------------------------- |
| ★★★★★  | **Frozen** | Bug fixes ship continuously. The signature will not change. |
| ★★★★☆  | **Stable** | Additive only. Existing signatures will not move.           |

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

## License

Plumeria is [MIT licensed](https://github.com/zss-labs/plumeria/blob/main/LICENSE).
