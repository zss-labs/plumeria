**@plumeria/react** adds `styled` to [Plumeria](https://www.npmjs.com/package/@plumeria/core). Use it for components whose job is to carry styles: a button, a text field, a layout primitive that the rest of the app reuses and extends for each use. When a component has its own logic and you only need to style part of what it renders, pass a `css.create` style to `sx` instead.

At build time, the compiler first rewrites a styled definition using `css.create` and the configured style prop (`sx` by default). Plumeria then compiles those styles as usual.

## Installation

```sh
pnpm add -D @plumeria/react
```

`@plumeria/react` contains type definitions only. It needs `@plumeria/core` and a bundler integration — see the [installation guide](https://plumeria.dev/docs/installation).

## Example

Define a styled element at module scope and use it with the native element's props.

```tsx
import { styled } from '@plumeria/react';

export const Button = styled.button({
  padding: '8px',
  color: 'navy',
});

export function SaveButton() {
  return <Button type="submit">Save</Button>;
}
```

## Values from props

Read a prop directly in a style value. Its parameter type tells TypeScript which props the component requires.

```tsx
import { styled } from '@plumeria/react';

const Swatch = styled.div({
  width: '40px',
  height: '40px',
  backgroundColor: (props: { fill: string }) => props.fill,
});

export function ColorPreview({ color }: { color: string }) {
  return <Swatch fill={color} aria-label={color} role="img" />;
}
```

The compiler passes `fill` to the element through a CSS variable and omits the `fill` attribute. For a conditional color, choose the value where you render `Swatch`, for example `<Swatch fill={active ? 'teal' : 'gray'} />`.

## Extending and overriding styles

Styles merge in order from the base component through each extension to the `sx` prop at the call site. When two styles set the same property, the later style wins. Within an `sx` array, the rightmost active style wins.

Here, `DeleteButton` keeps the padding from `Button` and changes its color to maroon. When `urgent` is true, `sx` changes the color to red.

```tsx
import * as css from '@plumeria/core';
import { styled } from '@plumeria/react';
import { Button } from './Button';

const DeleteButton = styled(Button)({
  color: 'maroon',
});

const styles = css.create({
  urgent: {
    color: 'red',
  },
});

export function DeleteAction({ urgent }: { urgent: boolean }) {
  return (
    <DeleteButton type="button" sx={[urgent && styles.urgent]}>
      Delete
    </DeleteButton>
  );
}
```

A chain can be up to 16 levels deep.

## Other JSX frameworks

`styled` takes its tags, props and return type from React by default. For Preact, Qwik and others, register the framework's `JSX` types once:

```ts
import type { JSX } from '@builder.io/qwik';

declare module '@plumeria/react' {
  interface JSXRegister {
    IntrinsicElements: JSX.IntrinsicElements;
    Element: JSX.Element;
  }
}
```

## License

Plumeria is [MIT licensed](https://github.com/zss-labs/plumeria/blob/main/LICENSE).
