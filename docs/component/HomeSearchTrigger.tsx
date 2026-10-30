'use client';

import * as css from '@plumeria/core';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { useEffect, useRef, ViewTransition } from 'react';
import type {} from 'react/canary';
import { useRouter } from 'waku';
import { breakpoints } from 'lib/mediaQuery';
import { homeTheme } from 'lib/theme';

// The body stretches while the group accelerates, gathers as it arrives and settles.
// The omitted 0% and 100% rest on the styles of the image pair.
const wobble = css.keyframes({
  '20%': {
    inset: '3.5px -1.6vw',
    backgroundColor: homeTheme.accent,
    borderRadius: '13px 64px 64px 13px / 13px',
    boxShadow: 'inset 0 1px 1px rgb(255 255 255 / 0.2), inset 0 -1px 1px rgb(0 0 0 / 0.08)',
    transform: 'translateX(1vw)',
  },
  '46%': {
    inset: '-1.5px 3%',
    borderRadius: '17px',
    transform: 'translateX(0)',
  },
  '72%': {
    inset: '0.5px -0.6%',
  },
});

const dim = css.keyframes({
  '20%': {
    opacity: 0.4,
  },
  '55%': {
    opacity: 1,
  },
});

const motion = css.createStatic({
  animationDuration: '0.45s',
  animationTimingFunction:
    'linear(0, 0.037, 0.126, 0.243, 0.371, 0.497, 0.613, 0.714, 0.8, 0.869, 0.922, 0.962, 0.991, 1.01, 1.022, 1.028, 1.03, 1.03, 1.027, 1.024, 1.02, 1.016, 1.013, 1.01, 1.007, 1.005, 1.003, 1.002, 1.001, 1, 1)',
} satisfies css.CSSProperties);

// The body is drawn by the image pair itself, so it needs no snapshot to stretch.
const droplet = css.viewTransitionClass({
  group: {
    ...motion,
  },
  imagePair: {
    backgroundColor: `color-mix(in oklab, ${homeTheme.accent} 50%, transparent)`,
    borderRadius: 17,
    animationName: wobble,
    animationTimingFunction: 'cubic-bezier(0.37, 0, 0.63, 1)',
  },
  old: {
    display: 'none',
  },
  new: {
    display: 'none',
  },
});

// Mirrors the tail of `wobble` to the side the trigger is leaving from.
const dropletBack = css.viewTransitionClass({
  group: {
    ...motion,
  },
  imagePair: {
    backgroundColor: `color-mix(in oklab, ${homeTheme.accent} 50%, transparent)`,
    borderRadius: 17,
    scale: '-1 1',
    animationName: wobble,
    animationTimingFunction: 'cubic-bezier(0.37, 0, 0.63, 1)',
  },
  old: {
    display: 'none',
  },
  new: {
    display: 'none',
  },
});

const carried = css.viewTransitionClass({
  group: {
    ...motion,
  },
  imagePair: {
    animationName: dim,
    animationTimingFunction: 'cubic-bezier(0.37, 0, 0.63, 1)',
  },
});

// Matches `breakpoints.lgUp`, below which the trigger stays where it is.
const canAnimate = () => window.matchMedia('(min-width: 1024px)').matches;

const styles = css.create({
  trigger: {
    display: 'inline-flex',
    gap: 4,
    alignItems: 'center',
    padding: '4px 10px',
    fontSize: 12,
    color: homeTheme.muted,
    cursor: 'pointer',
    background: `color-mix(in oklab, ${homeTheme.accent} 50%, transparent)`,
    borderRadius: 9999,
    transitionDuration: '0.2s',
    transitionProperty: 'color, background-color',
    ':hover': {
      color: homeTheme.foreground,
      background: homeTheme.accent,
    },
    [breakpoints.md]: {
      display: 'none',
    },
  },
  centered: {
    [breakpoints.lgUp]: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      justifyContent: 'space-between',
      // Narrows before it reaches the links on the right.
      width: 'clamp(120px, 100vw - 916px, 280px)',
      padding: '6px 12px',
      transform: 'translate(-50%, -50%)',
    },
  },
  icon: {
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    marginLeft: 'auto',
    cursor: 'pointer',
    borderRadius: 6,
    ':hover': {
      background: homeTheme.accent,
    },
    [breakpoints.md]: {
      display: 'inline-flex',
    },
  },
});

export const HomeSearchIcon = () => {
  const { setOpenSearch } = useSearchContext();

  return (
    <button type="button" aria-label="Search" classStyle={styles.icon} onClick={() => setOpenSearch(true)}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
  );
};

export const HomeSearchTrigger = () => {
  const { setOpenSearch } = useSearchContext();
  const { path } = useRouter();
  const isDocs = path.startsWith('/docs');
  const wasDocs = useRef(isDocs);
  const moved = isDocs !== wasDocs.current && canAnimate();

  useEffect(() => {
    wasDocs.current = isDocs;
  }, [isDocs]);

  return (
    <ViewTransition default="none" update={moved ? (isDocs ? droplet : dropletBack) : 'none'}>
      <button
        type="button"
        aria-label="Search"
        classStyle={[styles.trigger, isDocs && styles.centered]}
        onClick={() => setOpenSearch(true)}
      >
        <ViewTransition default="none" update={moved ? carried : 'none'}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <span>⌘K</span>
        </ViewTransition>
      </button>
    </ViewTransition>
  );
};
