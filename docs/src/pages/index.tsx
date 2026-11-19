import * as css from '@plumeria/core';
import { Link } from 'waku';
import { Seo } from 'component/Seo';
import { SiteFooter } from 'component/SiteFooter';
import { breakpoints } from 'lib/mediaQuery';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  home: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 'calc(100vh - 56px)',
    color: homeTheme.foreground,
    background: homeTheme.background,
    WebkitTapHighlightColor: 'transparent',
  },
  page: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    width: '100%',
    maxWidth: 1200,
    paddingInline: 32,
    marginInline: 'auto',
    [breakpoints.md]: {
      paddingInline: 24,
    },
  },
  hero: {
    display: 'grid',
    gap: 24,
    alignContent: 'center',
    alignItems: 'center',
    minHeight: 'calc(100svh - 56px)',
    paddingBlock: 32,
  },
  title: {
    fontSize: 'clamp(48px, 10vw, 64px)',
    fontWeight: 650,
    lineHeight: 1.1,
    letterSpacing: '-0.065em',
  },
  description: {
    maxWidth: 640,
    marginTop: 12,
    fontSize: 'clamp(20px, 2.5vw, 28px)',
    lineHeight: 1.5,
    letterSpacing: '-0.02em',
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'center',
  },
  button: {
    display: 'inline-flex',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    padding: '12px 26px',
    fontSize: 16,
    fontWeight: 500,
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 8,
    transitionDuration: '0.2s',
    ':hover': {
      background: homeTheme.accent,
    },
  },
  primary: {
    ...css.marker('primary', ':hover'),
    color: homeTheme.background,
    background: homeTheme.foreground,
    borderColor: homeTheme.foreground,
    ':hover': {
      background: homeTheme.foreground,
      opacity: 0.85,
    },
  },
  heroBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 44,
  },
  banner: {
    width: '100%',
    aspectRatio: '2.85',
    overflow: 'hidden',
    backgroundColor: '#294aa6',
    borderRadius: 6,
    [breakpoints.md]: {
      aspectRatio: '2',
    },
  },
  portrait: {
    width: '100%',
    height: '100%',
    backgroundColor: '#d5d4cc',
    maskImage: 'url(/surveyor.webp)',
    maskMode: 'luminance',
    maskRepeat: 'no-repeat',
    maskPosition: '72% 30%',
    maskSize: '65% auto',
    [breakpoints.md]: {
      maskSize: '86% auto',
    },
  },
  arrow: {
    transition: 'translate 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
    [css.extended('primary', ':hover')]: {
      translate: '3px 0',
    },
  },
});

export default function Page() {
  return (
    <main data-home sx={styles.home}>
      <Seo
        title="Plumeria — Predictable style overrides for React"
        subtitle="Plumeria brings predictable overrides to React styling. When you combine styles in an array, the rightmost style wins for each property, regardless of import or load order."
      />
      <div sx={styles.page}>
        <div sx={styles.hero}>
          <div sx={styles.heroBody}>
            <div>
              <h1 sx={styles.title}>Plumeria</h1>
              <p sx={styles.description}>React styling library for reliable interfaces</p>
            </div>
            <div sx={styles.actions}>
              <Link to="/docs" unstable_prefetchOnView={{}} sx={[styles.button, styles.primary]}>
                Get started
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
                  sx={styles.arrow}
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <Link to="/docs/why-plumeria" unstable_prefetchOnView={{}} sx={styles.button}>
                Why Plumeria?
              </Link>
            </div>
          </div>
          <div aria-hidden="true" sx={styles.banner}>
            <div sx={styles.portrait} />
          </div>
        </div>
        <SiteFooter home />
      </div>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
