'use client';

import * as css from '@plumeria/core';
import { useEffect, useRef, useState } from 'react';
import { AnchorProvider, useActiveAnchors, type TOCItemType } from 'fumadocs-core/toc';
import { breakpoints } from 'lib/mediaQuery';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  toc: {
    position: 'sticky',
    top: 56,
    gridRow: 1,
    gridColumn: 3,
    alignSelf: 'start',
    height: 'calc(100dvh - 56px)',
    padding: '48px 16px 8px',
    overflowY: 'auto',
    scrollbarWidth: 'none',
    borderLeftColor: homeTheme.border,
    borderLeftStyle: 'solid',
    borderLeftWidth: 1,
    [breakpoints.xl]: {
      display: 'none',
    },
  },
  heading: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    margin: '0 0 12px',
    fontSize: 14,
    lineHeight: '20px',
    color: homeTheme.muted,
  },
  rail: {
    position: 'relative',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    padding: 0,
    margin: 0,
    listStyle: 'none',
  },
  track: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'visible',
    pointerEvents: 'none',
    stroke: homeTheme.border,
  },
  thumb: (inset: string) => ({
    clipPath: inset,
    stroke: homeTheme.foreground,
  }),
  item: {
    display: 'block',
    padding: '6px 0 6px 20px',
    fontSize: 14,
    lineHeight: '20px',
    color: homeTheme.muted,
    textDecoration: 'none',
    transitionDuration: '0.2s',
    transitionProperty: 'color',
    '[data-active="true"]': {
      color: homeTheme.foreground,
    },
  },
  deep: {
    paddingLeft: 32,
  },
  first: {
    paddingTop: 0,
  },
});

type Segment = { x: number; top: number; bottom: number };

// Draws the rail through every item, slanting where the depth changes.
const toPath = (segments: Segment[]) =>
  segments
    .map(({ x, top, bottom }, index) => {
      const prev = segments[index - 1];
      const next = segments[index + 1];
      const start = prev && prev.x !== x ? top + 4 : top;
      const end = next && next.x !== x ? bottom - 4 : bottom;
      return `${index === 0 ? 'M' : 'L'}${x} ${start}L${x} ${end}`;
    })
    .join('');

// Slides both edges to their targets over a fixed time, ending exactly on them.
const useGlide = (top: number, bottom: number) => {
  const [edges, setEdges] = useState([top, bottom]);
  const current = useRef(edges);

  useEffect(() => {
    const [fromTop, fromBottom] = current.current;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min((now - start) / 200, 1);
      const eased = 1 - (1 - progress) ** 3;
      current.current = [fromTop + (top - fromTop) * eased, fromBottom + (bottom - fromBottom) * eased];
      setEdges(current.current);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [top, bottom]);

  return edges;
};

function Items({ toc }: { toc: TOCItemType[] }) {
  const list = useRef<HTMLUListElement>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const active = useActiveAnchors();

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () =>
      setSegments(
        Array.from(element.children as HTMLCollectionOf<HTMLElement>, (item, index) => ({
          x: toc[index].depth > 2 ? 12.5 : 0.5,
          top: item.offsetTop,
          bottom: item.offsetTop + item.offsetHeight,
        })),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [toc]);

  const height = segments.at(-1)?.bottom ?? 0;
  // Every visible heading is active; the first one in the page wins.
  const current = toc.findIndex((item) => active.includes(item.url.slice(1)));
  const first = segments[current];
  const last = first;
  const [top, bottom] = useGlide(first?.top ?? 0, last?.bottom ?? 0);
  const inset = first && last ? `inset(${top}px 0 ${height - bottom}px 0)` : 'inset(0 0 100% 0)';
  const d = toPath(segments);

  return (
    <div sx={styles.rail}>
      <ul ref={list} sx={styles.list}>
        {toc.map((item, index) => (
          <li key={item.url}>
            <a
              href={item.url}
              data-active={index === current}
              className={css.use(styles.item, item.depth > 2 && styles.deep, index === 0 && styles.first)}
            >
              {item.title}
            </a>
          </li>
        ))}
      </ul>
      <svg width="14" height={height} fill="none" aria-hidden="true" sx={styles.track}>
        <path d={d} />
        <path d={d} sx={styles.thumb(inset)} />
      </svg>
    </div>
  );
}

export function DocsToc({ toc }: { toc: TOCItemType[] }) {
  return (
    <aside aria-label="On this page" sx={styles.toc}>
      {toc.length > 0 && (
        <>
          <p sx={styles.heading}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M15 18H3M17 6H3M21 12H3" />
            </svg>
            On this page
          </p>
          <AnchorProvider toc={toc}>
            <Items toc={toc} />
          </AnchorProvider>
        </>
      )}
    </aside>
  );
}
