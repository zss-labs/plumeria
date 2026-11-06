import 'preact';
import type { Style } from '@plumeria/core';

declare module 'preact' {
  namespace JSX {
    interface HTMLAttributes {
      sx?: Style;
    }
    interface SVGAttributes {
      sx?: Style;
    }
  }
}
