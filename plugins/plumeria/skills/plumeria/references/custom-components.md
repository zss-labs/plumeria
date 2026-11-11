## Styling Custom Components

There are exactly **2 patterns** for applying Plumeria styles to custom components. In both, compilation happens at the `sx` call sites; the component itself just passes the compiled `className` / `style` through to the DOM.

> **Core principle**: Custom props typed as `Style` are statically traced by the compiler, so styles pass seamlessly across component boundaries.

### Pattern 1: Direct `sx` inside the component

The component imports its own styles and applies them internally. Simplest pattern — fully self-contained:

```tsx
import React from 'react';
import * as css from '@plumeria/core';

const styles = css.create({
  button: {
    padding: '10px',
    color: '#fff',
    cursor: 'pointer',
    backgroundColor: 'navy',
    borderColor: 'currentColor',
    borderStyle: 'none',
    borderWidth: 'medium',
    borderRadius: '4px',
  },
});

export const Button = ({ children }: { children: React.ReactNode }) => {
  return (
    // The compiler transforms sx → className here
    <button sx={styles.button}>
      {children}
    </button>
  );
};

// Usage
<Button>Click me</Button>;
```

### Pattern 2: Passing a `Style` prop

A component takes a style through a prop typed as `css.Style`, named either `sx` itself or anything else (e.g. `styleArray`). The compiler reads the component's own parameter list: a prop the component declares is handed the key its lookup table resolves, rather than the class names an element would receive, so the style is traced across the component boundary and applied by the internal element's `sx`. A component the build never scans — one from a dependency — declares nothing the compiler can read, so an `sx` written on it is still resolved to class names at the call site, which is what a component forwarding `className` to its own element needs. Composing as `[styles.text, styleArray]` lets call-site styles override the component's base styles (right-wins — see Core Usage): below, the call site's `fontSize: '24px'` overrides the internal `fontSize: '12px'`.

```tsx
// --- Button.tsx ---
import React from 'react';
import * as css from '@plumeria/core';

type ButtonProps = {
  children: React.ReactNode;
  styleArray?: css.Style;
};

// base style
const styles = css.create({
  text: {
    fontSize: '12px',
  },
});

// Pass styleArray directly to the inner element's sx
export const Button = ({ children, styleArray }: ButtonProps) => {
  return <button sx={[styles.text, styleArray]}>{children}</button>;
};

// --- Usage (call site) ---
import * as css from '@plumeria/core';
import { Button } from './Button';

const styles = css.create({
  primary: {
    padding: '10px',
    color: '#fff',
    backgroundColor: 'navy',
  },
  text: {
    fontSize: '24px',
  },
});

// The compiler traces styleArray and resolves it statically
<Button styleArray={[styles.primary, styles.text]}>Click me</Button>;
```

### Not a pattern: `className={css.use(...)}` on your own element

NEVER resolve styles with `css.use()` to apply them to an element your component renders. `sx` does the same job, and it also carries function keys, which `css.use()` cannot. Pattern 1 or Pattern 2 covers every element you render:

```tsx
// INVALID: sx applies these to an element you render
<button className={css.use(styles.text, styleArray)}>{children}</button>

// VALID
<button sx={[styles.text, styleArray]}>{children}</button>
```

`css.use()` is for the places `sx` cannot reach: a third-party component whose props have no `Style` type, a class name prop with another name such as `overlayClassName`, and templates that are not JSX (Vue, Svelte, Astro). The opt-in `@plumeria/no-use-in-jsx` lint rule reports every `css.use()` in JSX for projects that never need those.

### Anti-pattern: relaying a `Style` prop

A component that receives a `Style` prop MUST apply it — to `sx` or through `css.use()` — on an element it renders. A style prop that is never applied is a build error, which is what happens when it is handed to another component instead.

What decides this is **where the style ends up**, not how many style props a component takes. Passing styles in is always fine:

```tsx
// VALID: every value is a style, so any number of style props is fine
<Layout
  headerStyle={styles.header}
  bodyStyle={styles.body}
  buttonStyle={styles.button}
/>
```

Forwarding one onward instead of applying it is not:

```tsx
// INVALID: headerStyle reaches no element of this component
export const Layout = ({ headerStyle }: { headerStyle?: css.Style }) => {
  return <Header headerStyle={headerStyle} />;
};
```

```
[plumeria] "headerStyle" is a style received through a prop but is never applied
to sx or css.use() here. Apply it on an element this component renders;
a style prop cannot be passed on to another component.
```

Write one of these instead:

```tsx
// VALID: Apply it on an element this component renders
export const Layout = ({ headerStyle }: { headerStyle?: css.Style }) => {
  return <header sx={[styles.base, headerStyle]}>...</header>;
};

// VALID: Or drop the middle component and style the one that owns the element
<Header headerStyle={[styles.base, styles.primary]} />;
```

Merging under a base style — `[styles.base, headerStyle]` — is the supported shape. What is rejected is the *relay*: a prop that is only forwarded, never applied.

A received style also cannot go through `sx` to a component that declares `sx`, even from another file and even when the same style is applied to an element as well:

```tsx
// INVALID: Header declares sx
export const Layout = ({ sx }: { sx?: css.Style }) => {
  return <Header sx={[styles.base, sx]} />;
};
```

```
[plumeria] "sx" is a style received through a prop and cannot be passed on
to a component that declares sx. Apply it on an element this component renders.
```

A component the build never scans declares nothing, so a received style composes onto it and resolves to class names at the call site:

```tsx
// VALID: Dialog.Trigger comes from @plumeria/headlessui, a dependency
export const OpenButton = ({ sx }: { sx?: css.Style }) => {
  return <Dialog.Trigger sx={[styles.base, sx]}>Open</Dialog.Trigger>;
};
```

So the valid call site above stays valid only while `Layout` applies all three props itself. If it routes them onward to a grandchild, each unapplied prop is an error — which is the signal that the styles belong on the components that own those elements.

Prop drilling is an anti-pattern in React on its own terms; here it is also unresolvable, because the compiler would have to trace a style across an arbitrary chain of wrappers to build the lookup table. Rejecting it keeps the boundary decidable and the generated CSS exact.

### Summary

| Pattern | Compilation site | Component's role |
|---------|-----------------|-----------------|
| 1. Direct `sx` | Inside the component | Self-contained styles |
| 2. `Style` prop | Traced and compiled | Receives and applies `Style` |

In both patterns the component **applies** the style it receives. None of them forward it.
