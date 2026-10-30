import * as css from '@plumeria/core';
import { Link } from 'waku';
import { copyright, footerGroups, footerSocialLinks } from 'lib/footerGroups';
import { homeTheme } from 'lib/theme';

const compact = '@container (max-width: 480px)';

const styles = css.create({
  footer: {
    paddingTop: 40,
    marginTop: 48,
    borderTopColor: 'var(--color-fd-border)',
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    containerType: 'inline-size',
  },
  groups: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, max-content)',
    gap: 32,
    justifyContent: 'space-between',
    [compact]: {
      gridTemplateColumns: 'repeat(2, max-content)',
      justifyContent: 'space-evenly',
    },
  },
  group: {
    textAlign: 'center',
  },
  heading: {
    marginBottom: 16,
    fontSize: 14,
    fontWeight: 600,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'center',
    listStyle: 'none',
  },
  link: {
    fontSize: 14,
    color: 'var(--color-fd-muted-foreground)',
    transitionDuration: '0.2s',
    ':hover': {
      color: 'var(--color-fd-foreground)',
    },
  },
  external: {
    display: 'inline-flex',
    gap: 4,
    alignItems: 'center',
  },
  legal: {
    position: 'relative',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 128,
    fontSize: 14,
    color: 'var(--color-fd-muted-foreground)',
    [compact]: {
      flexWrap: 'wrap',
      justifyContent: 'center',
    },
  },
  social: {
    position: 'absolute',
    left: '50%',
    display: 'flex',
    gap: 16,
    translate: '-50% 0',
    [compact]: {
      position: 'static',
      flexBasis: '100%',
      justifyContent: 'center',
      marginTop: 24,
      translate: 'none',
    },
  },
  socialLink: {
    display: 'inline-flex',
    color: 'var(--color-fd-muted-foreground)',
    transitionDuration: '0.2s',
    ':hover': {
      color: 'var(--color-fd-foreground)',
    },
  },
  homeFooter: {
    paddingBottom: 40,
    marginTop: 'auto',
    borderTopColor: homeTheme.border,
  },
  homeMuted: {
    color: homeTheme.muted,
    ':hover': {
      color: homeTheme.foreground,
    },
  },
  homeLegal: {
    color: homeTheme.muted,
  },
});

const ExternalIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M11 5H4v15h15v-7" />
    <path d="M14 3h7v7M21 3 11 13" />
  </svg>
);

export function SiteFooter({ home = false }: { home?: boolean }) {
  return (
    <footer classStyle={[styles.footer, home && styles.homeFooter]}>
      <nav aria-label="Resources" classStyle={styles.groups}>
        {footerGroups.map(({ heading, links }) => (
          <div key={heading} classStyle={styles.group}>
            <h2 classStyle={styles.heading}>{heading}</h2>
            <ul classStyle={styles.list}>
              {links.map(({ label, href, external }) => (
                <li key={label}>
                  {external ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      classStyle={[styles.link, styles.external, home && styles.homeMuted]}
                    >
                      {label}
                      <ExternalIcon />
                    </a>
                  ) : (
                    <Link to={href} unstable_prefetchOnView={{}} classStyle={[styles.link, home && styles.homeMuted]}>
                      {label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div classStyle={[styles.legal, home && styles.homeLegal]}>
        <span>{copyright}</span>
        <div classStyle={styles.social}>
          {footerSocialLinks.map(({ label, href, path }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={label}
              classStyle={[styles.socialLink, home && styles.homeMuted]}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d={path} />
              </svg>
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
