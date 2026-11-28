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
    [breakpoints.md]: {
      minHeight: 'calc(100lvh - 56px)',
    },
  },
  eyebrow: {
    alignItems: 'center',
    marginBottom: 16,
    color: homeTheme.muted,
  },
  by: {
    fontSize: 12,
  },
  emphasis: {
    alignItems: 'center',
    marginBottom: 3,
    fontWeight: 500,
    color: homeTheme.foreground,
  },
  mark: {
    marginInline: '0.3em',
    ':is(.dark *)': {
      filter: 'invert(1)',
    },
  },
  title: {
    fontSize: 'clamp(48px, 13vw, 64px)',
    fontWeight: 650,
    lineHeight: 1.1,
    letterSpacing: '-0.04em',
    wordBreak: 'keep-all',
    textWrap: 'balance',
  },
  description: {
    marginTop: 12,
    fontSize: 'clamp(20px, 2.5vw, 28px)',
    lineHeight: 1.5,
    letterSpacing: '-0.02em',
    wordBreak: 'keep-all',
    textWrap: 'balance',
  },
  line: {
    whiteSpace: 'nowrap',
    [breakpoints.md]: {
      whiteSpace: 'normal',
    },
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'center',
    [breakpoints.md]: {
      justifyContent: 'center',
    },
  },
  button: {
    display: 'inline-flex',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px 16px',
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 1.5,
    borderColor: homeTheme.buttonBorder,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 8,
    ':hover': {
      color: homeTheme.background,
      background: homeTheme.foreground,
      boxShadow: '0 4px 6px -1px #0000001a, 0 2px 4px -2px #0000001a',
      scale: '1.05',
    },
  },
  primary: {
    position: 'relative',
    color: homeTheme.foreground,
    background: 'transparent',
    borderWidth: 0,
    isolation: 'isolate',
    transitionProperty: 'scale',
    '::before': {
      position: 'absolute',
      inset: -3,
      zIndex: -2,
      content: '""',
      backgroundColor: '#0f766e',
      backgroundImage: 'url(/primary-button-background.svg)',
      backgroundPosition: '50%',
      backgroundSize: 'cover',
      borderRadius: 11,
      transition: 'filter 0.12s ease-out, transform 0.12s ease-out',
    },
    '::after': {
      position: 'absolute',
      inset: 0,
      zIndex: -1,
      content: '""',
      background: homeTheme.background,
      borderRadius: 8,
      transition: 'transform 0.15s ease-out',
    },
    ':hover': {
      color: homeTheme.foreground,
      background: 'transparent',
      scale: '1.05',
    },
    ':hover::before': {
      filter: 'brightness(130%)',
      transform: 'scale(1.0125, 1.025)',
    },
    ':hover::after': {
      transform: 'scale(0.98, 0.96)',
    },
  },
  heroBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 44,
    [breakpoints.md]: {
      textAlign: 'center',
    },
  },
  banner: {
    width: '100%',
    aspectRatio: '2.85',
    overflow: 'hidden',
    backgroundColor: '#294aa6',
    borderRadius: 6,
    maskImage:
      'linear-gradient(to right, transparent, #000 6%, #000 94%, transparent), linear-gradient(to bottom, transparent, #000 10%, #000 90%, transparent)',
    maskComposite: 'intersect',
    [breakpoints.md]: {
      aspectRatio: '2',
    },
  },
  portrait: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: '72% center',
  },
});

export function HomePage({ lang = 'en' }: { lang?: 'en' | 'ja' }) {
  const ja = lang === 'ja';
  const docs = ja ? '/ja/docs' : '/docs';
  return (
    <main lang={lang} data-home sx={styles.home}>
      <Seo
        path={ja ? '/ja' : '/'}
        title={
          ja
            ? 'Plumeria — React のためのスタイルライブラリ'
            : 'Plumeria — React styling library for reliable interfaces'
        }
        subtitle={
          ja
            ? 'Plumeria は React のスタイルを書くためのライブラリです。同じプロパティを重ねると、配列の右側の値が使われます。'
            : 'Plumeria brings predictable overrides to React styling. When you combine styles in an array, the rightmost style wins for each property, regardless of import or load order.'
        }
      />
      <div sx={styles.page}>
        <div sx={styles.hero}>
          <div sx={styles.heroBody}>
            <div>
              <p sx={styles.eyebrow}>
                <span sx={styles.by}>BY</span>&nbsp;
                <span sx={styles.emphasis}>
                  zss {'{'}
                  <img src="/logo.svg" alt="z" width="12" sx={styles.mark} />
                  {'}'}
                </span>
              </p>
              <h1 sx={styles.title}>
                {ja ? (
                  <>
                    ゼロ
                    <wbr />
                    ランタイム
                    <wbr />
                    CSS-in-JS
                  </>
                ) : (
                  'Zero-Runtime CSS-in-JS'
                )}
              </h1>
              <p sx={styles.description}>
                <span sx={styles.line}>
                  {ja ? (
                    <>
                      信頼性の高い
                      <wbr />
                      インターフェースのための
                      <wbr />
                      React スタイリング
                      <wbr />
                      ライブラリ
                    </>
                  ) : (
                    'React styling library for reliable interfaces'
                  )}
                </span>
              </p>
            </div>
            <div sx={styles.actions}>
              <Link to={docs} unstable_prefetchOnView={{}} sx={[styles.button, styles.primary]}>
                {ja ? 'さあ始めましょう' : 'Get Started'}
              </Link>
              <a
                href="https://github.com/zss-labs/plumeria"
                target="_blank"
                rel="noopener noreferrer"
                sx={styles.button}
              >
                {ja ? 'GitHub で見る' : 'View on GitHub'}
              </a>
            </div>
          </div>
          <div aria-hidden="true" sx={styles.banner}>
            <img
              src="/surveyor-banner.avif"
              alt=""
              width={1368}
              height={480}
              fetchPriority="high"
              sx={styles.portrait}
            />
          </div>
        </div>
        <SiteFooter home lang={lang} />
      </div>
    </main>
  );
}

export default function Page() {
  return <HomePage />;
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
