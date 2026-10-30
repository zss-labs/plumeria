import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(process.argv[2], 'utf-8');
const theme = source.slice(
  source.indexOf('@theme default {'),
  source.indexOf('\n}', source.indexOf('@theme default {')),
);

const keyframesBlocks = [];
const variables = theme
  .replace(
    /@keyframes ([\w-]+) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g,
    (_, name, body) => {
      keyframesBlocks.push([name, body]);
      return '';
    },
  )
  .matchAll(/--([\w-]+):\s*([^;]+);/g);

const groups = new Map();
const add = (group, key, value) => {
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push([key, value.replace(/\s+/g, ' ').trim()]);
};

const camel = (name) => name.replace(/-(\w)/g, (_, c) => c.toUpperCase());

const PREFIXES = [
  ['inset-shadow', 'insetShadow'],
  ['drop-shadow', 'dropShadow'],
  ['text-shadow', 'textShadow'],
  ['font-weight', 'fontWeight'],
  ['breakpoint', 'breakpoint'],
  ['container', 'container'],
  ['tracking', 'tracking'],
  ['leading', 'leading'],
  ['radius', 'radius'],
  ['shadow', 'shadow'],
  ['font', 'font'],
  ['ease', 'ease'],
  ['blur', 'blur'],
  ['perspective', 'perspective'],
  ['aspect', 'aspect'],
];

let spacingUnit = null;
const animations = [];
for (const [, name, value] of variables) {
  const color = name.match(/^color-([a-z]+)-(\d+)$/);
  if (color) {
    add(color[1], color[2], value);
    continue;
  }
  const single = name.match(/^color-([a-z]+)$/);
  if (single) {
    add('color', single[1], value);
    continue;
  }
  const transition = name.match(/^default-transition-([\w-]+)$/);
  if (transition) {
    add('transition', camel(transition[1]), value);
    continue;
  }
  const text = name.match(/^text-([\w]+?)(--line-height)?$/);
  if (text) {
    add(text[2] ? 'textLineHeight' : 'text', text[1], value);
    continue;
  }
  if (name === 'spacing') {
    spacingUnit = value.trim();
    continue;
  }
  const animate = name.match(/^animate-([\w-]+)$/);
  if (animate) {
    animations.push([animate[1], value.trim()]);
    continue;
  }
  const prefix = PREFIXES.find(([p]) => name.startsWith(`${p}-`));
  if (prefix) add(prefix[1], name.slice(prefix[0].length + 1), value);
}

const SPACING = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24,
  28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96,
];
const [amount, unit] = [
  parseFloat(spacingUnit),
  spacingUnit.replace(/^[\d.]+/, ''),
];
groups.set('spacing', [
  ['px', '1px'],
  ...SPACING.map((step) => [
    String(step),
    step === 0 ? '0' : `${+(step * amount).toFixed(4)}${unit}`,
  ]),
]);

const keyframes = keyframesBlocks.map(([name, body]) => {
  const frames = [];
  for (const [, selectors, declarations] of body.matchAll(
    /([^{}]+)\{([^{}]*)\}/g,
  )) {
    const style = Object.fromEntries(
      [...declarations.matchAll(/([\w-]+):\s*([^;]+);/g)].map(([, p, v]) => [
        camel(p),
        v.trim(),
      ]),
    );
    for (const selector of selectors.split(',')) {
      frames.push([selector.trim(), style]);
    }
  }
  return [camel(name), Object.fromEntries(frames)];
});

const timings = animations.map(([, value]) => {
  const [keyframe, ...rest] = value.split(' ');
  return [camel(keyframe), rest.join(' ')];
});
if (timings.length > 0) groups.set('animate', timings);

const literal = (value) => JSON.stringify(value);
const objectOf = (entries, indent = '  ') =>
  `{\n${entries
    .map(([key, value]) =>
      typeof value === 'string'
        ? `${indent}${literal(key)}: ${literal(value)},`
        : `${indent}${literal(key)}: ${objectOf(Object.entries(value), `${indent}  `)},`,
    )
    .join('\n')}\n${indent.slice(2)}}`;

const body = [
  ...[...groups].map(
    ([name, entries]) =>
      `export const ${name} = css.createStatic(${objectOf(entries)});\n`,
  ),
  ...keyframes.map(
    ([name, frames]) =>
      `export const ${name} = css.keyframes(${objectOf(Object.entries(frames))});\n`,
  ),
].join('\n');

writeFileSync(
  fileURLToPath(new URL('../src/index.ts', import.meta.url)),
  `import * as css from '@plumeria/core';\n\n${body}`,
);
