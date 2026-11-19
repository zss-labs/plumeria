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
        <img sx={styles.logo} src="/icon.svg" alt="" width={20} height={20} />
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

const swatches = [
  { id: 'sand', name: 'Sand', hex: '#D9B99B' },
  { id: 'tide', name: 'Tide', hex: '#547B7C' },
  { id: 'bloom', name: 'Bloom', hex: '#DC9E91' },
  { id: 'moss', name: 'Moss', hex: '#788B77' },
] as const;

type Swatch = (typeof swatches)[number];

const fadeIn = css.keyframes({
  from: {
    opacity: 0,
  },
  to: {
    opacity: 1,
  },
});

const morph = css.viewTransitionClass({
  group: {
    animationDuration: '0.45s',
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  old: {
    height: '100%',
    mixBlendMode: 'normal',
    animationName: 'none',
  },
  new: {
    height: '100%',
    mixBlendMode: 'normal',
    animationName: fadeIn,
    animationDuration: '0.45s',
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
});

const label = css.viewTransitionClass({
  group: {
    animationDuration: '0.45s',
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  old: {
    animationName: 'none',
    opacity: 0,
  },
  new: {
    animationName: 'none',
  },
});

export const ViewTransitionDemo = () => {
  const [selected, setSelected] = useState<Swatch | null>(null);
  const select = (swatch: Swatch | null) => startTransition(() => setSelected(swatch));

  return (
    <main sx={styles.canvas}>
      <div sx={styles.frame}>
        {selected ? (
          <section sx={styles.detail}>
            <button type="button" sx={styles.back} onClick={() => select(null)}>
              ← Back
            </button>
            <ViewTransition name={'swatch-' + selected.id} share={morph}>
              <Color swatch={selected} hero />
            </ViewTransition>
            <div sx={styles.caption}>
              <ViewTransition name={'name-' + selected.id} share={label}>
                <h1 sx={styles.heroName}>{selected.name}</h1>
              </ViewTransition>
              <span sx={styles.hex}>{selected.hex}</span>
            </div>
          </section>
        ) : (
          <div sx={styles.grid}>
            {swatches.map((swatch) => (
              <button key={swatch.id} type="button" sx={styles.tile} onClick={() => select(swatch)}>
                <ViewTransition name={'swatch-' + swatch.id} share={morph}>
                  <Color swatch={swatch} />
                </ViewTransition>
                <ViewTransition name={'name-' + swatch.id} share={label}>
                  <span sx={styles.name}>{swatch.name}</span>
                </ViewTransition>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
};

function Color({ swatch, hero = false }: { swatch: Swatch; hero?: boolean }) {
  return (
    <span
      sx={[
        styles.swatch,
        hero && styles.hero,
        swatch.id === 'sand' && styles.sand,
        swatch.id === 'tide' && styles.tide,
        swatch.id === 'bloom' && styles.bloom,
        swatch.id === 'moss' && styles.moss,
      ]}
    />
  );
}

const styles = css.create({
  canvas: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    padding: 16,
    fontFamily: 'system-ui, sans-serif',
    color: '#2f3a32',
    colorScheme: 'light',
    background: '#e4e1d8',
  },
  frame: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 420,
    height: 360,
    maxHeight: 'calc(100dvh - 32px)',
    padding: 16,
    overflow: 'clip',
    background: '#fdfcf8',
    borderRadius: 16,
  },
  grid: {
    display: 'grid',
    gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
    height: '100%',
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minHeight: 0,
    padding: 0,
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    background: 'transparent',
    borderWidth: 0,
  },
  swatch: {
    display: 'block',
    flex: 1,
    width: '100%',
    minHeight: 0,
    borderRadius: 10,
  },
  hero: {
    borderRadius: 12,
  },
  name: {
    alignSelf: 'flex-start',
    fontSize: 13,
    fontWeight: 600,
  },
  detail: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    height: '100%',
  },
  back: {
    alignSelf: 'flex-start',
    padding: '4px 8px',
    marginLeft: -8,
    fontSize: 13,
    color: '#596055',
    cursor: 'pointer',
    background: 'transparent',
    borderWidth: 0,
    borderRadius: 8,
    ':hover': {
      background: '#ece9e1',
    },
  },
  caption: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  heroName: {
    margin: 0,
    fontSize: 22,
    fontWeight: 600,
  },
  hex: {
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    color: '#596055',
  },
  sand: {
    background: '#d9b99b',
  },
  tide: {
    background: '#547b7c',
  },
  bloom: {
    background: '#dc9e91',
  },
  moss: {
    background: '#788b77',
  },
});
`,
  },
];

const POSITION_TRY_FILES: SampleFile[] = [
  {
    path: ENTRY,
    label: 'PositionTry.tsx',
    source: `import * as css from '@plumeria/core';
import { useState } from 'react';

const files = [
  'Brand guide.pdf',
  'Q3 report.xlsx',
  'Hero image.png',
  'Pitch deck.key',
  'Invoice 0412.pdf',
  'Meeting notes.md',
  'Logo final.svg',
  'Roadmap.fig',
  'Budget 2027.xlsx',
  'Interview.mp4',
  'Contract.docx',
  'Moodboard.png',
];

const actions = ['Open', 'Rename', 'Duplicate', 'Move to…', 'Share', 'Download', 'Delete'];

const shrink = css.positionTry({
  positionArea: 'bottom span-left',
  maxHeight: 'calc(100% - 8px)',
});

export const PositionTryDemo = () => {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <main sx={styles.canvas}>
      <div sx={styles.frame}>
        <ul sx={styles.list}>
          {files.map((file) => (
            <li key={file} sx={styles.row}>
              <span>{file}</span>
              <button
                type="button"
                sx={styles.more}
                aria-label={'Actions for ' + file}
                aria-expanded={open === file}
                onClick={() => setOpen(open === file ? null : file)}
              >
                ⋯
              </button>
              {open === file && (
                <ul sx={styles.menu}>
                  {actions.map((action) => (
                    <li key={action}>
                      <button type="button" sx={styles.action} onClick={() => setOpen(null)}>
                        {action}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
};

const styles = css.create({
  canvas: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    padding: 16,
    fontFamily: 'system-ui, sans-serif',
    colorScheme: 'light',
    background: '#e4e1d8',
  },
  frame: {
    position: 'relative',
    width: '100%',
    maxWidth: 420,
    height: 360,
    maxHeight: 'calc(100dvh - 32px)',
    overflow: 'clip',
    background: '#fdfcf8',
    borderRadius: 16,
  },
  list: {
    height: '100%',
    padding: 0,
    margin: 0,
    overflowY: 'auto',
    listStyle: 'none',
  },
  row: {
    anchorScope: '--more',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px 10px 20px',
    fontSize: 14,
    color: '#2f3a32',
    borderBottomColor: '#ece9e1',
    borderBottomStyle: 'solid',
    borderBottomWidth: '1px',
  },
  more: {
    anchorName: '--more',
    width: 32,
    height: 32,
    fontSize: 16,
    color: '#596055',
    cursor: 'pointer',
    background: 'transparent',
    borderWidth: 0,
    borderRadius: 8,
    ':hover': {
      background: '#ece9e1',
    },
  },
  menu: {
    position: 'absolute',
    positionAnchor: '--more',
    positionArea: 'bottom span-left',
    positionTryOrder: 'most-height',
    positionTryFallbacks: \`flip-block, \${shrink}, \${shrink} flip-block\`,
    zIndex: 1,
    boxSizing: 'border-box',
    width: 168,
    padding: 6,
    marginTop: 8,
    marginBottom: 0,
    overflowY: 'auto',
    listStyle: 'none',
    background: '#ffffff',
    borderRadius: 12,
    boxShadow: '0 12px 32px rgb(47 58 50 / 0.18)',
  },
  action: {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    color: '#2f3a32',
    textAlign: 'left',
    cursor: 'pointer',
    background: 'transparent',
    borderWidth: 0,
    borderRadius: 8,
    ':hover': {
      background: '#f1efe9',
    },
  },
});
`,
  },
];

const VAR_TYPE_FILES: SampleFile[] = [
  {
    path: ENTRY,
    label: 'VarType.tsx',
    source: `import * as css from '@plumeria/core';
import { useState } from 'react';

const steps = [25, 50, 75, 100] as const;

const progress = css.varType({
  syntax: '<integer>',
  inherits: true,
  initialValue: '0',
});

const tint = css.varType({
  syntax: '<color>',
  inherits: true,
  initialValue: '#547b7c',
});

export const VarTypeDemo = () => {
  const [step, setStep] = useState<number>(25);

  return (
    <main sx={styles.canvas}>
      <div sx={styles.pair}>
        <figure
          sx={[
            styles.figure,
            step === 25 && styles.quarter,
            step === 50 && styles.half,
            step === 75 && styles.threeQuarters,
            step === 100 && styles.full,
          ]}
        >
          <div sx={[styles.ring, styles.plainRing]} />
          <div sx={[styles.swatch, styles.plainSwatch]} />
          <figcaption sx={styles.caption}>--plain</figcaption>
        </figure>
        <figure
          sx={[
            styles.figure,
            step === 25 && styles.quarter,
            step === 50 && styles.half,
            step === 75 && styles.threeQuarters,
            step === 100 && styles.full,
          ]}
        >
          <div sx={[styles.ring, styles.typedRing]} />
          <div sx={[styles.swatch, styles.typedSwatch]} />
          <figcaption sx={styles.caption}>css.varType</figcaption>
        </figure>
      </div>
      <div sx={styles.controls}>
        {steps.map((value) => (
          <button
            key={value}
            type="button"
            sx={[styles.step, step === value && styles.active]}
            aria-pressed={step === value}
            onClick={() => setStep(value)}
          >
            {value}%
          </button>
        ))}
      </div>
    </main>
  );
};

const styles = css.create({
  canvas: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    gap: 'min(28px, 4vh)',
    placeContent: 'safe center',
    justifyItems: 'center',
    padding: 16,
    overflowY: 'auto',
    fontFamily: 'system-ui, sans-serif',
    colorScheme: 'light',
    background: '#f3f1ec',
  },
  pair: {
    display: 'flex',
    gap: 'min(24px, 5vw)',
  },
  figure: {
    display: 'grid',
    gap: 12,
    justifyItems: 'center',
    margin: 0,
  },
  caption: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 12,
    color: '#596055',
  },
  ring: {
    display: 'grid',
    placeItems: 'center',
    width: 'min(140px, 36vw, 28vh)',
    aspectRatio: '1',
    borderRadius: '50%',
    containerType: 'inline-size',
    '::after': {
      fontSize: '20cqi',
      fontWeight: 600,
      fontVariantNumeric: 'tabular-nums',
      color: '#2f3a32',
      content: 'counter(value) "%"',
    },
  },
  swatch: {
    width: '100%',
    height: 'min(56px, 10vh)',
    borderRadius: 12,
  },
  plainRing: {
    counterReset: 'value var(--plain)',
    background: 'radial-gradient(closest-side, #fdfcf8 78%, transparent 80%), conic-gradient(#547b7c calc(var(--plain) * 1%), #e4e1d8 0)',
    transition: '--plain 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)',
  },
  typedRing: {
    counterReset: \`value var(\${progress})\`,
    background: \`radial-gradient(closest-side, #fdfcf8 78%, transparent 80%), conic-gradient(#547b7c calc(var(\${progress}) * 1%), #e4e1d8 0)\`,
    transition: \`\${progress} 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)\`,
  },
  plainSwatch: {
    background: 'linear-gradient(135deg, var(--plain-tint), #2f3a32)',
    transition: '--plain-tint 0.8s ease',
  },
  typedSwatch: {
    background: \`linear-gradient(135deg, var(\${tint}), #2f3a32)\`,
    transition: \`\${tint} 0.8s ease\`,
  },
  quarter: {
    '--plain': '25',
    '--plain-tint': '#547b7c',
    [progress]: '25',
    [tint]: '#547b7c',
  },
  half: {
    '--plain': '50',
    '--plain-tint': '#788b77',
    [progress]: '50',
    [tint]: '#788b77',
  },
  threeQuarters: {
    '--plain': '75',
    '--plain-tint': '#dc9e91',
    [progress]: '75',
    [tint]: '#dc9e91',
  },
  full: {
    '--plain': '100',
    '--plain-tint': '#d9b99b',
    [progress]: '100',
    [tint]: '#d9b99b',
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  step: {
    padding: '8px 14px',
    fontSize: 14,
    fontWeight: 600,
    color: '#596055',
    cursor: 'pointer',
    background: '#fdfcf8',
    borderWidth: 0,
    borderRadius: 999,
    ':hover': {
      background: '#ece9e1',
    },
  },
  active: {
    color: '#fdfcf8',
    background: '#547b7c',
    ':hover': {
      background: '#547b7c',
    },
  },
});
`,
  },
];

export type ExampleName = 'card' | 'merge' | 'view-transition' | 'position-try' | 'var-type';

export const EXAMPLES: Record<ExampleName, SampleFile[]> = {
  card: SAMPLE_FILES,
  merge: MERGE_FILES,
  'view-transition': VIEW_TRANSITION_FILES,
  'position-try': POSITION_TRY_FILES,
  'var-type': VAR_TYPE_FILES,
};

export function exampleFromSearch(search: string): ExampleName {
  const name = new URLSearchParams(search).get('example');
  return name && Object.hasOwn(EXAMPLES, name) ? (name as ExampleName) : 'card';
}
