import * as css from '@plumeria/core';
import * as t from '@plumeria/wind';
import { breakpoints } from 'lib/mediaQuery';
import { theme } from 'lib/theme';
import type { ReactNode } from 'react';

const hues = {
  red: t.red,
  orange: t.orange,
  amber: t.amber,
  yellow: t.yellow,
  lime: t.lime,
  green: t.green,
  emerald: t.emerald,
  teal: t.teal,
  cyan: t.cyan,
  sky: t.sky,
  blue: t.blue,
  indigo: t.indigo,
  violet: t.violet,
  purple: t.purple,
  fuchsia: t.fuchsia,
  pink: t.pink,
  rose: t.rose,
};

const neutrals = {
  slate: t.slate,
  gray: t.gray,
  zinc: t.zinc,
  neutral: t.neutral,
  stone: t.stone,
  mauve: t.mauve,
  olive: t.olive,
  mist: t.mist,
  taupe: t.taupe,
};

const scales = {
  color: t.color,
  font: t.font,
  text: t.text,
  textLineHeight: t.textLineHeight,
  fontWeight: t.fontWeight,
  tracking: t.tracking,
  leading: t.leading,
  spacing: t.spacing,
  radius: t.radius,
  shadow: t.shadow,
  insetShadow: t.insetShadow,
  dropShadow: t.dropShadow,
  textShadow: t.textShadow,
  blur: t.blur,
  perspective: t.perspective,
  aspect: t.aspect,
  breakpoint: t.breakpoint,
  container: t.container,
  ease: t.ease,
  transition: t.transition,
  animate: t.animate,
};

type ScaleName = keyof typeof scales;

const shades = Object.keys(t.red);

const styles = css.create({
  palette: {
    display: 'grid',
    gridTemplateColumns: '4.5rem repeat(11, minmax(0, 1fr))',
    gap: 3,
    alignItems: 'center',
    marginBottom: 24,
    [breakpoints.sm]: {
      gridTemplateColumns: '3.25rem repeat(11, minmax(0, 1fr))',
      gap: 2,
    },
  },
  label: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  shade: {
    fontSize: 11,
    color: theme.textSecondary,
    textAlign: 'center',
    [breakpoints.sm]: {
      fontSize: 9,
    },
  },
  swatch: (value: string) => ({
    height: 28,
    backgroundColor: value,
    borderRadius: 4,
    boxShadow: 'inset 0 0 0 1px rgb(128 128 128 / 0.15)',
  }),
  rows: {
    display: 'grid',
    gridTemplateColumns: 'max-content max-content minmax(0, 1fr)',
    columnGap: 24,
    borderTopColor: 'var(--color-fd-border)',
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    [breakpoints.sm]: {
      gridTemplateColumns: 'max-content minmax(0, 1fr)',
    },
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    gridColumn: '1 / -1',
    rowGap: 6,
    alignItems: 'center',
    minHeight: 29,
    padding: '4px 0',
    borderBottomColor: 'var(--color-fd-border)',
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
  },
  preview: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    overflow: 'hidden',
    color: theme.textPrimary,
    [breakpoints.sm]: {
      gridColumn: '1 / -1',
    },
  },
  tiles: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '20px 16px',
    [breakpoints.sm]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
  wideTiles: {
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    [breakpoints.sm]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  stage: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 80,
    marginBottom: 6,
    overflow: 'hidden',
    color: theme.textPrimary,
    backgroundColor: 'var(--color-fd-muted)',
    borderRadius: 8,
  },
  // Every shadow token is black, so its stage stays light in dark mode too.
  shadowStage: {
    color: '#0b0b0b',
    backgroundColor: '#e4e4e7',
  },
  token: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    lineHeight: 1.5,
    color: theme.textPrimary,
    overflowWrap: 'anywhere',
  },
  muted: {
    color: theme.textSecondary,
  },
});

const samples = css.create({
  color: (value: string) => ({
    width: 20,
    height: 20,
    backgroundColor: value,
    borderRadius: 4,
    boxShadow: 'inset 0 0 0 1px rgb(128 128 128 / 0.3)',
  }),
  fontFamily: (value: string) => ({
    fontFamily: value,
    fontSize: 36,
    lineHeight: 1,
  }),
  fontSize: (value: string) => ({
    fontSize: value,
    lineHeight: 1,
  }),
  fontWeight: (value: string) => ({
    fontSize: 22,
    fontWeight: value,
    lineHeight: 1,
  }),
  tracking: (value: string) => ({
    fontSize: 14,
    letterSpacing: value,
    whiteSpace: 'nowrap',
  }),
  leading: (value: string) => ({
    fontSize: 14,
    lineHeight: value,
  }),
  bar: (width: string) => ({
    flexShrink: 0,
    width,
    height: 12,
    backgroundColor: 'var(--plumeria-accent)',
    borderRadius: 1,
  }),
  aspect: (value: string) => ({
    height: 40,
    aspectRatio: value,
    backgroundColor: 'var(--plumeria-accent)',
    borderRadius: 2,
  }),
  radius: (value: string) => ({
    width: 56,
    height: 56,
    backgroundColor: 'var(--plumeria-accent)',
    borderRadius: value,
  }),
  shadow: (value: string) => ({
    width: 64,
    height: 40,
    backgroundColor: '#fff',
    borderRadius: 8,
    boxShadow: value,
  }),
  dropShadow: (value: string) => ({
    width: 40,
    height: 40,
    backgroundColor: '#fff',
    borderRadius: '50%',
    filter: value,
  }),
  textShadow: (value: string) => ({
    fontSize: 36,
    fontWeight: 700,
    lineHeight: 1,
    color: '#fff',
    textShadow: value,
  }),
  blur: (value: string) => ({
    width: 48,
    height: 48,
    backgroundColor: 'var(--plumeria-accent)',
    borderRadius: '50%',
    filter: value,
  }),
  perspective: (value: string) => ({
    perspective: value,
  }),
  tilted: {
    display: 'block',
    width: 48,
    height: 48,
    backgroundColor: 'var(--plumeria-accent)',
    borderRadius: 4,
    transform: 'rotateY(50deg)',
  },
  curve: {
    display: 'block',
    width: 56,
    height: 56,
    borderColor: 'var(--color-fd-border)',
    borderStyle: 'solid',
    borderWidth: 1,
    fill: 'none',
    stroke: 'currentColor',
  },
  animated: {
    display: 'block',
    width: 28,
    height: 28,
    backgroundColor: 'var(--plumeria-accent)',
    borderRadius: 4,
  },
});

const motion = css.create({
  spin: {
    animation: `${t.spin} ${t.animate.spin}`,
  },
  ping: {
    animation: `${t.ping} ${t.animate.ping}`,
  },
  pulse: {
    animation: `${t.pulse} ${t.animate.pulse}`,
  },
  bounce: {
    animation: `${t.bounce} ${t.animate.bounce}`,
  },
});

const ratioOf = (value: string, max: string) => `${(parseFloat(value) / parseFloat(max)) * 100}%`;

const rowPreviews: Partial<Record<ScaleName, (value: string) => ReactNode>> = {
  color: (value) => <span classStyle={samples.color(value)} />,
  text: (value) => <span classStyle={samples.fontSize(value)}>Aa</span>,
  fontWeight: (value) => <span classStyle={samples.fontWeight(value)}>Aa</span>,
  tracking: (value) => <span classStyle={samples.tracking(value)}>The quick brown fox</span>,
  leading: (value) => (
    <span classStyle={samples.leading(value)}>
      The quick brown fox
      <br />
      jumps over the lazy dog
    </span>
  ),
  spacing: (value) => <span classStyle={samples.bar(value)} />,
  aspect: (value) => <span classStyle={samples.aspect(value)} />,
  breakpoint: (value) => <span classStyle={samples.bar(ratioOf(value, scales.breakpoint['2xl']))} />,
  container: (value) => <span classStyle={samples.bar(ratioOf(value, scales.container['7xl']))} />,
};

const tilePreviews: Partial<Record<ScaleName, (value: string, key: string) => ReactNode>> = {
  font: (value) => <span classStyle={samples.fontFamily(value)}>Aa</span>,
  radius: (value) => <span classStyle={samples.radius(value)} />,
  shadow: (value) => <span classStyle={samples.shadow(value)} />,
  insetShadow: (value) => <span classStyle={samples.shadow(value)} />,
  dropShadow: (value) => <span classStyle={samples.dropShadow(`drop-shadow(${value})`)} />,
  textShadow: (value) => <span classStyle={samples.textShadow(value)}>Aa</span>,
  blur: (value) => <span classStyle={samples.blur(`blur(${value})`)} />,
  perspective: (value) => (
    <span classStyle={samples.perspective(value)}>
      <span classStyle={samples.tilted} />
    </span>
  ),
  ease: (value) => {
    const [x1, y1, x2, y2] = (value.match(/[\d.]+/g) ?? []).map(Number);
    return (
      <svg classStyle={samples.curve} viewBox="0 0 1 1">
        <path d={`M0 1C${x1} ${1 - y1} ${x2} ${1 - y2} 1 0`} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    );
  },
  animate: (_, key) => <span classStyle={[samples.animated, motion[key as keyof typeof motion]]} />,
};

const wideScales: ScaleName[] = ['font', 'shadow', 'insetShadow', 'dropShadow', 'textShadow', 'perspective', 'ease'];
const shadowScales: ScaleName[] = ['shadow', 'insetShadow', 'dropShadow', 'textShadow'];

const accessOf = (key: string) => {
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return `.${key}`;
  if (/^(0|[1-9]\d*)$/.test(key)) return `[${key}]`;
  return `['${key}']`;
};

function Token({ name, entry }: { name: ScaleName; entry: string }) {
  return (
    <span classStyle={styles.token}>
      <span classStyle={styles.muted}>t.{name}</span>
      {accessOf(entry)}
    </span>
  );
}

function PaletteGrid({ palettes }: { palettes: Record<string, Record<string, string>> }) {
  return (
    <div classStyle={styles.palette}>
      <span />
      {shades.map((shade) => (
        <span key={shade} classStyle={styles.shade}>
          {shade}
        </span>
      ))}
      {Object.entries(palettes).map(([name, palette]) => [
        <span key={name} classStyle={styles.label}>
          {name}
        </span>,
        ...Object.entries(palette).map(([shade, value]) => (
          <span key={`${name}-${shade}`} title={`t.${name}[${shade}] ${value}`} classStyle={styles.swatch(value)} />
        )),
      ])}
    </div>
  );
}

export function Palettes() {
  return (
    <>
      <PaletteGrid palettes={hues} />
      <PaletteGrid palettes={neutrals} />
    </>
  );
}

export function Scale({ name }: { name: ScaleName }) {
  const entries = Object.entries(scales[name]);
  const tilePreview = tilePreviews[name];
  const rowPreview = rowPreviews[name];

  if (tilePreview) {
    return (
      <div classStyle={[styles.tiles, wideScales.includes(name) && styles.wideTiles]}>
        {entries.map(([key, value]) => (
          <div key={key} classStyle={styles.tile}>
            <div aria-hidden="true" classStyle={[styles.stage, shadowScales.includes(name) && styles.shadowStage]}>
              {tilePreview(value, key)}
            </div>
            <Token name={name} entry={key} />
            <span classStyle={[styles.token, styles.muted]}>{value}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div classStyle={styles.rows}>
      {entries.map(([key, value]) => (
        <div key={key} classStyle={styles.row}>
          <Token name={name} entry={key} />
          <span classStyle={[styles.token, styles.muted]}>{value}</span>
          {rowPreview && (
            <span aria-hidden="true" classStyle={styles.preview}>
              {rowPreview(value)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
