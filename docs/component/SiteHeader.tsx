import * as css from '@plumeria/core';
import { Link } from 'waku';
import { HomeSearchIcon, HomeSearchTrigger } from 'component/HomeSearchTrigger';
import { HomeThemeToggle } from 'component/HomeThemeToggle';
import { MenuAutoClose } from 'component/MenuAutoClose';
import { coreVersion } from 'lib/coreVersion';
import { latestBlogUrl } from 'lib/latestBlogUrl';
import { breakpoints } from 'lib/mediaQuery';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 40,
    height: 56,
    color: homeTheme.foreground,
    background: homeTheme.background,
    WebkitTapHighlightColor: 'transparent',
    '::after': {
      position: 'absolute',
      inset: 'auto 0 0',
      height: 1,
      content: '""',
      background: homeTheme.border,
      transition: 'opacity 0s 0.2s',
    },
    [breakpoints.md]: {
      ':has(:popover-open)::after': {
        transition: 'none',
        opacity: 0,
      },
    },
  },
  nav: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    height: '100%',
    paddingInline: 24,
    [breakpoints.md]: {
      gap: 16,
      paddingInline: 16,
    },
  },
  brand: {
    display: 'flex',
    gap: 5,
    alignItems: 'center',
    fontSize: 15,
    fontWeight: 650,
    letterSpacing: '-0.03em',
  },
  brandMark: {
    marginTop: -2,
  },
  version: {
    padding: '2px 10px',
    fontSize: 13,
    fontWeight: 500,
    lineHeight: '20px',
    background: homeTheme.accent,
    borderRadius: 9999,
    transitionDuration: '0.2s',
    ':hover': {
      opacity: 0.7,
    },
  },
  toggle: {
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    marginLeft: -6,
    cursor: 'pointer',
    borderRadius: 6,
    ':hover': {
      background: homeTheme.accent,
    },
    [breakpoints.md]: {
      display: 'inline-flex',
      ':has(+ :popover-open)': {
        background: `color-mix(in oklab, ${homeTheme.accent} 50%, transparent)`,
      },
    },
  },
  menu: {
    position: 'static',
    display: 'flex',
    flex: 1,
    gap: 24,
    alignItems: 'center',
    justifyContent: 'flex-end',
    width: 'auto',
    height: 'auto',
    padding: 0,
    margin: 0,
    overflow: 'visible',
    color: 'inherit',
    background: 'none',
    borderWidth: 0,
    '@starting-style': {
      ':popover-open': {
        gridTemplateRows: '0fr',
      },
    },
    [breakpoints.md]: {
      position: 'fixed',
      inset: '55px 0 auto',
      display: 'none',
      gridTemplateRows: '0fr',
      alignItems: 'stretch',
      justifyContent: 'stretch',
      padding: '0 16px',
      background: homeTheme.background,
      borderColor: homeTheme.border,
      borderStyle: 'solid',
      borderWidth: '0 0 1px',
      borderRadius: '0 0 16px 16px',
      transition: 'grid-template-rows 0.2s ease, display 0.2s allow-discrete, overlay 0.2s allow-discrete',
      ':popover-open': {
        display: 'grid',
        gridTemplateRows: '1fr',
      },
    },
  },
  menuBody: {
    display: 'contents',
    [breakpoints.md]: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden',
      '::before': {
        flex: 'none',
        height: 16,
        content: '""',
      },
      '::after': {
        flex: 'none',
        height: 16,
        content: '""',
      },
    },
  },
  menuLink: {
    fontSize: 14,
    color: homeTheme.muted,
    transitionDuration: '0.2s',
    ':hover': {
      color: homeTheme.foreground,
    },
    [breakpoints.md]: {
      paddingBlock: 8,
      fontSize: 16,
      color: homeTheme.foreground,
    },
  },
  external: {
    display: 'inline-flex',
    gap: 4,
    alignItems: 'center',
  },
  menuActions: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    [breakpoints.md]: {
      justifyContent: 'space-between',
      paddingTop: 16,
    },
  },
  iconLink: {
    display: 'inline-flex',
    padding: 6,
    color: homeTheme.muted,
    borderRadius: 6,
    transitionDuration: '0.2s',
    ':hover': {
      color: homeTheme.foreground,
      background: homeTheme.accent,
    },
    [breakpoints.md]: {
      marginRight: -6,
    },
  },
});

export const SiteHeader = () => (
  <header classStyle={styles.header}>
    <nav classStyle={styles.nav}>
      <Link to="/" unstable_prefetchOnView={{}} classStyle={styles.brand}>
        <img src="/logo.svg" alt="" width="20" height="20" classStyle={styles.brandMark} />
        Plumeria
      </Link>
      <Link to={latestBlogUrl} unstable_prefetchOnView={{}} classStyle={styles.version}>
        v{coreVersion}
      </Link>
      <HomeSearchIcon />
      <button type="button" popoverTarget="home-menu" aria-label="Toggle Menu" classStyle={styles.toggle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2.2" />
          <circle cx="12" cy="12" r="2.2" />
          <circle cx="12" cy="19" r="2.2" />
        </svg>
      </button>
      <div id="home-menu" popover="auto" classStyle={styles.menu}>
        <MenuAutoClose id="home-menu" />
        <div classStyle={styles.menuBody}>
          <HomeSearchTrigger />
          <Link to="/docs" unstable_prefetchOnView={{}} classStyle={styles.menuLink}>
            Docs
          </Link>
          <a href="/playground" classStyle={styles.menuLink}>
            Play
          </a>
          <Link to="/blog" unstable_prefetchOnView={{}} classStyle={styles.menuLink}>
            Blog
          </Link>
          <a
            href="https://refirst11.github.io/css-compiler-bench/"
            target="_blank"
            rel="noreferrer noopener"
            classStyle={[styles.menuLink, styles.external]}
          >
            Benchmark
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M11 5H4v15h15v-7" />
              <path d="M14 3h7v7M21 3 11 13" />
            </svg>
          </a>
          <div classStyle={styles.menuActions}>
            <HomeThemeToggle />
            <a
              href="https://github.com/zss-labs/plumeria"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="GitHub"
              classStyle={styles.iconLink}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12.026 2c-5.509 0-9.974 4.465-9.974 9.974c0 4.406 2.857 8.145 6.821 9.465c.499.09.679-.217.679-.481c0-.237-.008-.865-.011-1.696c-2.775.602-3.361-1.338-3.361-1.338c-.452-1.152-1.107-1.459-1.107-1.459c-.905-.619.069-.605.069-.605c1.002.07 1.527 1.028 1.527 1.028c.89 1.524 2.336 1.084 2.902.829c.091-.645.351-1.085.635-1.334c-2.214-.251-4.542-1.107-4.542-4.93c0-1.087.389-1.979 1.024-2.675c-.101-.253-.446-1.268.099-2.64c0 0 .837-.269 2.742 1.021a9.582 9.582 0 0 1 2.496-.336a9.554 9.554 0 0 1 2.496.336c1.906-1.291 2.742-1.021 2.742-1.021c.545 1.372.203 2.387.099 2.64c.64.696 1.024 1.587 1.024 2.675c0 3.833-2.33 4.675-4.552 4.922c.355.308.675.916.675 1.846c0 1.334-.012 2.41-.012 2.737c0 .267.178.577.687.479C19.146 20.115 22 16.379 22 11.974C22 6.465 17.535 2 12.026 2z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </nav>
  </header>
);
