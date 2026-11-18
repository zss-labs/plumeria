'use client';

import { useState } from 'react';
import * as css from '@plumeria/core';

const styles = css.create({
  root: {
    display: 'inline-flex',
    alignItems: 'stretch',
    maxWidth: '100%',
    overflow: 'hidden',
    fontFamily: 'var(--mono)',
    fontSize: 12,
    color: '#edf2f1',
    background: '#1e1e1e',
    borderRadius: 6,
  },
  code: {
    alignSelf: 'center',
    minWidth: 0,
    padding: '10px 14px',
    overflowWrap: 'anywhere',
  },
  prompt: {
    color: '#94a3a1',
    userSelect: 'none',
  },
  button: {
    flexShrink: 0,
    padding: '0 12px',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 600,
    color: '#9d9d9d',
    cursor: 'pointer',
    background: '#181818',
    borderWidth: 0,
    borderLeftColor: '#2b2b2b',
    borderLeftStyle: 'solid',
    borderLeftWidth: 1,
    ':hover': {
      color: '#ffffff',
    },
  },
});

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div sx={styles.root}>
      <code sx={styles.code}>
        <span sx={styles.prompt}>$ </span>
        {command}
      </code>
      <button type="button" sx={styles.button} onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
