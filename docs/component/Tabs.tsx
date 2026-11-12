'use client';

import * as css from '@plumeria/core';
import { Children, useId, useState, type ReactNode } from 'react';

const styles = css.create({
  tabs: {
    display: 'flex',
    flexDirection: 'column',
    margin: '16px 0',
    overflow: 'hidden',
    colorScheme: 'dark',
    background: 'rgb(12, 12, 14)',
    borderColor: 'rgba(255, 255, 255, 0.07)',
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 12,
  },
  list: {
    display: 'flex',
    gap: 14,
    paddingInline: 16,
    overflowX: 'auto',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
  },
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '8px 0',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    color: 'rgba(179, 179, 179, 0.8)',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    background: 'none',
    borderColor: 'transparent',
    borderStyle: 'solid',
    borderWidth: '0 0 1px',
    transitionDuration: '0.2s',
    transitionProperty: 'color, border-color',
    '[aria-selected="true"]': {
      color: '#fafafa',
      borderColor: '#fafafa',
    },
    ':hover:not([aria-selected="true"])': {
      color: '#fafafa',
    },
  },
});

function escapeValue(v: string) {
  return v.toLowerCase().replace(/\s/, '-');
}

export function Tabs({ items, children }: { items: string[]; children: ReactNode }) {
  const [selected, setSelected] = useState(0);
  const id = useId();

  return (
    <div sx={styles.tabs}>
      <div role="tablist" sx={styles.list}>
        {items.map((item, i) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`${id}-${escapeValue(item)}-tab`}
            aria-selected={i === selected}
            aria-controls={`${id}-${escapeValue(item)}`}
            sx={styles.trigger}
            onClick={() => setSelected(i)}
          >
            {item}
          </button>
        ))}
      </div>
      {Children.toArray(children).map((child, i) => (
        <div
          key={items[i]}
          role="tabpanel"
          id={`${id}-${escapeValue(items[i] ?? String(i))}`}
          aria-labelledby={`${id}-${escapeValue(items[i] ?? String(i))}-tab`}
          hidden={i !== selected}
          tabIndex={0}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

export function Tab({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
