# @plumeria/wind

Tailwind CSS design values as Plumeria static tokens. It generates no utility classes.

```ts
import * as css from '@plumeria/core';
import * as t from '@plumeria/wind';

const styles = css.create({
  button: {
    paddingInline: t.spacing[4],
    fontSize: t.text.sm,
    color: t.slate[50],
    backgroundColor: t.blue[600],
    borderRadius: t.radius.md,
  },
  loader: {
    animation: `${t.spin} ${t.animate.spin}`,
  },
});
```

The values are compiled into your styles at build time, so the package adds nothing to your bundle.

The values are taken from Tailwind CSS V4 (MIT).   
See [LICENSE-tailwindcss](./LICENSE-tailwindcss).
