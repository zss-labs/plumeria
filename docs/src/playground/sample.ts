export type SampleFile = {
  path: string;
  label: string;
  source: string;
};

export const ENTRY = '/playground.tsx';

export const SAMPLE_FILES: SampleFile[] = [
  {
    path: ENTRY,
    label: 'Card.tsx',
    source: `import * as css from '@plumeria/core';
import * as t from '@plumeria/wind';
import { theme } from './theme';
import { breakpoints } from './tokens';

const External = () => (
  <svg sx={styles.icon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </svg>
);

export const Card = () => (
  <main sx={styles.canvas}>
    <article sx={styles.card}>
      <div sx={styles.heading}>
        <img sx={styles.logo} src="/logo.svg" alt="" width={20} height={20} />
        <p sx={styles.eyebrow}>Plumeria</p>
      </div>
      <h1 sx={styles.title}>Rust-based CSS compiler</h1>
      <p sx={styles.description}>
        Atomic CSS at build time, nothing at runtime.
        <br />
        Edit any style and watch it land live.
      </p>
      <div sx={styles.actions}>
        <a sx={[styles.button, styles.primary]} href="/docs" target="_blank" rel="noreferrer">
          Docs <External />
        </a>
        <a sx={styles.button} href="https://github.com/zss-labs/plumeria" target="_blank" rel="noreferrer">
          GitHub <External />
        </a>
      </div>
    </article>
  </main>
);

const styles = css.create({
  canvas: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    padding: 24,
    overflow: 'auto',
    background: theme.canvas,
    [breakpoints.sm]: {
      padding: 16,
    },
  },
  card: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 420,
    padding: t.spacing[7],
    margin: 'auto',
    color: theme.text,
    background: theme.surface,
    borderColor: theme.border,
    borderStyle: 'solid',
    borderWidth: '1px',
    borderRadius: t.radius['3xl'],
    boxShadow: theme.shadow,
    [breakpoints.sm]: {
      padding: 22,
      borderRadius: 20,
    },
  },
  heading: {
    display: 'flex',
    gap: 5,
    alignItems: 'center',
    marginBottom: 20,
  },
  logo: {
    marginTop: -2,
  },
  eyebrow: {
    margin: 0,
    fontSize: 15,
    fontWeight: 650,
    color: theme.text,
    letterSpacing: '-0.03em',
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 600,
    lineHeight: 1.2,
    letterSpacing: '-0.03em',
    [breakpoints.sm]: {
      fontSize: 24,
    },
  },
  description: {
    margin: '14px 0 24px',
    fontSize: 15,
    lineHeight: 1.6,
    color: theme.muted,
    textWrap: 'balance',
  },
  actions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: t.spacing['2.5'],
  },
  button: {
    boxSizing: 'border-box',
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 500,
    color: theme.text,
    textDecoration: 'none',
    background: theme.tint,
    borderRadius: t.radius.xl,
    transition: 'scale 120ms',
    ...css.marker('button', ':hover'),
    ':active': {
      scale: 0.98,
    },
    ':focus-visible': {
      outline: \`2px solid \${theme.accent}\`,
      outlineOffset: 3,
    },
  },
  primary: {
    color: theme.onAccent,
    background: theme.accent,
  },
  icon: {
    transition: 'translate 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    [css.extended('button', ':hover')]: {
      translate: '3px -3px',
    },
  },
});
`,
  },
  {
    path: '/theme.ts',
    label: 'theme.ts',
    source: `import * as css from '@plumeria/core';

export const theme = css.createTheme('.dark', {
  canvas: { default: '#e4e7ed', theme: '#18181b' },
  surface: { default: '#f5f6f8', theme: '#1c1f27' },
  border: { default: '#cbd1dc', theme: '#2a2f3a' },
  shadow: { default: '0 16px 48px rgb(31 36 48 / 0.10)', theme: '0 16px 48px rgb(0 0 0 / 0.08)' },
  text: { default: '#1f2430', theme: '#e9edf5' },
  muted: { default: '#596273', theme: '#a4acbd' },
  accent: { default: '#365dcc', theme: '#5b8cff' },
  onAccent: { default: '#ffffff', theme: '#0b1533' },
  tint: { default: '#e1e5ee', theme: '#2e3442' },
});
`,
  },
  {
    path: '/tokens.ts',
    label: 'tokens.ts',
    source: `import * as css from '@plumeria/core';

export const breakpoints = css.createStatic({
  sm: '@media (max-width: 480px)',
});
`,
  },
];

const MERGE_FILES: SampleFile[] = [
  {
    path: ENTRY,
    label: 'Page.tsx',
    source: `import * as css from '@plumeria/core';
import { Badge } from './Badge';
import { shared } from './shared';
import { theme } from './theme';
import { breakpoints } from './tokens';

// The last style written wins, whichever file it comes from.
// Swap the entries of any array and the preview follows.

export const Page = () => (
  <main sx={styles.canvas}>
    <article sx={styles.card}>
      <h1 sx={styles.title}>The last style written wins</h1>
      <p sx={styles.lead}>Swap any array in Page.tsx and the result follows.</p>

      {/* muted comes from another module, accent from this one */}
      <section sx={styles.section}>
        <h2 sx={styles.label}>Across modules</h2>
        <div sx={styles.pair}>
          <div sx={styles.tile}>
            <span sx={styles.caption}>muted → accent</span>
            <span sx={[styles.specimen, shared.muted, styles.accent]}>Aa</span>
          </div>
          <div sx={styles.tile}>
            <span sx={styles.caption}>accent → muted</span>
            <span sx={[styles.specimen, styles.accent, shared.muted]}>Aa</span>
          </div>
        </div>
      </section>

      {/* Badge applies its own muted color first, then the style it receives */}
      <section sx={styles.section}>
        <h2 sx={styles.label}>Through a prop</h2>
        <div sx={styles.pair}>
          <div sx={styles.tile}>
            <span sx={styles.caption}>Badge</span>
            <Badge>Badge</Badge>
          </div>
          <div sx={styles.tile}>
            <span sx={styles.caption}>Badge → accent</span>
            <Badge sx={styles.accent}>Badge</Badge>
          </div>
        </div>
      </section>

      {/* The accent band is the padding: the longhand outranks its shorthand in either order */}
      <section sx={styles.section}>
        <h2 sx={styles.label}>Longhand over shorthand</h2>
        <div sx={styles.trio}>
          <div sx={styles.tile}>
            <span sx={styles.caption}>box</span>
            <div sx={styles.box}>
              <div sx={styles.fill} />
            </div>
          </div>
          <div sx={styles.tile}>
            <span sx={styles.caption}>box → top</span>
            <div sx={[styles.box, styles.boxTop]}>
              <div sx={styles.fill} />
            </div>
          </div>
          <div sx={styles.tile}>
            <span sx={styles.caption}>top → box</span>
            <div sx={[styles.boxTop, styles.box]}>
              <div sx={styles.fill} />
            </div>
          </div>
        </div>
      </section>
    </article>
  </main>
);

const styles = css.create({
  canvas: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    padding: 24,
    overflow: 'auto',
    background: theme.canvas,
    [breakpoints.sm]: {
      padding: 16,
    },
  },
  card: {
    boxSizing: 'border-box',
    display: 'grid',
    gap: 24,
    width: '100%',
    maxWidth: 480,
    padding: 28,
    margin: 'auto',
    color: theme.text,
    background: theme.surface,
    borderColor: theme.border,
    borderStyle: 'solid',
    borderWidth: '1px',
    borderRadius: 24,
    boxShadow: theme.shadow,
    [breakpoints.sm]: {
      gap: 20,
      padding: 20,
      borderRadius: 20,
    },
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 600,
    lineHeight: 1.2,
    letterSpacing: '-0.03em',
  },
  lead: {
    margin: '-16px 0 0',
    fontSize: 14,
    lineHeight: 1.6,
    color: theme.muted,
  },
  section: {
    display: 'grid',
    gap: 10,
  },
  label: {
    margin: 0,
    fontSize: 12,
    fontWeight: 600,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
  },
  trio: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
  },
  tile: {
    display: 'grid',
    gap: 12,
    justifyItems: 'start',
    padding: 14,
    borderColor: theme.border,
    borderStyle: 'solid',
    borderWidth: '1px',
    borderRadius: 14,
    [breakpoints.sm]: {
      padding: 10,
    },
  },
  caption: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 12,
    color: theme.muted,
  },
  specimen: {
    fontSize: 32,
    fontWeight: 600,
    lineHeight: 1,
    letterSpacing: '-0.03em',
  },
  accent: {
    color: theme.accent,
  },
  box: {
    boxSizing: 'border-box',
    width: '100%',
    padding: 8,
    background: theme.accent,
    borderRadius: 10,
  },
  boxTop: {
    paddingTop: 32,
  },
  fill: {
    height: 20,
    background: theme.surface,
    borderRadius: 4,
  },
});
`,
  },
  {
    path: '/Badge.tsx',
    label: 'Badge.tsx',
    source: `import * as css from '@plumeria/core';
import { theme } from './theme';

type BadgeProps = {
  sx?: css.StyleProps<'color'>;
  children: string;
};

export const Badge = ({ sx, children }: BadgeProps) => (
  <span sx={[styles.badge, sx]}>{children}</span>
);

const styles = css.create({
  badge: {
    padding: '6px 12px',
    fontSize: 14,
    fontWeight: 600,
    color: theme.muted,
    background: theme.tint,
    borderRadius: 999,
  },
});
`,
  },
  {
    path: '/shared.ts',
    label: 'shared.ts',
    source: `import * as css from '@plumeria/core';
import { theme } from './theme';

export const shared = css.create({
  muted: {
    color: theme.muted,
  },
});
`,
  },
  SAMPLE_FILES[1],
  SAMPLE_FILES[2],
];

const VIEW_TRANSITION_FILES: SampleFile[] = [
  {
    path: ENTRY,
    label: 'ViewTransition.tsx',
    source: `import * as css from '@plumeria/core';
import { startTransition, useState, ViewTransition } from 'react';

const pieces = [
  { id: 'dune', number: '01', title: 'Dune Study', category: 'LANDSCAPE', description: 'Soft layers of sand meet a late afternoon sun. A study in warmth, stillness, and the shapes left by wind.', palette: 'sand', form: 'dunes' },
  { id: 'tide', number: '02', title: 'Blue Current', category: 'WATERLINE', description: 'Cool blue-green tones drift across the page like a tide moving around smooth stone.', palette: 'tide', form: 'waves' },
  { id: 'bloom', number: '03', title: 'Quiet Bloom', category: 'BOTANICAL', description: 'A single flower, reduced to a few simple shapes and a gentle contrast of color.', palette: 'bloom', form: 'flower' },
  { id: 'grove', number: '04', title: 'Moss Form', category: 'STILL LIFE', description: 'An imagined vessel rests in a shaded garden. Rounded edges give the composition a quiet balance.', palette: 'grove', form: 'vessel' },
] as const;

type Piece = (typeof pieces)[number];

const scaleOut = css.keyframes({
  from: {
    transform: 'scale(1)',
    opacity: 1
  },
  to: {
    transform: 'scale(0.84)',
    opacity: 0
  },
});
const scaleIn = css.keyframes({
  from: {
    transform: 'scale(0.84)',
    opacity: 0
  },
  to: {
    transform: 'scale(1)',
    opacity: 1
  },
});
const sharedMotion = css.viewTransitionClass({
  group: {
    animationDuration: '0.5s',
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
  },
  imagePair: {
    mixBlendMode: 'normal'
  },
  old: {
    animationName: scaleOut,
    animationDuration: '0.25s',
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
  },
  new: {
    animationName: scaleIn,
    animationDuration: '0.25s',
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
  },
});

export const ViewTransitionDemo = () => {
  const [selected, setSelected] = useState<Piece | null>(null);
  const sharedClass = sharedMotion;
  const openPiece = (piece: Piece) => startTransition(() => setSelected(piece));
  const closePiece = () => startTransition(() => setSelected(null));

  return (
    <main sx={styles.canvas}>
      <article sx={styles.page}>
        <header sx={styles.header}>
          <span sx={styles.brand}>FORM / FIELD NOTES</span>
          <span sx={styles.edition}>A STUDY IN COLOR &amp; FORM</span>
        </header>
        {selected ? (
            <section sx={styles.detail}>
              <div sx={styles.detailTopline}>
                <button type="button" sx={styles.backButton} onClick={closePiece}>
                  <span aria-hidden="true">←</span> All studies
                </button>
                <span sx={styles.edition}>{selected.number} / 04</span>
              </div>
              <div sx={styles.hero}>
                <ViewTransition name={'art-' + selected.id} share={sharedClass}>
                  <Artwork piece={selected} hero />
                </ViewTransition>
                <span sx={styles.heroShade} />
                <ViewTransition name={'title-' + selected.id} share={sharedClass}>
                  <h1 sx={styles.heroTitle}>{selected.title}</h1>
                </ViewTransition>
                <span sx={styles.heroCategory}>{selected.category} · {selected.number}</span>
              </div>
              <div sx={styles.detailCopy}>
                <p sx={styles.eyebrow}>A CLOSER LOOK</p>
                <p sx={styles.detailDescription}>{selected.description}</p>
              </div>
            </section>
          ) : (
            <section sx={styles.collection}>
              <div sx={styles.intro}>
                <p sx={styles.eyebrow}>SMALL OBJECTS / SLOW DAYS</p>
                <h1 sx={styles.introTitle}>Forms from a quieter world.</h1>
                <p sx={styles.introText}>Choose a study to see it move from the collection into focus.</p>
              </div>
              <div sx={styles.grid}>
                {pieces.map((piece) => (
                  <button key={piece.id} type="button" sx={styles.tile} onClick={() => openPiece(piece)} aria-label={'Open ' + piece.title}>
                    <ViewTransition name={'art-' + piece.id} share={sharedClass}>
                      <Artwork piece={piece} />
                    </ViewTransition>
                    <span sx={styles.tileMeta}>
                      <span sx={styles.tileNumber}>{piece.number}</span>
                      <ViewTransition name={'title-' + piece.id} share={sharedClass}>
                        <span sx={styles.tileTitle}>{piece.title}</span>
                      </ViewTransition>
                      <span sx={styles.tileArrow} aria-hidden="true">↗</span>
                    </span>
                    <span sx={styles.tileCategory}>{piece.category}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        <footer sx={styles.footer}>
          <span>COLOR · SHAPE · STILLNESS</span>
          <span>COLLECTION 01</span>
        </footer>
      </article>
    </main>
  );
};

function Artwork({ piece, hero = false }: { piece: Piece; hero?: boolean }) {
  return (
    <span
      sx={[
        styles.artwork,
        piece.palette === 'sand' && styles.sand,
        piece.palette === 'tide' && styles.tide,
        piece.palette === 'bloom' && styles.bloom,
        piece.palette === 'grove' && styles.grove,
        hero && styles.heroArtwork,
      ]}
      aria-hidden="true"
    >
      {piece.form === 'flower' && <><span sx={styles.stem} /><span sx={styles.leaf} /><span sx={styles.flower} /><span sx={styles.flowerCenter} /></>}
      {piece.form === 'vessel' && <><span sx={styles.vesselShadow} /><span sx={styles.vessel} /><span sx={styles.vesselRim} /></>}
      <span sx={styles.artIndex}>{piece.number} / FORM STUDY</span>
    </span>
  );
}

const styles = css.create({
  canvas: {
    boxSizing: 'border-box',
    minHeight: '100vh',
    padding: '24px 20px',
    background: '#efede6',
    '@media (max-width: 520px)': {
      padding: '14px 10px'
    },
  },
  page: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 960,
    padding: '24px 30px 18px',
    margin: 'auto',
    color: '#242a24',
    background: '#faf9f5',
    borderRadius: 16,
    boxShadow: '0 18px 60px rgb(42 43 35 / 0.08)',
    '@media (max-width: 520px)': {
      padding: '18px 15px 14px'
    },
  },
  header: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    marginBottom: 26,
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.13em',
    borderBottomColor: '#e8e5dc',
    borderBottomStyle: 'solid',
    borderBottomWidth: '1px',
    '@media (max-width: 520px)': {
      marginBottom: 20,
      fontSize: 8
    },
  },
  brand: {
    fontWeight: 700
  },
  edition: {
    color: '#8a8a7e',
    textAlign: 'right'
  },
  collection: {
    minHeight: 520
  },
  intro: {
    maxWidth: 470,
    marginBottom: 25
  },
  eyebrow: {
    margin: '0 0 9px',
    fontSize: 9,
    fontWeight: 600,
    color: '#858778',
    letterSpacing: '0.15em'
  },
  introTitle: {
    maxWidth: 440,
    margin: 0,
    fontFamily: 'Georgia, serif',
    fontSize: 36,
    fontWeight: 400,
    lineHeight: 1.05,
    letterSpacing: '-0.045em',
    '@media (max-width: 520px)': {
      fontSize: 30
    },
  },
  introText: {
    margin: '10px 0 0',
    fontSize: 12,
    lineHeight: 1.55,
    color: '#77796e'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '20px 16px',
    '@media (min-width: 760px)': {
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 16
    },
  },
  tile: {
    display: 'block',
    minWidth: 0,
    padding: 0,
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    background: 'transparent',
    borderColor: 'currentColor',
    borderStyle: 'none',
    borderWidth: '0',
    ':hover': {
      color: '#78836f'
    },
    ':focus-visible': {
      outline: '2px solid #78836f',
      outlineOffset: 5,
      borderRadius: 8
    },
  },
  tileMeta: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
    marginTop: 9
  },
  tileNumber: {
    flex: '0 0 auto',
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    color: '#929286'
  },
  tileTitle: {
    display: 'block',
    fontFamily: 'Georgia, serif',
    fontSize: 16,
    lineHeight: 1.2,
    letterSpacing: '-0.025em',
    '@media (max-width: 520px)': {
      fontSize: 14
    },
  },
  tileArrow: {
    marginLeft: 'auto',
    fontSize: 12,
    color: '#8a8a7e'
  },
  tileCategory: {
    display: 'block',
    marginTop: 5,
    marginLeft: 25,
    fontSize: 8,
    color: '#949488',
    letterSpacing: '0.12em'
  },
  detail: {
    minHeight: 520
  },
  detailTopline: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  backButton: {
    display: 'inline-flex',
    gap: 7,
    alignItems: 'center',
    padding: 0,
    fontSize: 11,
    color: '#676b60',
    cursor: 'pointer',
    background: 'transparent',
    borderColor: 'currentColor',
    borderStyle: 'none',
    borderWidth: '0',
    ':hover': {
      color: '#242a24'
    },
    ':focus-visible': {
      outline: '2px solid #78836f',
      outlineOffset: 4,
      borderRadius: 3
    },
  },
  hero: {
    position: 'relative',
    isolation: 'isolate'
  },
  artwork: {
    position: 'relative',
    display: 'block',
    width: '100%',
    aspectRatio: '0.92',
    overflow: 'hidden',
    borderRadius: 9,
    contain: 'paint'
  },
  heroArtwork: {
    aspectRatio: '1.85',
    borderRadius: 12,
    '@media (max-width: 520px)': {
      aspectRatio: '1.2'
    }
  },
  sand: {
    background: 'radial-gradient(circle at 78% 22%, #f5e8ce 0 11%, transparent 11.5%), radial-gradient(ellipse at 10% 110%, #936950 0 35%, transparent 35.5%), radial-gradient(ellipse at 94% 112%, #c49371 0 48%, transparent 48.5%), linear-gradient(145deg, #f0dfc2, #d9b99b)',
  },
  tide: {
    background: 'radial-gradient(circle at 76% 22%, #e7d6ac 0 10%, transparent 10.5%), radial-gradient(ellipse at 90% 110%, #335d62 0 45%, transparent 45.5%), radial-gradient(ellipse at 10% 100%, #789b96 0 46%, transparent 46.5%), linear-gradient(145deg, #a9c2bd, #547b7c)',
  },
  bloom: {
    background: 'radial-gradient(circle at 78% 22%, #f5e8ce 0 11%, transparent 11.5%), linear-gradient(145deg, #f0cfc1, #dc9e91)'
  },
  grove: {
    background: 'radial-gradient(circle at 76% 20%, #e8dfc6 0 12%, transparent 12.5%), radial-gradient(ellipse at 50% 120%, #506a55 0 58%, transparent 58.5%), linear-gradient(145deg, #c0c8ae, #788b77)',
  },
  stem: {
    position: 'absolute',
    bottom: '10%',
    left: '49%',
    width: '3%',
    height: '38%',
    background: '#65795a',
    borderRadius: 99,
    rotate: '5deg'
  },
  leaf: {
    position: 'absolute',
    bottom: '23%',
    left: '36%',
    width: '21%',
    height: '10%',
    background: '#7e9168',
    borderRadius: '100% 0 100% 0',
    rotate: '-25deg'
  },
  flower: {
    position: 'absolute',
    top: '27%',
    left: '34%',
    width: '34%',
    aspectRatio: '1',
    background: 'repeating-conic-gradient(#f4d7a8 0deg 18deg, #d78f7d 19deg 36deg)',
    borderRadius: '50%',
  },
  flowerCenter: {
    position: 'absolute',
    top: '39%',
    left: '46%',
    width: '10%',
    aspectRatio: '1',
    background: '#9b6652',
    borderRadius: '50%'
  },
  vesselShadow: {
    position: 'absolute',
    bottom: '17%',
    left: '28%',
    width: '46%',
    height: '8%',
    background: 'rgb(40 54 41 / 0.2)',
    borderRadius: '50%',
    filter: 'blur(5px)'
  },
  vessel: {
    position: 'absolute',
    bottom: '20%',
    left: '37%',
    width: '28%',
    height: '47%',
    background: 'linear-gradient(105deg, #e6d8bc, #bcae8f 72%, #9a967d)',
    filter: 'drop-shadow(8px 12px 10px rgb(39 51 39 / 0.18))',
    clipPath: 'polygon(27% 0, 73% 0, 78% 25%, 100% 43%, 88% 100%, 12% 100%, 0 43%, 22% 25%)',
  },
  vesselRim: {
    position: 'absolute',
    top: '32%',
    left: '44%',
    width: '14%',
    height: '4%',
    background: '#8f8e78',
    borderRadius: '50%'
  },
  artIndex: {
    position: 'absolute',
    bottom: 9,
    left: 11,
    zIndex: 1,
    fontSize: 7,
    fontWeight: 600,
    color: 'rgb(255 252 241 / 0.8)',
    letterSpacing: '0.13em'
  },
  heroShade: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    height: '48%',
    pointerEvents: 'none',
    background: 'linear-gradient(transparent, rgb(24 31 26 / 0.55))',
    borderRadius: '0 0 12px 12px'
  },
  heroTitle: {
    position: 'absolute',
    right: 20,
    bottom: 27,
    left: 22,
    zIndex: 2,
    margin: 0,
    fontFamily: 'Georgia, serif',
    fontSize: 42,
    fontWeight: 400,
    lineHeight: 1.05,
    color: '#fffdf6',
    letterSpacing: '-0.045em',
    textShadow: '0 2px 16px rgb(0 0 0 / 0.14)',
    '@media (max-width: 520px)': {
      right: 14,
      bottom: 20,
      left: 15,
      fontSize: 32
    },
  },
  heroCategory: {
    position: 'absolute',
    right: 20,
    bottom: 14,
    zIndex: 2,
    fontSize: 8,
    fontWeight: 600,
    color: 'rgb(255 252 241 / 0.8)',
    letterSpacing: '0.14em'
  },
  detailCopy: {
    maxWidth: 520,
    padding: '17px 2px 8px'
  },
  detailDescription: {
    margin: 0,
    fontFamily: 'Georgia, serif',
    fontSize: 17,
    lineHeight: 1.5,
    color: '#62665c'
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    paddingTop: 13,
    marginTop: 24,
    fontSize: 8,
    fontWeight: 600,
    color: '#929286',
    letterSpacing: '0.12em',
    borderTopColor: '#e6e3da',
    borderTopStyle: 'solid',
    borderTopWidth: '1px',
  },
});
`,
  },
];
export type ExampleName = 'card' | 'merge' | 'view-transition';

export const EXAMPLES: Record<ExampleName, SampleFile[]> = {
  card: SAMPLE_FILES,
  merge: MERGE_FILES,
  'view-transition': VIEW_TRANSITION_FILES,
};

export function exampleFromSearch(search: string): ExampleName {
  const name = new URLSearchParams(search).get('example');
  return name && Object.hasOwn(EXAMPLES, name) ? (name as ExampleName) : 'card';
}
