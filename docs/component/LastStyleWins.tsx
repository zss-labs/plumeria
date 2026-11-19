'use client';

import * as css from '@plumeria/core';
import { useState } from 'react';
import { breakpoints } from 'lib/mediaQuery';
import { homeTheme } from 'lib/theme';

const SIDES = [
  {
    name: 'CSS Modules',
    imports: ["import danger from './danger.module.css';", "import button from './button.module.css';"],
    usage: '<button className={cx(button.base, danger.root)}>',
    follows: true,
  },
  {
    name: 'Plumeria',
    imports: ["import { danger } from './danger';", "import { button } from './button';"],
    usage: '<button sx={[button.base, danger.root]}>',
    follows: false,
  },
] as const;

const TOKEN = /('[^']*'|\bimport\b|\bfrom\b|\bclassName\b|\bsx\b)/;

const styles = css.create({
  section: {
    display: 'grid',
    gap: 20,
    justifyItems: 'center',
    paddingBlock: 48,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 20,
    width: '100%',
    [breakpoints.md]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: homeTheme.code,
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 12,
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 20px 0',
  },
  name: {
    fontSize: 13,
    fontWeight: 600,
    color: homeTheme.foreground,
  },
  status: {
    fontFamily: 'var(--mono)',
    fontSize: 12,
  },
  ignored: {
    color: '#e5484d',
  },
  wins: {
    color: '#30a46c',
  },
  code: {
    padding: '14px 20px 18px',
    margin: 0,
    overflowX: 'auto',
    fontFamily: 'var(--mono)',
    fontSize: 13,
    lineHeight: 1.75,
    color: homeTheme.foreground,
    textAlign: 'left',
  },
  line: {
    display: 'block',
    paddingInline: 18,
    marginInline: -20,
    borderLeftColor: 'transparent',
    borderLeftStyle: 'solid',
    borderLeftWidth: 2,
    transitionDuration: '0.3s',
    transitionProperty: 'background-color, border-color',
  },
  changed: {
    background: homeTheme.primarySoft,
    borderLeftColor: homeTheme.primary,
  },
  keyword: {
    color: homeTheme.primary,
  },
  string: {
    color: homeTheme.muted,
  },
  preview: {
    display: 'flex',
    justifyContent: 'center',
    padding: 24,
    marginTop: 'auto',
    background: homeTheme.background,
    borderTopColor: homeTheme.border,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
  },
  base: {
    padding: '8px 20px',
    fontSize: 14,
    fontWeight: 500,
    color: '#fff',
    pointerEvents: 'none',
    background: '#3e63dd',
    borderRadius: 6,
  },
  danger: {
    background: '#e5484d',
  },
  swap: {
    display: 'inline-flex',
    gap: 8,
    alignItems: 'center',
    minHeight: 48,
    padding: '12px 26px',
    fontSize: 16,
    fontWeight: 500,
    color: homeTheme.background,
    cursor: 'pointer',
    background: homeTheme.foreground,
    borderRadius: 8,
    transitionDuration: '0.2s',
    ':hover': {
      opacity: 0.85,
    },
  },
});

function Code({ text }: { text: string }) {
  return text.split(TOKEN).map((part, i) => {
    if (i % 2 === 0) return part;
    return (
      <span key={i} sx={part.startsWith("'") ? styles.string : styles.keyword}>
        {part}
      </span>
    );
  });
}

export function LastStyleWins() {
  const [swapped, setSwapped] = useState(false);
  return (
    <section sx={styles.section}>
      <div sx={styles.grid}>
        {SIDES.map((side) => {
          const imports = swapped ? [...side.imports].reverse() : side.imports;
          const isDanger = !side.follows || swapped;
          return (
            <div key={side.name} sx={styles.panel}>
              <div sx={styles.head}>
                <span sx={styles.name}>{side.name}</span>
                <span sx={[styles.status, isDanger ? styles.wins : styles.ignored]}>
                  {isDanger ? '✓ danger wins' : '✗ danger ignored'}
                </span>
              </div>
              <pre sx={styles.code}>
                {imports.map((line) => (
                  <span key={line} sx={[styles.line, swapped && styles.changed]}>
                    <Code text={line} />
                  </span>
                ))}
                {'\n'}
                <Code text={side.usage} />
              </pre>
              <div sx={styles.preview}>
                <span sx={[styles.base, isDanger && styles.danger]}>Delete</span>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" aria-pressed={swapped} onClick={() => setSwapped(!swapped)} sx={styles.swap}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />
        </svg>
        Swap imports
      </button>
    </section>
  );
}
