import * as css from '@plumeria/core';
import type { ReactNode } from 'react';

const styles = css.create({
  own: {
    color: 'rgb(128, 0, 128)',
  },
});

export function RelayOrderChild({
  override,
  children,
}: {
  // A class string once `migrate --from plumeria` has exported the caller.
  override?: any;
  children: ReactNode;
}) {
  return (
    <div data-testid="relay-order" classStyle={[styles.own, override]}>
      {children}
    </div>
  );
}
