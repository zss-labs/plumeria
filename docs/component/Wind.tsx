import * as css from '@plumeria/core';
import * as t from '@plumeria/wind';
import { theme } from 'lib/theme';

const palettes = {
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

const shades = Object.keys(t.red);

const styles = css.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: '5rem repeat(11, minmax(0, 1fr))',
    gap: 4,
    alignItems: 'center',
    overflowX: 'auto',
  },
  label: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  shade: {
    fontSize: 11,
    color: theme.textSecondary,
    textAlign: 'center',
  },
  swatch: (value: string) => ({
    height: 32,
    backgroundColor: value,
    borderRadius: 4,
  }),
});

export function Palettes() {
  return (
    <div classStyle={styles.grid}>
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
          <span key={`${name}-${shade}`} title={value} classStyle={styles.swatch(value)} />
        )),
      ])}
    </div>
  );
}

const accessOf = (name: string, key: string) => {
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return `t.${name}.${key}`;
  if (/^(0|[1-9]\d*)$/.test(key)) return `t.${name}[${key}]`;
  return `t.${name}['${key}']`;
};

export function Scale({ name }: { name: keyof typeof scales }) {
  return (
    <table>
      <tbody>
        {Object.entries(scales[name]).map(([key, value]) => (
          <tr key={key}>
            <td>
              <code>{accessOf(name, key)}</code>
            </td>
            <td>
              <code>{value}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
