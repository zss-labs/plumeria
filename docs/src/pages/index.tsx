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
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'calc(var(--hero-height, 100svh) - 56px)',
    paddingBlock: 48,
    textAlign: 'center',
    [breakpoints.md]: {
      paddingBlock: 40,
    },
  },
  title: {
    fontSize: 'clamp(48px, 10vw, 64px)',
    fontWeight: 650,
    lineHeight: 1.1,
    letterSpacing: '-0.065em',
  },
  description: {
    maxWidth: 640,
    marginTop: 28,
    fontSize: 'clamp(20px, 2.5vw, 28px)',
    lineHeight: 1.5,
    letterSpacing: '-0.02em',
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
    marginTop: 44,
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
  arrow: {
    transition: 'translate 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
    [css.extended('primary', ':hover')]: {
      translate: '3px 0',
    },
  },
});

export default function Page() {
  return (
    <main data-home classStyle={styles.home}>
      <Seo
        title="Plumeria - React styling library"
        subtitle="The style on the right wins, not the one imported or loaded last."
      />
      <div classStyle={styles.page}>
        <div classStyle={styles.hero}>
          <h1 classStyle={styles.title}>Plumeria</h1>
          <p classStyle={styles.description}>React styling library for reliable interfaces</p>
          <div classStyle={styles.actions}>
            <Link to="/docs" unstable_prefetchOnView={{}} classStyle={[styles.button, styles.primary]}>
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
                classStyle={styles.arrow}
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
            <Link to="/docs/why-plumeria" unstable_prefetchOnView={{}} classStyle={styles.button}>
              Why Plumeria
            </Link>
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
