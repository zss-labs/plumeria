import * as css from '@plumeria/core';
import {
  amber,
  animate,
  aspect,
  blue,
  blur,
  breakpoint,
  color,
  container,
  cyan,
  dropShadow,
  ease,
  emerald,
  font,
  fontWeight,
  fuchsia,
  gray,
  green,
  indigo,
  insetShadow,
  leading,
  lime,
  mauve,
  mist,
  neutral,
  olive,
  orange,
  perspective,
  pink,
  purple,
  radius,
  red,
  rose,
  shadow,
  sky,
  slate,
  spacing,
  stone,
  taupe,
  teal,
  text,
  textLineHeight,
  textShadow,
  tracking,
  transition,
  violet,
  yellow,
  zinc,
} from '@plumeria/wind';
import { theme } from 'lib/theme';

const palettes = {
  red,
  orange,
  amber,
  yellow,
  lime,
  green,
  emerald,
  teal,
  cyan,
  sky,
  blue,
  indigo,
  violet,
  purple,
  fuchsia,
  pink,
  rose,
  slate,
  gray,
  zinc,
  neutral,
  stone,
  mauve,
  olive,
  mist,
  taupe,
};

const scales = {
  color,
  font,
  text,
  textLineHeight,
  fontWeight,
  tracking,
  leading,
  spacing,
  radius,
  shadow,
  insetShadow,
  dropShadow,
  textShadow,
  blur,
  perspective,
  aspect,
  breakpoint,
  container,
  ease,
  transition,
  animate,
};

const shades = Object.keys(red);

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
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return `${name}.${key}`;
  if (/^(0|[1-9]\d*)$/.test(key)) return `${name}[${key}]`;
  return `${name}['${key}']`;
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
