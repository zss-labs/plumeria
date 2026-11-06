import '@solidjs/web';
import type { Style } from '@plumeria/core';

declare module '@solidjs/web' {
  namespace JSX {
    interface HTMLAttributes<T> {
      sx?: Style;
    }
    interface SVGAttributes<T> {
      sx?: Style;
    }
  }
}
