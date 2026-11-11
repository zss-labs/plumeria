## Migrating from Tailwind CSS

Tailwind's model and Plumeria's do not map one-to-one. A utility-by-utility rewrite produces code that fails to compile, silently breaks, or reads like Tailwind reimplemented. Migrate one component at a time, under three rules.

**Resolve values from the compiled stylesheet, never from memory.** Utility values come from the project's `@theme`, not from a fixed table: `p-4` is `calc(var(--spacing) * 4)`, `text-sm` sets `font-size` *and* a paired `line-height`, and the color scale is whatever the project defines. Build the project and read the declarations out of the emitted CSS.

**NEVER carry a `--tw-*` variable chain across.** `shadow-lg` compiles to `--tw-shadow: …` plus `box-shadow: var(--tw-inset-shadow), …, var(--tw-shadow)`, and those variables hold a value only because Tailwind registers them with `@property`. Copied literally, the declaration is invalid and the shadow disappears. Resolve the chain to its final value instead.

**Where a compiled value is Tailwind's default, read it from `@plumeria/wind`.** The package holds the default theme of Tailwind CSS v4 as `css.createStatic` tokens, and each one compiles into the style that reads it, so nothing reaches the bundle. Install it with `pnpm i -D @plumeria/wind` and import it with `import * as t from '@plumeria/wind'`. It knows nothing of the project's `@theme`, so compare a token with the emitted CSS and keep the emitted value where the two differ. It generates no utility classes, so the key naming below still applies.

| Tailwind | `@plumeria/wind` |
|---|---|
| `p-4` | `padding: t.spacing[4]` |
| `text-sm` | `fontSize: t.text.sm`, `lineHeight: t.textLineHeight.sm` |
| `font-medium` | `fontWeight: t.fontWeight.medium` |
| `bg-blue-500`, `text-white` | `backgroundColor: t.blue[500]`, `color: t.color.white` |
| `rounded-md` | `borderRadius: t.radius.md` |
| `shadow-lg` | `boxShadow: t.shadow.lg`, which holds the resolved value |
| `md:` | `` [`@media (width >= ${t.breakpoint.md})`] ``. The token is a length, so write the query around it; as a key on its own it produces no rule. |
| `animate-spin` | `` animation: `${t.spin} ${t.animate.spin}` `` |

**Name keys after what the element is, not after the utilities it carried.** The class list is the input to the migration, not the output.

```tsx
// INVALID: Tailwind reimplemented — these names carry no more meaning than the class list did
const styles = css.create({
  hoverBgBlue500: {
    ':hover': {
      backgroundColor: '#3b82f6',
    },
  },
  px4: {
    paddingInline: '1rem',
  },
});

// VALID: One key per thing the component has
const styles = css.create({
  submitButton: {
    paddingInline: '1rem',
    backgroundColor: '#2563eb',
    ':hover': {
      backgroundColor: '#3b82f6',
    },
  },
});
```

**Three variants need restructuring rather than translation.** Breakpoints (`md:`) and `data-*` variants map directly, to `@media` and attribute-selector keys. `dark:` depends on the project: it is `@media (prefers-color-scheme: dark)` by default, but `@custom-variant dark` commonly redefines it as a `.dark` class selector — which belongs in the restructuring set below, not the direct one. Check the compiled output before assuming which.

| Tailwind | Compiles to | Write instead |
|---|---|---|
| `hover:`, `focus:` | `&:hover { @media (hover: hover) { … } }` | `':hover': { … }`, dropping the `@media (hover: hover)` wrapper — Plumeria forbids a query inside a pseudo. The styles then apply on touch devices too. |
| `group-*`, `peer-*` | `&:is(:where(.group):hover *)` | `css.marker()` on the parent and `css.extended()` on the descendant. The `.group` / `.peer` class disappears. |
| `space-x-*`, `divide-*` | `:where(& > :not(:last-child))` | The margin or border applied to the children directly — a child combinator is only accepted inside a functional pseudo-class. |

### `tv()` and `twMerge()`

| Tailwind Variants | Plumeria |
|---|---|
| `base` | Static keys in the component's own `css.create()` |
| `variants` | One dedicated `css.create()` per variant group, read with bracket notation (keep these calls minimal — see Bracket notation) |
| `defaultVariants` | Default parameter values |
| `compoundVariants` | An explicit condition in the `sx` array |
| `slots` | One `css.create()` per element, not one call carrying every slot |

**An external `className` override becomes a `Style` prop, not a `className`.** `twMerge(button(...), className)` exists to let the call site win; Pattern 2 does the same job, because array position is right-wins. **NEVER** resolve the override away, force it through `css.use()`, or change the component's public API to avoid the mixing rule.

**NEVER guess a class name that was built at runtime.** A template literal or a value read from props or state is not statically knowable. Leave the component on Tailwind and report it; a guessed utility compiles and is silently wrong.

```tsx
// --- Before ---
const button = tv({
  base: 'inline-flex rounded font-medium',
  variants: {
    size: { sm: 'h-8 px-3 text-sm', lg: 'h-12 px-6 text-lg' },
    tone: { primary: 'bg-blue-500 text-white', danger: 'bg-red-500 text-white' },
  },
  compoundVariants: [{ size: 'lg', tone: 'primary', class: 'shadow-lg' }],
  defaultVariants: { size: 'sm', tone: 'primary' },
});

<button className={twMerge(button({ size, tone }), className)} />;

// --- After (values resolved from the project's compiled CSS, not recalled) ---
const styles = css.create({
  base: {
    display: 'inline-flex',
    fontWeight: 500,
    borderRadius: '4px',
  },
  lgPrimary: {
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  },
});

const sizeStyles = css.create({
  sm: {
    height: '32px',
    paddingInline: '12px',
    fontSize: '14px',
  },
  lg: {
    height: '48px',
    paddingInline: '24px',
    fontSize: '18px',
  },
});

const toneStyles = css.create({
  primary: {
    color: '#fff',
    backgroundColor: '#3b82f6',
  },
  danger: {
    color: '#fff',
    backgroundColor: '#ef4444',
  },
});

type ButtonProps = {
  size?: keyof typeof sizeStyles;
  tone?: keyof typeof toneStyles;
  styleArray?: css.Style;
};

export const Button = ({ size = 'sm', tone = 'primary', styleArray }: ButtonProps) => (
  <button
    sx={[
      styles.base,
      sizeStyles[size],
      toneStyles[tone],
      size === 'lg' && tone === 'primary' && styles.lgPrimary,
      styleArray,
    ]}
  />
);
```

On a project that keeps the default theme, the same two groups read from `@plumeria/wind`:

```tsx
import * as css from '@plumeria/core';
import * as t from '@plumeria/wind';

const sizeStyles = css.create({
  sm: {
    height: t.spacing[8],
    paddingInline: t.spacing[3],
    fontSize: t.text.sm,
    lineHeight: t.textLineHeight.sm,
  },
  lg: {
    height: t.spacing[12],
    paddingInline: t.spacing[6],
    fontSize: t.text.lg,
    lineHeight: t.textLineHeight.lg,
  },
});

const toneStyles = css.create({
  primary: {
    color: t.color.white,
    backgroundColor: t.blue[500],
  },
  danger: {
    color: t.color.white,
    backgroundColor: t.red[500],
  },
});
```
