import '@builder.io/qwik';
import type { Style } from '@plumeria/core';

declare module '@builder.io/qwik' {
  interface HTMLAttributes extends JSX.HTMLAttributes {
    sx?: Style;
  }
  interface SVGAttributes extends JSX.SVGAttributes {
    sx?: Style;
  }
}
