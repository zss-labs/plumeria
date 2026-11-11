## Advanced APIs

### `css.marker()` and `css.extended()` (paired descendant styling)

These paired APIs enable context-aware styling (e.g. styling a child when the parent is hovered) without naming a DOM path:

- **`css.marker(id, pseudo)`** — sets a CSS variable marker on the parent when the pseudo state is active. MUST be spread into the parent style: `...css.marker(...)`.
- **`css.extended(id, pseudo)`** — applies styles to descendants while the linked marker is active. Used as a computed key: `[css.extended(...)]`.

```tsx
import * as css from '@plumeria/core';

const styles = css.create({
  parent: {
    // 1. Set a marker with the unique id 'card' for the ':hover' state
    ...css.marker('card', ':hover'),
    padding: '24px',
    borderColor: '#ccc',
    borderStyle: 'solid',
    borderWidth: '1px',
  },
  child: {
    transition: 'color 0.3s ease',
    // 2. React to the 'card' marker being active
    [css.extended('card', ':hover')]: {
      color: 'blue',
      // Further pseudo-classes can be nested here
      ':hover': {
        color: 'darkblue',
      },
    },
  },
});

export const Card = () => {
  return (
    <div sx={styles.parent}>
      <span sx={styles.child}>Hover parent to make me blue!</span>
    </div>
  );
};
```

At build time this compiles to an atomic container style query (`@container style(--x1f9k2q1-card-hover: 1)`) — zero runtime overhead, zero dependency on DOM hierarchy.

### `css.createStatic()`

Defines static variables (such as media query strings) that are inlined at build time, typically used as computed keys in `css.create()`:

```tsx
import * as css from '@plumeria/core';

export const breakpoints = css.createStatic({
  xs: '@media (max-width: 480px)',
  sm: '@media (max-width: 640px)',
  md: '@media (max-width: 768px)',
  lg: '@media (max-width: 1024px)',
});

export const styles = css.create({
  container: {
    [breakpoints.sm]: {
      padding: 16,
    },
    [breakpoints.lg]: {
      padding: 32,
    },
  },
});
```

A numeric key, as in a color scale, is quoted: `'500': '#3b82f6'`. An unquoted number stops the build. Read it as `blue[500]` or `blue['500']`.

### `css.createTheme()`

Defines scoped CSS variables for themes. First argument: the selector that activates the theme. Second argument: an object of `{ default, theme }` value pairs. Generated variable names are prefixed with a unique hash, so name collisions are impossible. Theme values are only compiled when actually used in a styling block.

```tsx
import * as css from '@plumeria/core';

// Class-based theme
export const theme = css.createTheme('.dark', {
  text: {
    default: '#333',
    theme: '#eaeaea',
  },
  background: {
    default: 'white',
    theme: 'black',
  },
});

// Attribute selectors and media queries are also supported:
// css.createTheme('[data-theme="dark"]', { ... });
// css.createTheme('@media (prefers-color-scheme: dark)', { ... });
```

### `css.keyframes()`

Generates a unique `@keyframes` animation name (a hash inlined at build time) for use inside style rules:

```tsx
import * as css from '@plumeria/core';

const fadeIn = css.keyframes({
  from: {
    opacity: 0,
  },
  to: {
    opacity: 1,
  },
});

const styles = css.create({
  card: {
    transition: 'transform 0.3s ease',
    ':hover': {
      animationName: fadeIn,
      animationDuration: '0.5s',
    },
  },
});
```

### `css.viewTransitionClass()`

Generates a unique `view-transition-class`, accepting animation definitions (`group`, `imagePair`, `new`, `old`) to customize View Transitions. Pass it to the `default`, `enter`, `exit`, `update` or `share` prop of React's `<ViewTransition>`, or set it with `viewTransitionClass` in `css.create`. The rules are emitted only for those two uses, so pass it to `<ViewTransition>` directly rather than through a wrapper component:

```tsx
import * as css from '@plumeria/core';

const fadeIn = css.keyframes({
  from: {
    opacity: 0,
  },
  to: {
    opacity: 1,
  },
});

const fadeOut = css.keyframes({
  from: {
    opacity: 1,
  },
  to: {
    opacity: 0,
  },
});

const longCrossFade = css.viewTransitionClass({
  old: {
    animationName: fadeOut,
    animationDuration: '1.2s',
  },
  new: {
    animationName: fadeIn,
    animationDuration: '1.2s',
  },
});

// React usage:
// <ViewTransition default={longCrossFade}>...</ViewTransition>
// <ViewTransition name={`photo-${id}`} share={longCrossFade}>...</ViewTransition>
```

### `css.varType()`

Registers a typed custom property with `@property` and returns its name. Use it as a key to set the value and inside `var()` to read it. `initialValue` is required for every `syntax` but `'*'`, and must not depend on where it is used (no `em`, `rem`, container units or `var()`):

```tsx
import * as css from '@plumeria/core';

const angle = css.varType({
  syntax: '<angle>',
  initialValue: '0deg',
});

export const styles = css.create({
  ring: {
    background: `conic-gradient(from var(${angle}), red, blue)`,
    transition: `${angle} 0.6s ease`,
    ':hover': {
      [angle]: '180deg',
    },
  },
});
```

### `css.positionTry()`

Defines an `@position-try` rule and returns its dashed name for `positionTryFallbacks`. It only accepts `positionAnchor`, `positionArea`, inset, margin, sizing and self-alignment properties:

```tsx
import * as css from '@plumeria/core';

const above = css.positionTry({
  positionArea: 'top',
  marginBottom: 8,
});

export const styles = css.create({
  tooltip: {
    position: 'absolute',
    positionAnchor: '--trigger',
    positionArea: 'bottom',
    positionTryFallbacks: `${above}, flip-inline`,
  },
});
```
