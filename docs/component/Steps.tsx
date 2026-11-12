import * as css from '@plumeria/core';
import type { ReactNode } from 'react';
import { homeTheme } from 'lib/theme';

const sm = '@media (min-width: 640px)';

const styles = css.create({
  steps: {
    position: 'relative',
    paddingLeft: 24,
    marginLeft: 8,
    counterReset: 'step',
    borderLeftColor: homeTheme.border,
    borderLeftStyle: 'solid',
    borderLeftWidth: 1,
    [sm]: {
      paddingLeft: 28,
      marginLeft: 16,
    },
  },
  step: {
    '::before': {
      position: 'absolute',
      left: -16,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 32,
      height: 32,
      fontSize: '0.875rem',
      lineHeight: '1.25rem',
      color: homeTheme.foreground,
      content: 'counter(step)',
      counterIncrement: 'step',
      backgroundColor: homeTheme.code,
      borderRadius: 9999,
    },
  },
});

export function Steps({ children }: { children: ReactNode }) {
  return <div sx={styles.steps}>{children}</div>;
}

export function Step({ children }: { children: ReactNode }) {
  return <div sx={styles.step}>{children}</div>;
}
