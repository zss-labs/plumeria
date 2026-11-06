import type { Style } from '#types';

declare global {
  namespace React {
    interface HTMLAttributes<T> {
      sx?: Style;
    }
    interface SVGAttributes<T> {
      sx?: Style;
    }
  }
}
