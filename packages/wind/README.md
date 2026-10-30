# @plumeria/wind

Tailwind CSS design values as Plumeria static tokens. It generates no utility classes.

```ts
import * as css from '@plumeria/core';
import { blue, slate, spacing, radius, text, spin, animate } from '@plumeria/wind';

const styles = css.create({
  button: {
    paddingInline: spacing[4],
    fontSize: text.sm,
    color: slate[50],
    backgroundColor: blue[600],
    borderRadius: radius.md,
  },
  loader: {
    animation: `${spin} ${animate.spin}`,
  },
});
```

The values are compiled into your styles at build time, so the package adds nothing to your bundle.

The values are taken from Tailwind CSS v4.3.3 (MIT). See [LICENSE-tailwindcss](./LICENSE-tailwindcss).
