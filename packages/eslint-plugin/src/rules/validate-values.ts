/**
 * @fileoverview CSS 412 Properties valid value verification
 */

import { Rule } from 'eslint';
import { validData } from '../util/validData';
import { unitData } from '../util/unitData';
import {
  colorValue,
  colorSpaces as predefinedColorSpaces,
} from '../util/colorData';
import {
  isValidPlaceContent,
  isValidPlaceItems,
  isValidPlaceSelf,
  isValidTouchAction,
} from '../util/place';
import type {
  ImportSpecifier,
  Literal,
  ObjectExpression,
  Property,
  SpreadElement,
} from 'estree';
import { styleObjectFromValue } from '../util/styleObject';
import { styledRule } from '../util/styledCall';

// --- Static Constants & Arrays ---
const globalValues = ['inherit', 'initial', 'revert', 'revert-layer', 'unset'];

const lengthValueProperties = [
  'width',
  'maxWidth',
  'minWidth',
  'height',
  'maxHeight',
  'minHeight',
  'blockSize',
  'columnWidth',
  'flexBasis',
  'inlineSize',
  'background',
  'top',
  'bottom',
  'left',
  'right',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'fontSize',
  'lineHeight',
  'insetBlockEnd',
  'insetBlockStart',
  'insetInlineEnd',
  'insetInlineStart',
  'marginBlockEnd',
  'marginBlockStart',
  'paddingBlockEnd',
  'paddingBlockStart',
  'paddingInlineEnd',
  'paddingInlineStart',
  'marginInlineEnd',
  'marginInlineStart',
  'maxBlockSize',
  'minBlockSize',
  'maxInlineSize',
  'minInlineSize',
  'offsetDistance',
  'borderTopWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'borderBlockStartWidth',
  'borderBlockEndWidth',
  'borderInlineStartWidth',
  'borderInlineEndWidth',
  'columnRuleWidth',
  'outlineWidth',
  'outlineOffset',
  'perspective',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'columnGap',
  'rowGap',
  'rx',
  'ry',
  'scrollMarginBlockEnd',
  'scrollMarginBlockStart',
  'scrollMarginInlineEnd',
  'scrollMarginInlineStart',
  'scrollMarginBottom',
  'scrollMarginLeft',
  'scrollMarginRight',
  'scrollMarginTop',
  'scrollPaddingBlockEnd',
  'scrollPaddingBlockStart',
  'scrollPaddingInlineEnd',
  'scrollPaddingInlineStart',
  'scrollPaddingBottom',
  'scrollPaddingLeft',
  'scrollPaddingRight',
  'scrollPaddingTop',
  'baselineShift',
  'shapeMargin',
  'strokeDashoffset',
  'strokeWidth',
  'textDecorationThickness',
  'textUnderlineOffset',
  'verticalAlign',
  'x',
  'y',
  'zoom',
  'cx',
  'cy',
  'columnHeight',
  'lineHeightStep',
  'ruleWidth',
  'rowRuleWidth',
  'WebkitTextStrokeWidth',
  'gridColumnGap',
  'gridRowGap',
];

const lengthPercentage = [
  'animationRange',
  'animationRangeEnd',
  'animationRangeStart',
  'width',
  'maxWidth',
  'minWidth',
  'height',
  'maxHeight',
  'minHeight',
  'flexBasis',
  'blockSize',
  'columnWidth',
  'inlineSize',
  'fontSize',
  'lineHeight',
  'top',
  'bottom',
  'left',
  'right',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginBlock',
  'marginBlockStart',
  'marginBlockEnd',
  'marginInline',
  'marginInlineStart',
  'marginInlineEnd',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'insetBlock',
  'insetBlockStart',
  'insetBlockEnd',
  'insetInline',
  'insetInlineStart',
  'insetInlineEnd',
  'maskBorderWidth',
  'maskPosition',
  'maskSize',
  'maxBlockSize',
  'minBlockSize',
  'maxInlineSize',
  'minInlineSize',
  'offsetDistance',
  'offset',
  'paddingBlock',
  'paddingBlockEnd',
  'paddingBlockStart',
  'paddingInline',
  'paddingInlineEnd',
  'paddingInlineStart',
  'columnGap',
  'rowGap',
  'rx',
  'ry',
  'scrollPadding',
  'scrollPaddingBlock',
  'scrollPaddingBlockEnd',
  'scrollPaddingBlockStart',
  'scrollPaddingInline',
  'scrollPaddingInlineEnd',
  'scrollPaddingInlineStart',
  'scrollPaddingBottom',
  'scrollPaddingLeft',
  'scrollPaddingRight',
  'scrollPaddingTop',
  'shapeMargin',
  'x',
  'y',
  'zoom',
  'gap',
  'inset',
  'padding',
  'margin',
  'borderRadius',
  'borderEndEndRadius',
  'borderEndStartRadius',
  'borderStartEndRadius',
  'borderStartStartRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'backgroundPosition',
  'backgroundPositionX',
  'backgroundPositionY',
  'background',
  'backgroundSize',
  'strokeDasharray',
  'strokeDashoffset',
  'strokeWidth',
  'textDecorationThickness',
  'textUnderlineOffset',
  'transformOrigin',
  'verticalAlign',
  'cx',
  'cy',
  'gridColumnGap',
  'gridRowGap',
  'gridGap',
  'timelineTriggerActivationRange',
  'timelineTriggerActivationRangeEnd',
  'timelineTriggerActivationRangeStart',
  'timelineTriggerActiveRange',
  'timelineTriggerActiveRangeEnd',
  'timelineTriggerActiveRangeStart',
];

const insetProperties = [
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'insetBlock',
  'insetBlockStart',
  'insetBlockEnd',
  'insetInline',
  'insetInlineStart',
  'insetInlineEnd',
];
const anchorSizeProperties = [
  ...insetProperties,
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginBlock',
  'marginBlockStart',
  'marginBlockEnd',
  'marginInline',
  'marginInlineStart',
  'marginInlineEnd',
  'width',
  'minWidth',
  'maxWidth',
  'height',
  'minHeight',
  'maxHeight',
  'blockSize',
  'minBlockSize',
  'maxBlockSize',
  'inlineSize',
  'minInlineSize',
  'maxInlineSize',
];

const quotedString = `"[^"]*"|'[^']*'`;
const nestedContents = (depth: number): string =>
  depth === 0
    ? `(?:[^()"']|${quotedString})*`
    : `(?:[^()"']|${quotedString}|\\(${nestedContents(depth - 1)}\\))*`;
const mathContentsString = nestedContents(3);
const fitContentString = `fit-content\\(${mathContentsString}\\)`;
const minString = `min\\(${mathContentsString}\\)`;
const maxString = `max\\(${mathContentsString}\\)`;
const minmaxString = `minmax\\(${mathContentsString}\\)`;
const identStartString = '(?:[a-zA-Z_]|[^\\x00-\\x7F]|\\\\.)';
const identCharString = '(?:[a-zA-Z0-9_-]|[^\\x00-\\x7F]|\\\\.)';
const dashedIdentString = `--${identCharString}+`;
const customIdentString = `-?${identStartString}${identCharString}*`;
const cssVariablePlaceholder = '\u0001';
const canonicalCssVariable = (index: number) => `var(--x${index})`;
const varString = `(?:var\\(${dashedIdentString}(,\\s*[^\\)]+)?\\)|${cssVariablePlaceholder})`;
const varRegex = new RegExp(`^(${varString})$`);
const pureNumber = `(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))`;
const numberPattern = `(${pureNumber}|${varString})`;
const percentagePattern = `${pureNumber}%`;
const pureInteger = `(-?\\d+)`;
const integerPattern = `(${pureInteger}|${varString})`;
const lengthPattern = `0|${pureNumber}(?:${unitData.join('|')})`;
const pureAngle = `${pureNumber}(deg|rad|grad|turn)`;
const anglePattern = `(${pureAngle}|${varString})`;
const calcString = `calc\\(${mathContentsString}\\)`;
const anchorString = 'anchor\\([^()]*\\)';
const anchorSizeString = 'anchor-size\\([^()]*\\)';
const clampString = `clamp\\(${mathContentsString}\\)`;
const steppedValueString = `(?:round|mod|rem)\\(${mathContentsString}\\)`;
const absString = `abs\\(${mathContentsString}\\)`;
const gradientString =
  '(?:repeating-)?(?:linear|radial|conic)-gradient\\(.*\\)';
const urlString = `url\\([^\\)${cssVariablePlaceholder}]+\\)`;
const attrString = 'attr\\([^\\)]+\\)';
const addString = `add\\(${integerPattern}\\)`;
const counterString = 'counter\\([^\\)]+\\)';
const countersString = 'counters\\([^\\)]+\\)';
const doubleQuoteString = '"[^"]*"';
const singleQuoteString = "'[^']*'";
const stringString = `(?:${doubleQuoteString}|${singleQuoteString})`;
const functionContentsString = `(?=[^)]*[^\\s()])${mathContentsString}`;
const repeatString = `repeat\\(${functionContentsString}\\)`;
const imageSetString = `image-set\\(${functionContentsString}\\)`;
const colorSpaces =
  'srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|lab|oklab|xyz|xyz-d50|xyz-d65|hsl|hwb|lch|oklch';
const hueModifiers = '(?:\\s+(?:shorter|longer|increasing|decreasing)\\s+hue)?';
const colorSpacePattern = `in\\s+(?:${colorSpaces})${hueModifiers}`;

const paletteMixString = `palette-mix\\(${colorSpacePattern},\\s*(?:(${dashedIdentString}|${varString}))(?:\\s+(${percentagePattern}|${varString}))?,\\s*(?:(${dashedIdentString}|${varString}))(?:\\s+(${percentagePattern}|${varString}))?\\)`;
const colorFunctionPlaceholder = '\u0002';
const relativeChannel = `(?:[a-z]+|${pureNumber}(?:%|deg|rad|grad|turn)?|${calcString}|${varString})`;
const relativeChannelsRegex = new RegExp(
  `^${relativeChannel}(?:\\s+${relativeChannel}){2}(?:\\s*/\\s*${relativeChannel})?$`,
);
const relativeColorSpaceRegex = new RegExp(
  `^(?:${predefinedColorSpaces}|${dashedIdentString})$`,
);
const colorInterpolationRegex = new RegExp(`^${colorSpacePattern}$`);
const mixPercentageRegex = new RegExp(
  `^(?:${percentagePattern}|${varString})$`,
);
const colorFunctionSource =
  '(?<![\\w-])(color-mix|light-dark|rgba?|hsla?|hwb|lab|oklab|lch|oklch|color)\\(';

const colorRegex = new RegExp(
  `^(${colorValue}|${varString}|${colorFunctionPlaceholder})$`,
);
const colorSource = colorRegex.source.slice(1, -1);

function findClosingParenthesis(value: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let index = open; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function isColor(value: string): boolean {
  return colorRegex.test(normalizeColorFunctions(value.trim()));
}

function isValidMixComponent(value: string): boolean {
  const parts = splitColorValues(value);
  if (parts.length === 1) return isColor(parts[0]);
  if (parts.length !== 2) return false;
  if (mixPercentageRegex.test(parts[1])) return isColor(parts[0]);
  return mixPercentageRegex.test(parts[0]) && isColor(parts[1]);
}

function isValidColorFunction(name: string, args: string): boolean {
  if (name === 'color-mix') {
    const parts = splitTopLevelCommas(args);
    return (
      parts.length === 3 &&
      colorInterpolationRegex.test(parts[0]) &&
      isValidMixComponent(parts[1]) &&
      isValidMixComponent(parts[2])
    );
  }
  if (name === 'light-dark') {
    const parts = splitTopLevelCommas(args);
    return parts.length === 2 && isColor(parts[0]) && isColor(parts[1]);
  }
  const tokens = splitColorValues(args.trim());
  if (tokens[0] !== 'from' || tokens.length < 3 || !isColor(tokens[1])) {
    return false;
  }
  const channels = tokens.slice(name === 'color' ? 3 : 2);
  if (name === 'color' && !relativeColorSpaceRegex.test(tokens[2]))
    return false;
  return relativeChannelsRegex.test(channels.join(' '));
}

function normalizeColorFunctions(value: string): string {
  let normalized = '';
  let cursor = 0;
  const pattern = new RegExp(colorFunctionSource, 'g');
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    const name = match[1];
    const open = match.index + name.length;
    const close = findClosingParenthesis(value, open);
    if (close === -1) break;
    const args = value.slice(open + 1, close);
    const isComposite =
      name === 'color-mix' || name === 'light-dark' || /^\s*from\s/.test(args);
    if (!isComposite) continue;
    if (isValidColorFunction(name, args)) {
      normalized += value.slice(cursor, match.index) + colorFunctionPlaceholder;
      cursor = close + 1;
    }
    pattern.lastIndex = close + 1;
  }
  return normalized + value.slice(cursor);
}
const imageRegex = new RegExp(
  `^(${gradientString}|${urlString}|${imageSetString})$`,
);
const urlRegex = new RegExp(`^(${urlString})$`);
const sliceValuePattern =
  '^(?:-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)%?|fill)(?:\\s+(?:-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)%?|fill)){0,3}$';
const sliceRegex = new RegExp(`^(${sliceValuePattern})$`);

const otherGroupProperties = [
  'fontWeight',
  'opacity',
  'fillOpacity',
  'stopOpacity',
  'strokeOpacity',
  'flexGrow',
  'flexShrink',
  'boxFlex',
  'floodOpacity',
];
const integerGroupProperties = [
  'columnCount',
  'zIndex',
  'order',
  'orphans',
  'widows',
  'boxFlexGroup',
  'boxOrdinalGroup',
  'flexLineCount',
  'readingOrder',
  'lineClamp',
  'WebkitLineClamp',
  'maxLines',
  'hyphenateLimitLines',
];
const positiveIntegerProperties = [
  'columnCount',
  'orphans',
  'widows',
  'lineClamp',
  'WebkitLineClamp',
  'maxLines',
];
const multipleValueProperties = [
  'borderSpacing',
  'borderEndEndRadius',
  'borderEndStartRadius',
  'borderStartEndRadius',
  'borderStartStartRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderBlockWidth',
  'borderInlineWidth',
  'gap',
  'scale',
  'inset',
  'padding',
  'margin',
  'borderWidth',
  'borderImageWidth',
  'borderImageOutset',
  'gridGap',
];
const gridItemProperties = [
  'gridColumn',
  'gridColumnEnd',
  'gridColumnStart',
  'gridRow',
  'gridRowEnd',
  'gridRowStart',
  'gridArea',
];
const animationIterationCountProperties = ['animationIterationCount'];
const aspectRatioProperties = ['aspectRatio'];
const strokeMiterlimitProperties = ['strokeMiterlimit'];
const strokeDasharrayProperties = ['strokeDasharray'];
const maskBorderOutsetProperties = ['maskBorderOutset'];
const maskBorderSliceProperties = ['maskBorderSlice'];
const maskBorderWidthProperties = ['maskBorderWidth'];
const mathDepthProperties = ['mathDepth'];
const initialLetterProperties = ['initialLetter'];
const hyphenateLimitCharsProperties = ['hyphenateLimitChars'];
const shapeImageThresholdProperties = ['shapeImageThreshold'];
const columnsProperties = ['columns'];
const ruleInsetProperties = [
  'columnRuleInset',
  'columnRuleInsetCap',
  'columnRuleInsetCapEnd',
  'columnRuleInsetCapStart',
  'columnRuleInsetEnd',
  'columnRuleInsetJunction',
  'columnRuleInsetJunctionEnd',
  'columnRuleInsetJunctionStart',
  'columnRuleInsetStart',
  'rowRuleInset',
  'rowRuleInsetCap',
  'rowRuleInsetCapEnd',
  'rowRuleInsetCapStart',
  'rowRuleInsetEnd',
  'rowRuleInsetJunction',
  'rowRuleInsetJunctionEnd',
  'rowRuleInsetJunctionStart',
  'rowRuleInsetStart',
  'ruleInset',
  'ruleInsetCap',
  'ruleInsetEnd',
  'ruleInsetJunction',
  'ruleInsetStart',
];
const containIntrinsicProperties = [
  'containIntrinsicBlockSize',
  'containIntrinsicHeight',
  'containIntrinsicInlineSize',
  'containIntrinsicSize',
  'containIntrinsicWidth',
];
const cornerShapeProperties = [
  'cornerShape',
  'cornerTopShape',
  'cornerRightShape',
  'cornerBottomShape',
  'cornerLeftShape',
  'cornerBlockStartShape',
  'cornerBlockEndShape',
  'cornerInlineStartShape',
  'cornerInlineEndShape',
  'cornerTopLeftShape',
  'cornerTopRightShape',
  'cornerBottomLeftShape',
  'cornerBottomRightShape',
  'cornerStartStartShape',
  'cornerStartEndShape',
  'cornerEndStartShape',
  'cornerEndEndShape',
];
const numberValueProperties = [
  ...ruleInsetProperties,
  ...containIntrinsicProperties,
  'animation',
  'fitTolerance',
  'fontSmooth',
  'perspectiveOrigin',
  'rule',
  'rowRule',
  'scrollSnapCoordinate',
  'scrollSnapDestination',
  'textDecoration',
  'textDecorationInset',
  'viewTimelineInset',
];
const dashedIdentListProperties = [
  'anchorName',
  'anchorScope',
  'scrollTimelineName',
  'timelineScope',
  'timelineTriggerName',
  'triggerScope',
  'viewTimelineName',
];
const keywordListProperties = [
  'animationComposition',
  'scrollTimelineAxis',
  'viewTimelineAxis',
];

function getParenthesisDepth(value: string, end: number): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < end; index++) {
    const char = value[index];
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    }
  }
  return depth;
}

type NormalizedCssVariables = {
  isStandalone: boolean;
  value: string;
};

function findCssVariableStart(value: string, start: number): number {
  let quote = '';
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    const char = value[index];
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (
      value.startsWith('var(', index) &&
      (index === 0 || !/[a-zA-Z0-9_-]/.test(value[index - 1]))
    ) {
      return index;
    }
  }
  return -1;
}

function normalizeCssVariables(value: string): NormalizedCssVariables | null {
  if (value.includes(cssVariablePlaceholder)) return null;

  let normalized = '';
  let cursor = 0;
  let isStandalone = false;
  let canonicalIndex = 0;
  while (cursor < value.length) {
    const start = findCssVariableStart(value, cursor);
    if (start === -1) {
      return { isStandalone, value: normalized + value.slice(cursor) };
    }

    normalized += value.slice(cursor, start);
    let depth = 1;
    let quote = '';
    let escaped = false;
    let firstComma = -1;
    let end = start + 4;

    for (; end < value.length; end++) {
      const char = value[end];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
        if (depth === 0) break;
      } else if (char === ',' && depth === 1 && firstComma === -1) {
        firstComma = end;
      }
    }

    if (depth !== 0 || quote) return null;
    const nameEnd = firstComma === -1 ? end : firstComma;
    const name = value.slice(start + 4, nameEnd).trim();
    if (!new RegExp(`^${dashedIdentString}$`).test(name)) return null;

    if (firstComma !== -1) {
      const fallback = value.slice(firstComma + 1, end).trim();
      if (fallback && normalizeCssVariables(fallback) === null) return null;
    }

    isStandalone = start === 0 && end === value.length - 1;
    normalized +=
      getParenthesisDepth(value, start) === 0
        ? canonicalCssVariable(canonicalIndex++)
        : cssVariablePlaceholder;
    cursor = end + 1;
  }

  return { isStandalone, value: normalized };
}

const valueCountMap: { [key: string]: number } = {
  inset: 4,
  gap: 2,
  gridGap: 2,
  padding: 4,
  margin: 4,
  borderSpacing: 2,
  borderWidth: 4,
  borderStartStartRadius: 2,
  borderStartEndRadius: 2,
  borderEndStartRadius: 2,
  borderEndEndRadius: 2,
  borderTopLeftRadius: 2,
  borderTopRightRadius: 2,
  borderBottomRightRadius: 2,
  borderBottomLeftRadius: 2,
  borderImageWidth: 4,
  borderImageOutset: 4,
  borderBlockWidth: 2,
  borderInlineWidth: 2,
};

const singleColorProperties = [
  'accentColor',
  'color',
  'borderTopColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
  'borderBlockColor',
  'borderBlockStartColor',
  'borderBlockEndColor',
  'borderInlineColor',
  'borderInlineStartColor',
  'borderInlineEndColor',
  'backgroundColor',
  'outlineColor',
  'textDecorationColor',
  'caretColor',
  'columnRuleColor',
  'fill',
  'stopColor',
  'textEmphasisColor',
  'floodColor',
  'lightingColor',
  'strokeColor',
  'ruleColor',
  'rowRuleColor',
  'WebkitTextFillColor',
  'WebkitTextStrokeColor',
  'WebkitTapHighlightColor',
];
const borderColorProperties = ['borderColor'];
const borderWidthProperties = [
  'borderWidth',
  'borderBlockWidth',
  'borderInlineWidth',
  'columnRuleWidth',
  'outlineWidth',
  'ruleWidth',
  'rowRuleWidth',
  'WebkitTextStrokeWidth',
];
const ImageSourceProperties = [
  'borderImageSource',
  'listStyleImage',
  'maskBorderSource',
  'maskImage',
  'WebkitMaskImage',
];
const borderProperties = [
  'border',
  'outline',
  'columnRule',
  'rule',
  'rowRule',
  'borderTop',
  'borderBottom',
  'borderLeft',
  'borderRight',
  'borderBlock',
  'borderBlockStart',
  'borderBlockEnd',
  'borderInline',
  'borderInlineStart',
  'borderInlineEnd',
];
const borderRadiusProperties = ['borderRadius'];
const flexProperties = ['flex'];
const borderStyleProperties = ['borderStyle'];
const borderImageSlice = ['borderImageSlice'];

const stylisticString = 'stylistic\\([^\\)]+\\)';
const stylesetString = 'styleset\\([^\\)]+\\)';
const characterVariantString = 'character-variant\\([^\\)]+\\)';
const swashString = 'swash\\([^\\)]+\\)';
const ornamentsString = 'ornaments\\([^\\)]+\\)';
const annotationString = 'annotation\\([^\\)]+\\)';
const notationFuncs = [
  stylisticString,
  stylesetString,
  characterVariantString,
  swashString,
  ornamentsString,
  annotationString,
  varString,
].join('|');

const lineWidth = ['thin', 'medium', 'thick'].join('|');
const lineStyle = [
  'none',
  'hidden',
  'dotted',
  'dashed',
  'solid',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
  varString,
].join('|');

const cursorValue = [
  'auto',
  'default',
  'none',
  'context-menu',
  'help',
  'pointer',
  'progress',
  'wait',
  'cell',
  'crosshair',
  'text',
  'vertical-text',
  'alias',
  'copy',
  'move',
  'no-drop',
  'not-allowed',
  'grab',
  'grabbing',
  'e-resize',
  'n-resize',
  'ne-resize',
  'nw-resize',
  's-resize',
  'se-resize',
  'sw-resize',
  'w-resize',
  'ew-resize',
  'ns-resize',
  'nesw-resize',
  'nwse-resize',
  'col-resize',
  'row-resize',
  'all-scroll',
  'zoom-in',
  'zoom-out',
  varString,
].join('|');

// --- Pre-computed Set for numbers validation ---
const allowsNumberSet = new Set([
  ...lengthValueProperties,
  ...lengthPercentage,
  ...otherGroupProperties,
  ...integerGroupProperties,
  ...multipleValueProperties,
  ...flexProperties,
  ...borderRadiusProperties,
  ...animationIterationCountProperties,
  ...aspectRatioProperties,
  ...gridItemProperties,
  ...strokeMiterlimitProperties,
  ...strokeDasharrayProperties,
  ...borderImageSlice,
  ...maskBorderSliceProperties,
  ...maskBorderWidthProperties,
  ...maskBorderOutsetProperties,
  ...mathDepthProperties,
  ...initialLetterProperties,
  ...hyphenateLimitCharsProperties,
  ...shapeImageThresholdProperties,
  ...columnsProperties,
  ...numberValueProperties,
]);

// --- Static Functions ---
function isValidMultipleColorValues(value: string) {
  const colors = splitColorValues(value);
  if (colors.length > 4) return false;
  return colors.every((c) => colorRegex.test(c));
}
function splitColorValues(value: string) {
  const colors = [];
  const remaining = value.trim();
  let depth = 0;
  let currentColor = '';
  for (let i = 0; i < remaining.length; i++) {
    const char = remaining[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    if (char === ' ' && depth === 0 && currentColor.length > 0) {
      colors.push(currentColor.trim());
      currentColor = '';
    } else {
      currentColor += char;
    }
  }
  if (currentColor.length > 0) colors.push(currentColor.trim());
  return colors;
}
function isValidColorValue(value: string) {
  return colorRegex.test(value);
}

const textDecorationLines = ['underline', 'overline', 'line-through', 'blink'];
const textDecorationSingleLines = ['none', 'spelling-error', 'grammar-error'];
const textDecorationStyles = ['solid', 'double', 'dotted', 'dashed', 'wavy'];
const textDecorationThicknessRegex = new RegExp(
  `^(?:auto|from-font|${lengthPattern}|${percentagePattern}|${calcString})$`,
);

function isValidTextDecoration(value: string) {
  const seen = new Set<string>();
  let lineCount = 0;
  for (const part of splitColorValues(value)) {
    if (varRegex.test(part)) continue;
    const lower = part.toLowerCase();
    let group: string;
    if (textDecorationLines.includes(lower)) {
      group = lower;
      lineCount++;
    } else if (textDecorationSingleLines.includes(lower)) {
      group = 'line';
    } else if (textDecorationStyles.includes(lower)) {
      group = 'style';
    } else if (textDecorationThicknessRegex.test(lower)) {
      group = 'thickness';
    } else if (isValidColorValue(part)) {
      group = 'color';
    } else {
      return false;
    }
    if (seen.has(group)) return false;
    seen.add(group);
  }
  return !(seen.has('line') && lineCount > 0);
}

function isValidCursor(value: string) {
  const urlWithHotspotRegex = `(${urlString}|${varString})(\\s+(${numberPattern})(\\s+(${numberPattern}))?)?`;
  const urlPart = `(${urlWithHotspotRegex})`;
  if (new RegExp(`^(${cursorValue})$`).test(value)) return true;
  if (
    !new RegExp(
      `^${urlPart}(\\s*,\\s*${urlPart})*\\s*,\\s*(${cursorValue})$`,
    ).test(value)
  )
    return false;
  const parts = value.split(/\s*,\s*/);
  return parts
    .slice(0, -1)
    .every((part) => new RegExp(`^${urlWithHotspotRegex}$`).test(part));
}

function isValidFontSizeAdjust(value: string) {
  const cleanValue = value.replace(/\s+/g, ' ').trim();
  if (!cleanValue) return false;
  const parts = cleanValue.split(' ');
  if (parts.length > 2) return false;
  if (parts.length === 1)
    return new RegExp(`^(${numberPattern}|from-font)$`).test(parts[0]);
  const fontMetric = `ex-height|cap-height|ch-width|ic-width|ic-height|${varString}`;
  if (!new RegExp(`^(${fontMetric})$`).test(parts[0])) return false;
  return new RegExp(`^(${numberPattern}|from-font)$`).test(parts[1]);
}

function isValidTextDecorationLine(value: string) {
  const decorationValues = ['underline', 'overline', 'line-through', 'blink'];
  const usedValues = new Set();
  const trimmedValue = value.trim();
  if (value !== trimmedValue) return false;
  const tokens = trimmedValue.split(/\s+/);
  return tokens.every((token) => {
    if (varRegex.test(token)) return true;
    if (decorationValues.includes(token))
      return !usedValues.has(token) && usedValues.add(token);
    return false;
  });
}

function isValidContain(value: string) {
  const singleValues = ['none', 'strict', 'content'];
  const sizeValues = ['size', 'inline-size'];
  const featureValues = ['layout', 'style', 'paint'];
  const usedValues = new Set();
  const trimmedValue = value.trim();
  if (value !== trimmedValue) return false;
  const tokens = trimmedValue.split(/\s+/);
  return tokens.every((token) => {
    if (varRegex.test(token)) return true;
    if (singleValues.includes(token)) return tokens.length === 1;
    if (sizeValues.includes(token))
      return !usedValues.has('size') && usedValues.add('size');
    if (featureValues.includes(token))
      return !usedValues.has(token) && usedValues.add(token);
    return false;
  });
}

function isValidFontVariantEastAsian(value: string) {
  const fontVariantEastAsianRegex = new RegExp(
    '^' +
      `(?:jis78|jis83|jis90|jis04|simplified|traditional|full-width|proportional-width|ruby|${varString})` +
      `(?:\\s+(?:jis78|jis83|jis90|jis04|simplified|traditional|full-width|proportional-width|ruby|${varString})){0,2}` +
      '$',
    'i',
  );

  if (!fontVariantEastAsianRegex.test(value)) {
    return false;
  }

  const values = value.toLowerCase().split(/\s+/);
  const jisCount = values.filter((value) =>
    ['jis78', 'jis83', 'jis90', 'jis04', 'simplified', 'traditional'].includes(
      value,
    ),
  ).length;
  const widthCount = values.filter((v) =>
    ['full-width', 'proportional-width'].includes(v),
  ).length;
  const rubyCount = values.filter((v) => v === 'ruby').length;

  return jisCount <= 1 && widthCount <= 1 && rubyCount <= 1;
}

// --- Dynamic Pattern Generators ---
function getLengthValuePattern(key: string): string {
  const isBorderWidth = borderWidthProperties.includes(key);
  const multiAutoProperties = [
    'borderImageWidth',
    'margin',
    'inset',
    'backgroundSize',
    'marginBlock',
    'marginInline',
    'scrollPaddingBlock',
    'scrollPaddingInline',
  ];
  const isAuto = multiAutoProperties.includes(key);
  const numberAndLengthValues = [
    'borderImageWidth',
    'borderImageOutset',
    'lineHeight',
    'strokeDashoffset',
    'strokeWidth',
    'tabSize',
    'zoom',
  ];
  const isNumber = numberAndLengthValues.includes(key);
  const isBackgroundSize = key === 'backgroundSize';
  const isGap = key === 'gap' || key === 'gridGap';
  const isBackgroundPositionX = key === 'backgroundPositionX';
  const isBackgroundPositionY = key === 'backgroundPositionY';
  const isBackgroundPosition = key === 'backgroundPosition';
  const isFitContentGroup = [
    'width',
    'maxWidth',
    'minWidth',
    'height',
    'maxHeight',
    'minHeight',
    'flexBasis',
    'blockSize',
    'columnWidth',
    'inlineSize',
  ];
  const isFitContent = isFitContentGroup.includes(key);
  const isLengthPercentage = lengthPercentage.includes(key);
  const isAnchor = insetProperties.includes(key);
  const isAnchorSize = anchorSizeProperties.includes(key);

  return (
    `${lengthPattern}` +
    (isLengthPercentage ? `|${percentagePattern}` : '') +
    (isFitContent ? `|${fitContentString}` : '') +
    (isNumber ? `|${numberPattern}` : '') +
    (isAuto ? `|auto` : '') +
    (isBorderWidth ? '|thin|medium|thick' : '') +
    (isBackgroundPositionY ? '|top|center|bottom' : '') +
    (isBackgroundPositionX ? '|left|center|right' : '') +
    (isBackgroundPosition ? '|top|bottom|center|left|right' : '') +
    (isBackgroundSize ? '|cover|contain' : '') +
    (isGap ? '|normal' : '') +
    (isAnchor ? `|${anchorString}` : '') +
    (isAnchorSize ? `|${anchorSizeString}` : '') +
    `|${calcString}|${clampString}|${minString}|${maxString}|${steppedValueString}|${absString}|${varString}`
  );
}

// --- Validator Factory & Cache ---
type ValidatorFn = (value: string) => boolean;
const validatorCache = new Map<string, ValidatorFn | null>();
const foldedValueCache = new Map<string, Set<string>>();

function getFoldedValues(key: string): Set<string> {
  const cached = foldedValueCache.get(key);
  if (cached) return cached;

  const folded = new Set(validData[key].map((v) => v.toLowerCase()));
  foldedValueCache.set(key, folded);
  return folded;
}

type KeywordTokenRule = {
  max: number;
  repeat?: boolean;
  standalone?: string[];
  exclusive?: string[][];
  keywords?: string[];
  pattern?: string;
  check?: (tokens: string[]) => boolean;
};

const positionAreaAxes: [RegExp, string][] = [
  [/^(?:span-)?(?:self-)?block-(?:start|end)$/, 'block'],
  [/^(?:span-)?(?:self-)?inline-(?:start|end)$/, 'inline'],
  [/^(?:span-)?(?:x-(?:self-)?(?:start|end)|left|right)$/, 'x'],
  [/^(?:span-)?(?:y-(?:self-)?(?:start|end)|top|bottom)$/, 'y'],
  [/^(?:span-)?(?:self-)?(?:start|end)$/, 'generic'],
];

function isPositionArea(tokens: string[]): boolean {
  const axes = tokens.map(
    (token) => positionAreaAxes.find(([r]) => r.test(token))?.[1] ?? 'any',
  );
  if (axes.includes('any')) return true;
  const pair = axes.sort().join(' ');
  return (
    pair === 'x y' || pair === 'block inline' || pair === 'generic generic'
  );
}

const textEdgeOver = ['text', 'cap', 'ex', 'ideographic', 'ideographic-ink'];
const textEdgeUnder = ['text', 'alphabetic', 'ideographic', 'ideographic-ink'];
const textBoxTrims = ['none', 'trim-start', 'trim-end', 'trim-both'];

function isTextEdge(tokens: string[]): boolean {
  if (tokens.length === 1) {
    return ['auto', 'text', 'ideographic', 'ideographic-ink'].includes(
      tokens[0],
    );
  }
  return (
    tokens.length === 2 &&
    textEdgeOver.includes(tokens[0]) &&
    textEdgeUnder.includes(tokens[1])
  );
}

function isTextBox(tokens: string[]): boolean {
  const trims = tokens.filter((token) => textBoxTrims.includes(token));
  if (trims.length > 1) return false;
  if (trims.length === 0) return isTextEdge(tokens);
  const index = tokens.indexOf(trims[0]);
  if (index !== 0 && index !== tokens.length - 1) return false;
  return isTextEdge(tokens.filter((_, i) => i !== index));
}

const keywordTokenRules: { [key: string]: KeywordTokenRule } = {
  imageResolution: {
    max: 3,
    keywords: ['snap'],
    pattern: `${pureNumber}(?:dpi|dpcm|dppx|x)`,
    check: (tokens) => tokens.some((token) => token !== 'snap'),
  },
  masonryAutoFlow: {
    max: 2,
    exclusive: [
      ['pack', 'next'],
      ['definite-first', 'ordered'],
    ],
  },
  positionArea: {
    max: 2,
    repeat: true,
    standalone: ['none'],
    check: isPositionArea,
  },
  positionVisibility: { max: 3, standalone: ['always'] },
  speakAs: {
    max: 3,
    standalone: ['normal'],
    exclusive: [['literal-punctuation', 'no-punctuation']],
  },
  textAutospace: {
    max: 4,
    standalone: ['normal', 'no-autospace', 'auto'],
    exclusive: [['insert', 'replace']],
  },
  textBox: {
    max: 3,
    repeat: true,
    standalone: ['normal'],
    keywords: ['cap', 'ex', 'alphabetic'],
    check: isTextBox,
  },
  textBoxEdge: {
    max: 2,
    repeat: true,
    keywords: ['cap', 'ex', 'alphabetic'],
    check: isTextEdge,
  },
  textDecorationSkip: {
    max: 5,
    standalone: ['none'],
    exclusive: [
      ['spaces', 'leading-spaces'],
      ['spaces', 'trailing-spaces'],
    ],
  },
  textDecorationSkipSpaces: { max: 2, standalone: ['none', 'all'] },
  textFit: {
    max: 3,
    standalone: ['none'],
    keywords: ['consistent', 'per-line', 'per-line-all'],
    exclusive: [
      ['grow', 'shrink'],
      ['consistent', 'per-line', 'per-line-all'],
    ],
    pattern: percentagePattern,
  },
  whiteSpaceTrim: { max: 3, standalone: ['none'] },
};

function keywordTokens(key: string, rule: KeywordTokenRule): ValidatorFn {
  const keywords = new Set([...getFoldedValues(key), ...(rule.keywords ?? [])]);
  const pattern = rule.pattern ? new RegExp(`^(?:${rule.pattern})$`) : null;
  return (value) => {
    const tokens = value.trim().toLowerCase().split(/\s+/);
    if (tokens.length > rule.max) return false;
    if (!rule.repeat && new Set(tokens).size !== tokens.length) return false;
    let patternCount = 0;
    let hasVar = false;
    for (const token of tokens) {
      if (keywords.has(token)) continue;
      if (varRegex.test(token)) {
        hasVar = true;
      } else if (pattern?.test(token)) {
        patternCount++;
      } else {
        return false;
      }
    }
    if (hasVar) return true;
    if (patternCount > 1) return false;
    if (
      tokens.length > 1 &&
      tokens.some((token) => rule.standalone?.includes(token))
    ) {
      return false;
    }
    if (
      rule.exclusive?.some(
        (group) => tokens.filter((token) => group.includes(token)).length > 1,
      )
    ) {
      return false;
    }
    return rule.check ? rule.check(tokens) : true;
  };
}

const transformFunctionString = [
  `matrix\\(${mathContentsString}\\)`,
  `matrix3d\\(${mathContentsString}\\)`,
  `perspective\\(${mathContentsString}\\)`,
  `rotate\\(${mathContentsString}\\)`,
  `rotate3d\\(${mathContentsString}\\)`,
  `rotateX\\(${mathContentsString}\\)`,
  `rotateY\\(${mathContentsString}\\)`,
  `rotateZ\\(${mathContentsString}\\)`,
  `scale\\(${mathContentsString}\\)`,
  `scale3d\\(${mathContentsString}\\)`,
  `scaleX\\(${mathContentsString}\\)`,
  `scaleY\\(${mathContentsString}\\)`,
  `scaleZ\\(${mathContentsString}\\)`,
  `skew\\(${mathContentsString}\\)`,
  `skewX\\(${mathContentsString}\\)`,
  `skewY\\(${mathContentsString}\\)`,
  `translate\\(${mathContentsString}\\)`,
  `translate3d\\(${mathContentsString}\\)`,
  `translateX\\(${mathContentsString}\\)`,
  `translateY\\(${mathContentsString}\\)`,
  `translateZ\\(${mathContentsString}\\)`,
].join('|');

function getValidator(key: string): ValidatorFn | null {
  if (validatorCache.has(key)) return validatorCache.get(key)!;

  let validator: ValidatorFn | null = null;
  const lvp = getLengthValuePattern(key);

  // Helper functions for static string blocks
  const getTransformFunctions = () => transformFunctionString;

  const getGeometryBaseSet = () =>
    'content-box|padding-box|border-box|fill-box|stroke-box|view-box';

  if (['translate'].includes(key)) {
    const r = new RegExp(
      `^(${lvp}|${percentagePattern})(\\s(${lvp}|${percentagePattern}))?(\\s(${lvp}))?$`,
    );
    validator = (v) => r.test(v);
  } else if (['transform'].includes(key)) {
    const tFuncs = getTransformFunctions();
    const r = new RegExp(`^((${tFuncs})(\\s+(${tFuncs}))*)?$`);
    validator = (v) => r.test(v);
  } else if (['transformOrigin'].includes(key)) {
    const tVal = `(${lvp}|left|center|right|top|bottom)`;
    const r = new RegExp(`^(${tVal})(\\s(${tVal}))?(\\s(${tVal}))?$`);
    validator = (v) => r.test(v);
  } else if (['textEmphasis'].includes(key)) {
    const fill = `filled|open|${varString}`;
    const shape = `dot|circle|double-circle|triangle|sesame|${varString}`;
    const style = `(?:${fill})(?:\\s+(?:${shape}))?|(?:${shape})(?:\\s+(?:${fill}))?|${stringString}`;
    const r = new RegExp(
      `^(?:(?:${style})(?:\\s+(?:${colorSource}))?|(?:${colorSource})(?:\\s+(?:${style}))?)?$`,
    );
    validator = (v) => r.test(v);
  } else if (['textEmphasisStyle'].includes(key)) {
    const r = new RegExp(
      `^(((?:filled|open|${varString})(?:\\s+(?:dot|circle|double-circle|triangle|sesame|${varString})))?|${stringString}?)$`,
    );
    validator = (v) => r.test(v);
  } else if (['textEmphasisPosition'].includes(key)) {
    const overUnder = `over|under|${varString}`,
      leftRight = `left|right|${varString}`;
    const r = new RegExp(
      `^(((?:${overUnder})(?:\\s+(?:${leftRight}))|(?:${leftRight})(?:\\s+(?:${overUnder})))?)$`,
    );
    validator = (v) => r.test(v);
  } else if (['scrollSnapType'].includes(key)) {
    const r = new RegExp(
      `^((?:x|y|block|inline|both|${varString})(?:\\s+(?:mandatory|proximity|${varString}))?)$`,
    );
    validator = (v) => r.test(v);
  } else if (['scrollSnapAlign'].includes(key)) {
    const r = new RegExp(
      `^((?:start|end|center|${varString})(?:\\s+(?:start|end|center|${varString}))?)$`,
    );
    validator = (v) => r.test(v);
  } else if (['maskBorderRepeat', 'borderImageRepeat'].includes(key)) {
    const r = new RegExp(
      `^((?:stretch|repeat|round|space|${varString})(?:\\s+(?:stretch|repeat|round|space|${varString}))?)$`,
    );
    validator = (v) => r.test(v);
  } else if (['justifyItems'].includes(key)) {
    const kw = `left|right|anchor-center|stretch|self-start|self-end|start|end|center|flex-start|flex-end|${varString}`;
    const r = new RegExp(
      `^(((safe|unsafe|${varString})\\s+(${kw}))|(first|last|${varString})\\s+(baseline|${varString})|((legacy|${varString})\\s+(left|right|center|${varString})))$`,
    );
    validator = (v) => r.test(v);
  } else if (['justifySelf'].includes(key)) {
    const kw = `left|right|anchor-center|stretch|self-start|self-end|start|end|center|flex-start|flex-end|${varString}`;
    const r = new RegExp(
      `^(((safe|unsafe|${varString})\\s+(${kw}))|(first|last|${varString})\\s+(baseline|${varString}))$`,
    );
    validator = (v) => r.test(v);
  } else if (['justifyContent'].includes(key)) {
    const kw = `left|right|stretch|start|end|center|flex-start|flex-end|${varString}`;
    const r = new RegExp(
      `^(((safe|unsafe|${varString})\\s+(${kw}))|(first|last|${varString})\\s+(baseline|${varString}))$`,
    );
    validator = (v) => r.test(v);
  } else if (['hangingPunctuation'].includes(key)) {
    const first = `(first|${varString})`,
      last = `(last|${varString})`,
      forceAllow = `(force-end|allow-end|${varString})`;
    const r = new RegExp(
      `^(?:${first}(?:\\s+${forceAllow})?)?(?:${last}(?:\\s+${forceAllow})?)?(?:${first}\\s+${forceAllow}\\s+${last})?(?:${first}\\s+${last})?$`,
    );
    validator = (v) => r.test(v);
  } else if (['flexFlow'].includes(key)) {
    const r = new RegExp(
      `^((row|row-reverse|column|column-reverse|${varString})(\\s+(nowrap|wrap|wrap-reverse|${varString})))$`,
    );
    validator = (v) => r.test(v);
  } else if (['backgroundRepeat'].includes(key)) {
    const kw = 'repeat|space|round|no-repeat';
    const r = new RegExp(
      `^(((?:${kw}|${varString})(\\s+(?:${kw}|${varString})))?|(repeatX|repeatY))$`,
    );
    validator = (v) => r.test(v);
  } else if (['placeSelf'].includes(key)) {
    validator = isValidPlaceSelf;
  } else if (['placeItems'].includes(key)) {
    validator = isValidPlaceItems;
  } else if (['placeContent'].includes(key)) {
    validator = isValidPlaceContent;
  } else if (['display'].includes(key)) {
    const outside = ['block', 'inline', 'run-in'];
    const inside = [
      'flow',
      'flow-root',
      'table',
      'flex',
      'grid',
      'ruby',
      'math',
    ];
    validator = (v) => {
      const tokens = v.trim().split(/\s+/);
      const isListItem = tokens.includes('list-item');
      if (tokens.length > (isListItem ? 3 : 2)) return false;
      const counts = { outside: 0, inside: 0, listItem: 0 };
      for (const token of tokens) {
        if (varRegex.test(token)) continue;
        if (token === 'list-item') {
          counts.listItem++;
        } else if (outside.includes(token)) {
          counts.outside++;
        } else if (
          inside.includes(token) &&
          (!isListItem || token === 'flow' || token === 'flow-root')
        ) {
          counts.inside++;
        } else {
          return false;
        }
      }
      return counts.outside <= 1 && counts.inside <= 1 && counts.listItem <= 1;
    };
  } else if (['alignItems', 'alignSelf'].includes(key)) {
    const kw = `self-start|self-end|anchor-center|start|end|center|flex-start|flex-end|${varString}`;
    const r = new RegExp(
      `^(((safe|unsafe|${varString})\\s+(${kw}))|(first|last|${varString})\\s+(baseline|${varString}))$`,
    );
    validator = (v) => r.test(v);
  } else if (['alignContent'].includes(key)) {
    const kw = `start|end|center|flex-start|flex-end|${varString}`;
    const r = new RegExp(
      `^(((safe|unsafe|${varString})\\s+(${kw}))|(first|last|${varString})\\s+(baseline|${varString}))$`,
    );
    validator = (v) => r.test(v);
  } else if (['touchAction'].includes(key)) {
    validator = isValidTouchAction;
  } else if (['textShadow'].includes(key)) {
    const r = new RegExp(
      `^(?:(?:(${colorSource})\\s+)?(${lvp})\\s+(${lvp})(?:\\s+(${lvp}))?(?:\\s+(${colorSource}))?(?:\\s*,\\s*(?:(${colorSource})\\s+)?(${lvp})\\s+(${lvp})(?:\\s+(${lvp}))?(?:\\s+(${colorSource}))?)*|none)$`,
    );
    validator = (v) => r.test(v);
  } else if (['textIndent'].includes(key)) {
    const r = new RegExp(
      `^(${lvp})(\\s(hanging|${varString})?)?(\\s(each-line|${varString})?)?$`,
    );
    validator = (v) => r.test(v);
  } else if (['textDecorationLine'].includes(key)) {
    validator = isValidTextDecorationLine;
  } else if (['strokeMiterlimit'].includes(key)) {
    const r = new RegExp(`^(${numberPattern})$`);
    validator = (v) => r.test(v);
  } else if (['strokeDasharray'].includes(key)) {
    const r = new RegExp(
      `^(${numberPattern}|${lvp})(,\\s(${numberPattern}|${lvp}))*$`,
    );
    validator = (v) => r.test(v);
  } else if (['stroke'].includes(key)) {
    const r = new RegExp(`^${gradientString}|${urlString}|${colorSource}$`);
    validator = (v) => r.test(v);
  } else if (['shapeOutside'].includes(key)) {
    const basic = `(var\\(${dashedIdentString}(,\\s*[^\\)]+)?\\)|inset\\([^\\)]+\\)|circle\\([^\\)]+\\)|ellipse\\([^\\)]+\\)|polygon\\([^\\)]+\\)|path\\(${stringString}\\)|rect\\([^\\)]+\\)|xywh\\([^\\)]+\\))`;
    const box = `margin-box|border-box|padding-box|content-box|${varString}`;
    const r = new RegExp(
      `^(?:(?:${basic}(?:\\s+${box})?)|(?:${box}(?:\\s+${basic})?)|${gradientString}|${urlString}|${varString})$`,
    );
    validator = (v) => r.test(v);
  } else if (['shapeImageThreshold'].includes(key)) {
    const r = new RegExp(`^(${numberPattern}|${percentagePattern})$`);
    validator = (v) => r.test(v);
  } else if (['scrollbarColor'].includes(key)) {
    const r = new RegExp(`^(${colorSource}(\\s${colorSource})?)$`);
    validator = (v) => r.test(v);
  } else if (['scrollPadding'].includes(key)) {
    const r = new RegExp(`^(${lvp}|auto)( (?!\\s)(${lvp}|auto)){0,3}$`);
    validator = (v) => r.test(v);
  } else if (['scrollMargin'].includes(key)) {
    const r = new RegExp(`^(${lvp})( (?!\\s)(${lvp})){0,3}$`);
    validator = (v) => r.test(v);
  } else if (['scale'].includes(key)) {
    const r = new RegExp(
      `^(${numberPattern}|${percentagePattern})( (?!\\s)(${numberPattern}|${percentagePattern})){0,2}$`,
    );
    validator = (v) => r.test(v);
  } else if (['rotate'].includes(key)) {
    const r = new RegExp(
      `^((?:(x|y|z|${varString})\\s+${anglePattern})?|(?:${numberPattern}\\s+${numberPattern}\\s+${numberPattern}\\s+${anglePattern})?|(?:${anglePattern})?)$`,
    );
    validator = (v) => r.test(v);
  } else if (['quotes'].includes(key)) {
    const r = new RegExp(
      `^(${stringString}|${varString})(\\s(${stringString}|${varString}))*$`,
    );
    validator = (v) => r.test(v);
  } else if (['paintOrder'].includes(key)) {
    const r = new RegExp(
      `^((?:(fill|${varString})(\\s+(stroke|${varString}))?(\\s+(markers|${varString}))?)?|(?:(fill|${varString})(\\s+(markers|${varString}))?(\\s+(stroke|${varString}))?)?|(?:(stroke|${varString})(\\s+(fill|${varString}))?(\\s+(markers|${varString}))?)?|(?:(stroke|${varString})(\\s+(markers|${varString}))?(\\s+(fill|${varString}))?)?|(?:(markers|${varString})(\\s+(fill|${varString}))?(\\s+(stroke|${varString}))?)?|(?:(markers|${varString})(\\s+(stroke|${varString}))?(\\s+(fill|${varString}))?)?)$`,
    );
    validator = (v) => r.test(v);
  } else if (['overscrollBehavior'].includes(key)) {
    const r = new RegExp(
      `^(auto|contain|${varString})( (?!\\s)(auto|contain|${varString})){0,1}$`,
    );
    validator = (v) => r.test(v);
  } else if (['overflowClipMargin'].includes(key)) {
    const box = `border-box|padding-box|content-box|${varString}`;
    const r = new RegExp(
      `^(?:${lvp}$|${box}$|${lvp}\\s+${box}$|${box}\\s+${lvp}$)`,
    );
    validator = (v) => r.test(v);
  } else if (['overflow'].includes(key)) {
    const kw = `visible|hidden|clip|scroll|auto|${varString}`;
    const r = new RegExp(`^(${kw})(\\s+(${kw}))?$`);
    validator = (v) => r.test(v);
  } else if (['offset'].includes(key)) {
    const posPattern = `(${lvp}|${percentagePattern}|top|bottom|center|left|right)( (?!\\s)(${lvp}|${percentagePattern}|top|bottom|center|left|right)){0,3}`;
    const pathSource = `(ray\\([^\\)]+\\)|${urlString}|(var\\(${dashedIdentString}(,\\s*[^\\)]+)?\\)|inset\\([^\\)]+\\)|circle\\([^\\)]+\\)|ellipse\\([^\\)]+\\)|polygon\\([^\\)]+\\)|path\\(${stringString}\\)|rect\\([^\\)]+\\)|xywh\\([^\\)]+\\))|content-box|padding-box|border-box|fill-box|stroke-box|view-box)`;
    const rotateSource = `(${anglePattern}|auto|reverse)( (?!\\s)(${anglePattern})){0,1}`;
    const r = new RegExp(
      `^(?!\\s)(?=\\S)(${posPattern})?\\s*(${pathSource}(\\s(${lvp}(\\s+${rotateSource})?|${rotateSource}))?)?\\s*(\\/\\s*${posPattern})?(?<!\\s)$`,
    );
    validator = (v) => r.test(v);
  } else if (['offsetPath'].includes(key)) {
    const basic = `(var\\(${dashedIdentString}(,\\s*[^\\)]+)?\\)|inset\\([^\\)]+\\)|circle\\([^\\)]+\\)|ellipse\\([^\\)]+\\)|polygon\\([^\\)]+\\)|path\\(${stringString}\\)|rect\\([^\\)]+\\)|xywh\\([^\\)]+\\))`;
    const r = new RegExp(
      `^(ray\\([^\\)]+\\)|${urlString}|${basic}|${getGeometryBaseSet()})$`,
    );
    validator = (v) => r.test(v);
  } else if (['offsetRotate'].includes(key)) {
    const r = new RegExp(
      `^(${anglePattern}|auto|reverse)( (?!\\s)(${anglePattern})){0,1}$`,
    );
    validator = (v) => r.test(v);
  } else if (
    [
      'objectPosition',
      'offsetAnchor',
      'offsetPosition',
      'perspectiveOrigin',
      'scrollSnapDestination',
    ].includes(key)
  ) {
    const r = new RegExp(
      `^(${lvp}|${percentagePattern}|top|bottom|center|left|right)( (?!\\s)(${lvp}|${percentagePattern}|top|bottom|center|left|right)){0,3}$`,
    );
    validator = (v) => r.test(v);
  } else if (['mathDepth'].includes(key)) {
    const r = new RegExp(`^(${addString}|${integerPattern})$`);
    validator = (v) => r.test(v);
  } else if (['mask'].includes(key)) {
    const pos = `top|bottom|center|left|right|${varString}|${lvp}`;
    const bgSize = `${lvp}|cover|contain|auto`;
    const mLayer = `(?:${gradientString}|${urlString})(?:\\s+(${pos})( (?!\\s)(${pos})){0,1}?)?(?:\\s?/\\s?(${bgSize})( (?!\\s)(${bgSize})){0,1}?)?(?:\\s+(?:repeat|space|round|no-repeat|${varString})(?:\\s+(?:repeat|space|round|no-repeat|${varString}))?)?(?:\\s+${getGeometryBaseSet()}|content|padding|border|${varString})?(?:\\s+${getGeometryBaseSet()}|no-clip|border|padding|content|text|${varString})?(?:\\s+add|subtract|intersect|exclude|${varString})?(?:\\s+alpha|luminance|match-source|${varString})?`;
    const r = new RegExp(`^${mLayer}(?:,(?:\\s+${mLayer}))*$`);
    validator = (v) => r.test(v);
  } else if (['maskBorder'].includes(key)) {
    const mSlice = `(?:${percentagePattern}|${numberPattern}|fill)( (?!\\s)(${percentagePattern}|${numberPattern}|fill)){0,3}`;
    const mWidth = `(?:${lvp}|${numberPattern}|auto)( (?!\\s)(${lvp}|${numberPattern}|auto)){0,3}`;
    const mOutset = `(?:${lvp}|${numberPattern})( (?!\\s)(${lvp}|${numberPattern})){0,3}`;
    const mRepeat = `(?:stretch|repeat|round|space|${varString})(?:\\s+(?:stretch|repeat|round|space|${varString}))?`;
    const r = new RegExp(
      `^(?:${gradientString}|${urlString})(?:\\s+${mSlice})?(?:\\s?/\\s?${mWidth})?(?:\\s?/\\s?${mOutset})?(?:\\s+(?:repeat|space|round|no-repeat|${mRepeat}))?(?:\\s+(?:luminance|alpha|${varString}))?$`,
    );
    validator = (v) => r.test(v);
  } else if (['maskSize'].includes(key)) {
    const r = new RegExp(
      `^(${lvp}|cover|contain|auto)(\\s+(${lvp}|cover|contain|auto))?(,\\s*(${lvp}|cover|contain|auto)(\\s+(${lvp}|cover|contain|auto))?)*$`,
    );
    validator = (v) => r.test(v);
  } else if (['maskRepeat'].includes(key)) {
    const rep = `(?:repeat|space|round|no-repeat|${varString})(?:\\s+(?:repeat|space|round|no-repeat|${varString}))?`;
    const r = new RegExp(`^(${rep})(,\\s*(${rep}))*$`);
    validator = (v) => r.test(v);
  } else if (['maskPosition'].includes(key)) {
    const pos = `top|bottom|center|left|right|${varString}`;
    const r = new RegExp(
      `^(?:(${lvp}|${pos})( (?!\\s)(${lvp}|${pos})){0,3})(?:,\\s*(${lvp}|${pos})( (?!\\s)(${lvp}|${pos})){0,3})*$`,
    );
    validator = (v) => r.test(v);
  } else if (['maskOrigin'].includes(key)) {
    const kw = `${getGeometryBaseSet()}|content|padding|border|${varString}`;
    const r = new RegExp(`^(${kw})(,\\s*(${kw}))*$`);
    validator = (v) => r.test(v);
  } else if (['maskMode'].includes(key)) {
    const kw = `alpha|luminance|match-source|${varString}`;
    const r = new RegExp(`^(${kw})(,\\s*(${kw}))*$`);
    validator = (v) => r.test(v);
  } else if (['maskComposite'].includes(key)) {
    const kw = `add|subtract|intersect|exclude|${varString}`;
    const r = new RegExp(`^(${kw})(,\\s*(${kw}))*$`);
    validator = (v) => r.test(v);
  } else if (['maskClip'].includes(key)) {
    const kw = `${getGeometryBaseSet()}|no-clip|border|padding|content|text|${varString}`;
    const r = new RegExp(`^(${kw})(,\\s*(${kw}))*$`);
    validator = (v) => r.test(v);
  } else if (['maskBorderWidth'].includes(key)) {
    const r = new RegExp(
      `^(${lvp}|${numberPattern}|auto)( (?!\\s)(${lvp}|${numberPattern}|auto)){0,3}$`,
    );
    validator = (v) => r.test(v);
  } else if (['maskBorderSlice'].includes(key)) {
    const r = new RegExp(
      `^(${percentagePattern}|${numberPattern}|fill)( (?!\\s)(${percentagePattern}|${numberPattern}|fill)){0,3}$`,
    );
    validator = (v) => r.test(v);
  } else if (['maskBorderOutset'].includes(key)) {
    const r = new RegExp(
      `^(${lvp}|${numberPattern})( (?!\\s)(${lvp}|${numberPattern})){0,3}$`,
    );
    validator = (v) => r.test(v);
  } else if (
    ['marker', 'markerEnd', 'markerMid', 'markerStart'].includes(key)
  ) {
    validator = (v) => urlRegex.test(v);
  } else if (
    [
      'marginBlock',
      'marginInline',
      'scrollPaddingBlock',
      'scrollPaddingInline',
      'paddingBlock',
      'paddingInline',
      'scrollMarginBlock',
      'scrollMarginInline',
    ].includes(key)
  ) {
    const r = new RegExp(`^(${lvp})(\\s+(${lvp}))?$`);
    validator = (v) => r.test(v);
  } else if (['insetBlock', 'insetInline'].includes(key)) {
    const r = new RegExp(`^(${lvp}|auto)(\\s+(${lvp}))?$`);
    validator = (v) => r.test(v);
  } else if (['initialLetter'].includes(key)) {
    const r = new RegExp(
      `^(${numberPattern})( (?!\\s)(${integerPattern}|drop|raise)){0,1}$`,
    );
    validator = (v) => r.test(v);
  } else if (['imageOrientation'].includes(key)) {
    const r = new RegExp(
      `^(${anglePattern})( (?!\\s)(flip|${varString})){0,1}$`,
    );
    validator = (v) => r.test(v);
  } else if (['hyphenateLimitChars'].includes(key)) {
    const r = new RegExp(
      `^(${numberPattern}|auto)( (?!\\s)(${numberPattern}|auto)){0,2}$`,
    );
    validator = (v) => r.test(v);
  } else if (['grid'].includes(key)) {
    const inArrayPattern = '[a-zA-Z][a-zA-Z0-9-_]*';
    const lineNamesPattern = `(\\[\\s*${inArrayPattern}(?:\\s+${inArrayPattern})*\\s*\\]|${varString})`;
    const tkw =
      'auto|min-content|max-content|subgrid|masonry|row|column|row dense|column dense';
    const gridTrackListPattern = `${tkw}|${lvp}|${numberPattern}fr|${percentagePattern}|${minmaxString}|${fitContentString}|${repeatString}|${varString}`;
    const autoFlowPattern = `(?:auto-flow(?:\\s+dense)?|${varString})?`;
    const gridAreaRowPattern = `(?:${lineNamesPattern}\\s+)?(?:${stringString}|${varString})?(?:\\s+(?:${gridTrackListPattern}))?(?:\\s+${lineNamesPattern})?`;
    const explicitTrackPattern = `(?:${lineNamesPattern}(?:\\s+|\\s*))?(?:${gridTrackListPattern})(?:\\s+${lineNamesPattern})?`;
    const r = new RegExp(
      '^(?:(?:' +
        gridAreaRowPattern +
        '|' +
        autoFlowPattern +
        '\\s*)+?(?:\\s*\\/\\s*(?:' +
        explicitTrackPattern +
        '|' +
        autoFlowPattern +
        '(?:\\s+' +
        explicitTrackPattern +
        '|' +
        autoFlowPattern +
        ')*)+)?|(?:' +
        explicitTrackPattern +
        '|' +
        autoFlowPattern +
        '(?:\\s+' +
        explicitTrackPattern +
        '|' +
        autoFlowPattern +
        ')*)+(?:\\s*\\/\\s*(?:' +
        explicitTrackPattern +
        '|' +
        autoFlowPattern +
        '(?:\\s+' +
        explicitTrackPattern +
        '|' +
        autoFlowPattern +
        ')*)+)?|\\s*\\/\\s*(?:' +
        explicitTrackPattern +
        '|' +
        autoFlowPattern +
        '(?:\\s+' +
        explicitTrackPattern +
        '|' +
        autoFlowPattern +
        ')*)+)$',
    );
    validator = (v) => r.test(v);
  } else if (['gridTemplate'].includes(key)) {
    const inArrayPattern = '[a-zA-Z][a-zA-Z0-9-_]*';
    const lineNamesPattern = `(\\[\\s*${inArrayPattern}(?:\\s+${inArrayPattern})*\\s*\\]|${varString})`;
    const tkw =
      'auto|min-content|max-content|subgrid|masonry|row|column|row dense|column dense';
    const templateTrackListPattern = [
      tkw,
      lineNamesPattern,
      lvp,
      `${numberPattern}fr`,
      percentagePattern,
      minmaxString,
      repeatString,
      varString,
      fitContentString,
    ].join('|');
    const gridAreaRowPattern = `(?:${lineNamesPattern}\\s+)?(?:${stringString}|${varString})(?:\\s+(?:${templateTrackListPattern}))?(?:\\s+${lineNamesPattern})?`;
    const explicitTrackPattern = `(?:${lineNamesPattern}(?:\\s+|\\s*))?(?:${templateTrackListPattern}|${repeatString})(?:\\s+${lineNamesPattern})?`;
    const r = new RegExp(
      '^(?:(?:' +
        gridAreaRowPattern +
        '\\s*)+?(?:\\s*\\/\\s*(?:' +
        explicitTrackPattern +
        '(?:\\s+' +
        explicitTrackPattern +
        ')*)+)?|(?:' +
        explicitTrackPattern +
        '(?:\\s+' +
        explicitTrackPattern +
        ')*)+(?:\\s*\\/\\s*(?:' +
        explicitTrackPattern +
        '(?:\\s+' +
        explicitTrackPattern +
        ')*)+)?|\\s*\\/\\s*(?:' +
        explicitTrackPattern +
        '(?:\\s+' +
        explicitTrackPattern +
        ')*)+)$',
    );
    validator = (v) => r.test(v);
  } else if (['gridTemplateColumns', 'gridTemplateRows'].includes(key)) {
    const inArrayPattern = '[a-zA-Z][a-zA-Z0-9-_]*';
    const lineNamesPattern = `(\\[\\s*${inArrayPattern}(?:\\s+${inArrayPattern})*\\s*\\]|${varString})`;
    const tkw =
      'auto|min-content|max-content|subgrid|masonry|row|column|row dense|column dense';
    const templateTrackListPattern = [
      tkw,
      lineNamesPattern,
      lvp,
      `${numberPattern}fr`,
      percentagePattern,
      minmaxString,
      repeatString,
      varString,
      ...('gridTemplateColumns' === key ? [fitContentString] : []),
    ].join('|');
    const r = new RegExp(
      `^(?:${templateTrackListPattern})(?:\\s+(?:${templateTrackListPattern}))*$`,
    );
    validator = (v) => r.test(v);
  } else if (['gridTemplateAreas'].includes(key)) {
    const r = new RegExp(`${stringString}`);
    validator = (v) => r.test(v);
  } else if (['gridAutoColumns', 'gridAutoRows'].includes(key)) {
    const tkw =
      'auto|min-content|max-content|subgrid|masonry|row|column|row dense|column dense';
    const gridTrackListPattern = `${tkw}|${lvp}|${numberPattern}fr|${percentagePattern}|${minmaxString}|${fitContentString}|${repeatString}|${varString}`;
    const r = new RegExp(
      `^(?:${gridTrackListPattern})(?:\\s+(?:${gridTrackListPattern}))*$`,
    );
    validator = (v) => r.test(v);
  } else if (
    [
      'animationName',
      'animationTimeline',
      'counterIncrement',
      'counterReset',
      'counterSet',
      'font',
      'fontFamily',
      'gridArea',
      'gridColumn',
      'gridColumnEnd',
      'gridColumnStart',
      'gridRow',
      'gridRowEnd',
      'gridRowStart',
      'listStyleType',
      'listStyle',
      'transitionProperty',
      'transition',
      'viewTransitionName',
      'willChange',
      'animation',
      'animationTrigger',
      'borderShape',
      'caret',
      'container',
      'linkParameters',
      'positionTry',
      'positionTryFallbacks',
      'scrollSnapPointsX',
      'scrollSnapPointsY',
      'scrollTimeline',
      'timelineTrigger',
      'viewTimeline',
    ].includes(key)
  ) {
    validator = (v) => /^.+$/.test(v);
  } else if (['fontFeatureSettings'].includes(key)) {
    const tagA_E = [
      'aalt',
      'abvf',
      'abvm',
      'abvs',
      'afrc',
      'akhn',
      'apkn',
      'blwf',
      'blwm',
      'blws',
      'calt',
      'case',
      'ccmp',
      'cfar',
      'chws',
      'cjct',
      'clig',
      'cpct',
      'cpsp',
      'cswh',
      'curs',
      'cv(0[1-9]|[1-9][0-9])',
      'c2pc',
      'c2sc',
      'dist',
      'dlig',
      'dnom',
      'dtls',
      'expt',
    ]
      .map((t) => `'${t}'|"${t}"`)
      .join('|');
    const tagF_J = [
      'falt',
      'fin2',
      'fin3',
      'fina',
      'flac',
      'frac',
      'fwid',
      'half',
      'haln',
      'hist',
      'hkna',
      'hlig',
      'hojo',
      'hwid',
      'init',
      'isol',
      'ital',
      'jalt',
      'jp78',
      'jp83',
      'jp90',
      'jp04',
    ]
      .map((t) => `'${t}'|"${t}"`)
      .join('|');
    const tagsK_O = [
      'kern',
      'lfbd',
      'liga',
      'ljmo',
      'lnum',
      'locl',
      'ltra',
      'ltrm',
      'mark',
      'med2',
      'medi',
      'mgrk',
      'mkmk',
      'mset',
      'nalt',
      'nlck',
      'nukt',
      'numr',
      'onum',
      'ordn',
      'ornm',
    ]
      .map((t) => `'${t}'|"${t}"`)
      .join('|');
    const tagsP_T = [
      'palt',
      'pcap',
      'pkna',
      'pnum',
      'pref',
      'pres',
      'pstf',
      'psts',
      'pwid',
      'qwid',
      'rand',
      'rclt',
      'rkrf',
      'rlig',
      'rphf',
      'rtbd',
      'rtla',
      'rtlm',
      'ruby',
      'rvrn',
      'salt',
      'sinf',
      'size',
      'smcp',
      'smpl',
      'ss(0[1-9]|1[0-9]|20)',
      'ssty',
      'stch',
      'subs',
      'sups',
      'swsh',
      'titl',
      'tjmo',
      'tnam',
      'tnum',
      'trad',
      'twid',
    ]
      .map((t) => `'${t}'|"${t}"`)
      .join('|');
    const tagsU_Z = [
      'unic',
      'valt',
      'vapk',
      'vatu',
      'vchw',
      'vert',
      'vhal',
      'vjmo',
      'vkna',
      'vkrn',
      'vpal',
      'vrt2',
      'vrtr',
      'zero',
    ]
      .map((t) => `'${t}'|"${t}"`)
      .join('|');
    const featureTag = [tagA_E, tagF_J, tagsK_O, tagsP_T, tagsU_Z].join('|');
    const singlePair = `(${featureTag}|${varString})(\\s+(-?\\d+|on|off|${varString}))?`;
    const r = new RegExp(`^${singlePair}(\\s*,\\s*${singlePair})*$`);
    validator = (v) => r.test(v);
  } else if (['fontVariant'].includes(key)) {
    const commonLig = 'common-ligatures|no-common-ligatures' + `|${varString}`;
    const discretionaryLig =
      'discretionary-ligatures|no-discretionary-ligatures' + `|${varString}`;
    const historicalLig =
      'historical-ligatures|no-historical-ligatures' + `|${varString}`;
    const contextualAlt = 'contextual|no-contextual' + `|${varString}`;
    const alternatesValues = `(?:${notationFuncs}|historical-forms)`;
    const numericFigureValues = 'lining-nums|oldstyle-nums';
    const numericSpacingValues = 'proportional-nums|tabular-nums';
    const numericFractionValues = 'diagonal-fractions|stacked-fractions';
    const numericOtherValues = 'normal|ordinal|slashed-zero';
    const eastAsianVariantValues =
      'jis78|jis83|jis90|jis04|simplified|traditional';
    const eastAsianWidthValues = 'full-width|proportional-width';
    const eastAsianRuby = 'ruby';
    const capsValues =
      'small-caps|all-small-caps|petite-caps|all-petite-caps|unicase|titling-caps';
    const emojiValues = 'text|emoji|unicode';
    const positionValues = 'sub|super';

    const r = new RegExp(
      `^(?:normal|none|(?:(?:(?:${commonLig}|${discretionaryLig}|${historicalLig}|${contextualAlt})(?:\\s+(?:${commonLig}|${discretionaryLig}|${historicalLig}|${contextualAlt})){0,3})|(?:${capsValues})|(?:${alternatesValues}(?:\\s+${alternatesValues})*)|(?:(?:${numericFigureValues}|${numericSpacingValues}|${numericFractionValues}|${numericOtherValues})(?:\\s+(?:${numericFigureValues}|${numericSpacingValues}|${numericFractionValues}|${numericOtherValues})){0,3})|(?:(?:${eastAsianVariantValues}|${eastAsianWidthValues}|${eastAsianRuby})(?:\\s+(?:${eastAsianVariantValues}|${eastAsianWidthValues}|${eastAsianRuby})){0,2})|(?:${positionValues})|(?:${emojiValues}))(?:\\s+(?:(?:(?:${commonLig}|${discretionaryLig}|${historicalLig}|${contextualAlt})(?:\\s+(?:${commonLig}|${discretionaryLig}|${historicalLig}|${contextualAlt})){0,3})|(?:${capsValues})|(?:${alternatesValues}(?:\\s+${alternatesValues})*)|(?:(?:${numericFigureValues}|${numericSpacingValues}|${numericFractionValues}|${numericOtherValues})(?:\\s+(?:${numericFigureValues}|${numericSpacingValues}|${numericFractionValues}|${numericOtherValues})){0,3})|(?:(?:${eastAsianVariantValues}|${eastAsianWidthValues}|${eastAsianRuby})(?:\\s+(?:${eastAsianVariantValues}|${eastAsianWidthValues}|${eastAsianRuby})){0,2})|(?:${positionValues})|(?:${emojiValues})))*)$`,
      'i',
    );
    validator = (v) => r.test(v);
  } else if (['fontVariationSettings'].includes(key)) {
    const axisTagDouble = '"wght"|"wdth"|"slnt"|"ital"|"opsz"';
    const axisTagSingle = "'wght'|'wdth'|'slnt'|'ital'|'opsz'";
    const r = new RegExp(
      `^(${axisTagDouble}|${axisTagSingle}|${varString})\\s+(${numberPattern})$`,
    );
    validator = (v) => r.test(v);
  } else if (['fontVariantNumeric'].includes(key)) {
    const fVals = [
      'lining-nums|oldstyle-nums',
      'proportional-nums|tabular-nums',
      'diagonal-fractions|stacked-fractions',
      'normal|ordinal|slashed-zero',
      varString,
    ].join('|');
    const r = new RegExp(`^(?:(${fVals})(?:\\s+(?!\\1)(${fVals}))*)?$`, 'i');
    validator = (v) => r.test(v);
  } else if (['fontVariantLigatures'].includes(key)) {
    const cl = 'common-ligatures|no-common-ligatures' + `|${varString}`;
    const dl =
      'discretionary-ligatures|no-discretionary-ligatures' + `|${varString}`;
    const hl = 'historical-ligatures|no-historical-ligatures' + `|${varString}`;
    const ca = 'contextual|no-contextual' + `|${varString}`;
    const r = new RegExp(
      `^(?:(?:(${cl})|)(?: (${dl})|)(?: (${hl})|)(?: (${ca})|)){1,4}$`,
    );
    validator = (v) => r.test(v);
  } else if (['fontVariantEastAsian'].includes(key)) {
    validator = isValidFontVariantEastAsian;
  } else if (['fontVariantAlternates'].includes(key)) {
    const r = new RegExp(
      `^(?:(?:(?:${notationFuncs})(?:\\s+(?:${notationFuncs})){0,5})|(?:(?:(?:${notationFuncs})\\s+){0,6}(historical-forms|${varString})(?:\\s+(?:${notationFuncs})){0,6}))$`,
      'i',
    );
    validator = (v) => r.test(v);
  } else if (['fontSynthesis'].includes(key)) {
    const r = new RegExp(
      `^(?:(weight|style|small-caps|position|${varString})(?:\\s+(?!\\1)(weight|style|small-caps|position|${varString}))*)?$`,
      'i',
    );
    validator = (v) => r.test(v);
  } else if (['fontStyle'].includes(key)) {
    const r = new RegExp(
      `^(oblique|${anglePattern})(\\s+(oblique|${anglePattern}))?$`,
    );
    validator = (v) => r.test(v);
  } else if (['fontPalette'].includes(key)) {
    const r = new RegExp(`^(${dashedIdentString}|${paletteMixString})$`);
    validator = (v) => r.test(v);
  } else if (['fontSizeAdjust'].includes(key)) {
    validator = isValidFontSizeAdjust;
  } else if (['fontLanguageOverride', 'hyphenateCharacter'].includes(key)) {
    const r = new RegExp(`^${stringString}$`);
    validator = (v) => r.test(v);
  } else if (['fontStretch', 'fontWidth'].includes(key)) {
    const r = new RegExp(`^${percentagePattern}$`);
    validator = (v) => r.test(v);
  } else if (['flex'].includes(key)) {
    const numRegex = new RegExp(`^${numberPattern}$`);
    const lenRegex = new RegExp(`^(${lvp})$`);
    const autoRegex = new RegExp(`^(${lvp}|auto)$`);
    validator = (value: string) => {
      const cleanValue = value.replace(/\s+/g, ' ').trim();
      if (!cleanValue) return false;
      const parts = splitColorValues(cleanValue);
      if (parts.length > 3) return false;
      if (parts.length === 1)
        return numRegex.test(parts[0]) || lenRegex.test(parts[0]);
      if (parts.length === 2) {
        if (!numRegex.test(parts[0])) return false;
        return numRegex.test(parts[1]) || lenRegex.test(parts[1]);
      }
      if (!numRegex.test(parts[0]) || !numRegex.test(parts[1])) return false;
      return autoRegex.test(parts[2]);
    };
  } else if (['cursor'].includes(key)) {
    validator = isValidCursor;
  } else if (['content'].includes(key)) {
    const contentItem = `${urlString}|${gradientString}|${imageSetString}|${attrString}|${counterString}|${countersString}|${stringString}|open-quote|close-quote|no-open-quote|no-close-quote|${varString}`;
    const altItem = `${stringString}|${counterString}|${countersString}|${attrString}|${varString}`;
    const r = new RegExp(
      `^(?:${contentItem})(?:\\s*(?:${contentItem}))*(?:\\s*/\\s*(?:${altItem})(?:\\s*(?:${altItem}))*)?$`,
    );
    validator = (v) => r.test(v);
  } else if (['contain'].includes(key)) {
    validator = isValidContain;
  } else if (['columns'].includes(key)) {
    const r = new RegExp(
      `^(?:auto\\s*(?:auto|${lvp}|${numberPattern})?|${numberPattern}\\s*(?:auto|${lvp}|${numberPattern})?|${lvp}\\s*(?:auto|${lvp}|${numberPattern})?)$`,
    );
    validator = (v) => r.test(v);
  } else if (['clipPath'].includes(key)) {
    const basicShapeWithoutVar = `(${varString}|inset\\([^\\)]+\\)|circle\\([^\\)]+\\)|ellipse\\([^\\)]+\\)|polygon\\([^\\)]+\\)|path\\(${stringString}\\)|rect\\([^\\)]+\\)|xywh\\([^\\)]+\\))`;
    const basicShapeString = `(${varString}\\s+${varString}|${varString}|${basicShapeWithoutVar})`;
    const geometryBoxWithVar = `(${getGeometryBaseSet()}|margin-box|${varString})`;
    const r = new RegExp(
      `^(${basicShapeString}|${geometryBoxWithVar}|${geometryBoxWithVar}\\s+${basicShapeString}|${basicShapeString}\\s+${geometryBoxWithVar})$`,
    );
    validator = (v) => r.test(v);
  } else if (['boxShadow'].includes(key)) {
    const r = new RegExp(
      `^(?:(?:inset\\s+)?(${lvp})\\s+(${lvp})(?:\\s+(${lvp}))?(?:\\s+(${lvp}))?\\s+(${colorSource}))(?:\\s*,\\s*(?:(?:inset\\s+)?(${lvp})\\s+(${lvp})(?:\\s+(${lvp}))?(?:\\s+(${lvp}))?\\s+(${colorSource})))*$`,
    );
    validator = (v) => r.test(v);
  } else if (['background'].includes(key)) {
    const positionPattern = `(?:(?:top|bottom|center|left|right|${varString})(?:\\s+top|bottom|center|left|right|${varString})?)`;
    const sizePattern = `(?:\\s*/\\s*(?:cover|contain|(${lvp})( (?!\\s)(${lvp})){0,2}?))?`;
    const flexibleLayerWithoutColor = `(?:(?:${positionPattern}${sizePattern})?|(?:${urlString}|${gradientString}|${imageSetString}|${varString}\\s*)?|(?:(?:repeat|space|round|no-repeat|repeatX|repeatY)\\s+)?|(?:scroll|fixed|local|${varString}\\s+)?|(?:border-box|padding-box|content-box|${varString}\\s+)?)`;
    const flexibleLayerWithColor = `(?:${flexibleLayerWithoutColor}\\s*)*(?:\\s*${colorSource})?`;
    const r = new RegExp(
      `^(?!\\s)(?=\\S)${flexibleLayerWithColor}(?:\\s*,\\s*${flexibleLayerWithColor})*$`,
    );
    validator = (v) => r.test(v);
  } else if (['backgroundAttachment'].includes(key)) {
    const r = new RegExp(
      `^(scroll|fixed|local|${varString})(\\s*,\\s*(scroll|fixed|local|${varString}))*$`,
    );
    validator = (v) => r.test(v);
  } else if (['backgroundBlendMode'].includes(key)) {
    const bm = [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'hard-light',
      'soft-light',
      'difference',
      'exclusion',
      'hue',
      'saturation',
      'color',
      'luminosity',
      varString,
    ].join('|');
    const r = new RegExp(`^(${bm})(\\s*,\\s*(${bm}))*$`);
    validator = (v) => r.test(v);
  } else if (['backgroundImage'].includes(key)) {
    const r = new RegExp(
      `^(${gradientString}|${urlString}|${imageSetString}|${varString}|none)(\\s*,\\s*(${gradientString}|${urlString}|${imageSetString}|${varString}|none))*$`,
    );
    validator = (v) => r.test(v);
  } else if (['backgroundOrigin', 'backgroundClip'].includes(key)) {
    const visualBox = `border-box|padding-box|content-box|${varString}`;
    const r = new RegExp(`^(${visualBox})(\\s*,\\s*(${visualBox}))*$`);
    validator = (v) => r.test(v);
  } else if (['backgroundPosition'].includes(key)) {
    const r = new RegExp(
      `^(${lvp})(\\s+(${lvp}))?(\\s+(${lvp}))?(\\s+(${lvp}))?(\\s*,\\s*(${lvp})(\\s+(${lvp}))?(\\s+(${lvp}))?(\\s+(${lvp}))?)*$`,
    );
    validator = (v) => r.test(v);
  } else if (
    ['backgroundSize', 'backgroundPositionY', 'backgroundPositionX'].includes(
      key,
    )
  ) {
    const r = new RegExp(
      `^(${lvp})(\\s+(${lvp}))?(\\s*,\\s*(${lvp})(\\s+(${lvp}))?)*$`,
    );
    validator = (v) => r.test(v);
  } else if (['backdropFilter', 'filter'].includes(key)) {
    const filterNumPattern = `(?:brightness|contrast|grayscale|invert|opacity|sepia|saturate)\\(\\s*${numberPattern}%?\\s*\\)`;
    const blurPattern = `blur\\(\\s*(${lengthPattern}|${calcString}|${clampString}|${minString}|${maxString}|${steppedValueString}|${absString}|${varString})\\s*\\)`;
    const anglePatternFunc = `hue-rotate\\(\\s*${anglePattern}\\s*\\)`;
    const dropShadowPattern = `drop-shadow\\(\\s*(?:${varString}|(?:${colorSource}|${lvp})(?:\\s+(?:${colorSource}|${lvp})){2,3})\\s*\\)`;
    const r = new RegExp(
      `^((?:${filterNumPattern}|${blurPattern}|${anglePatternFunc}|${dropShadowPattern}|(?:${urlString}|${gradientString}|${varString}\\s*)?)\\s*)+$`,
    );
    validator = (v) => r.test(v);
  } else if (
    ['animationTimingFunction', 'transitionTimingFunction'].includes(key)
  ) {
    const easingPattern = [
      'ease',
      'ease-in',
      'ease-out',
      'ease-in-out',
      'linear',
      'step-start',
      'step-end',
    ].join('|');
    const zeroToOne = '(0?\\.\\d+|0|1(\\.0+)?)';
    const bezierProgressPattern = `(?:${zeroToOne}|${varString})`;
    const cubicBezierPattern = `cubic-bezier\\(\\s*(?:${varString}|${bezierProgressPattern}\\s*,\\s*${numberPattern}\\s*,\\s*${bezierProgressPattern}\\s*,\\s*${numberPattern})\\s*\\)`;
    const stopLengthPattern = `(?:${percentagePattern}|${varString})`;
    const linearStopPattern = `${numberPattern}(?:\\s+${stopLengthPattern}){0,2}`;
    const linearPattern = `linear\\(\\s*(?:${varString}|${linearStopPattern}(?:\\s*,\\s*${linearStopPattern})*)\\s*\\)`;
    const positiveIntegerPattern = '[1-9]\\d*';
    const atLeastTwoIntegerPattern = '(?:[2-9]|[1-9]\\d+)';
    const stepPositionPattern = `(?:jump-start|jump-end|jump-both|start|end|${varString})`;
    const stepPattern = `steps\\(\\s*(?:${varString}|(?:${positiveIntegerPattern}|${varString})(?:\\s*,\\s*${stepPositionPattern})?|(?:${atLeastTwoIntegerPattern}|${varString})\\s*,\\s*jump-none)\\s*\\)`;
    const singlePat = `(${easingPattern}|${cubicBezierPattern}|${linearPattern}|${stepPattern}|${varString})`;
    const r = new RegExp(`^${singlePat}(\\s*,\\s*${singlePat})*$`);
    validator = (v) => r.test(v);
  } else if (['animationIterationCount'].includes(key)) {
    const r = new RegExp(
      `^(${numberPattern}|infinite)(,\\s*(${numberPattern}|infinite))*$`,
    );
    validator = (v) => r.test(v);
  } else if (['animationPlayState'].includes(key)) {
    const st = ['paused', 'running', varString].join('|');
    const r = new RegExp(`^(${st})(,\\s*(${st}))*$`);
    validator = (v) => r.test(v);
  } else if (['animationFillMode'].includes(key)) {
    const fm = ['none', 'forwards', 'backwards', 'both', varString].join('|');
    const r = new RegExp(`^(${fm})(,\\s*(${fm}))*$`);
    validator = (v) => r.test(v);
  } else if (['animationDirection'].includes(key)) {
    const dr = [
      'normal',
      'reverse',
      'alternate',
      'alternate-reverse',
      varString,
    ].join('|');
    const r = new RegExp(`^(${dr})(,\\s*(${dr}))*$`);
    validator = (v) => r.test(v);
  } else if (
    [
      'animationRange',
      'animationRangeStart',
      'animationRangeEnd',
      'timelineTriggerActivationRange',
      'timelineTriggerActivationRangeEnd',
      'timelineTriggerActivationRangeStart',
      'timelineTriggerActiveRange',
      'timelineTriggerActiveRangeEnd',
      'timelineTriggerActiveRangeStart',
    ].includes(key)
  ) {
    const rangeName = [
      'entry-crossing',
      'exit-crossing',
      'cover',
      'contain',
      'entry',
      'exit',
      'scroll',
    ].join('|');
    const bound = `(?:normal|(?:${lvp})|(?:${rangeName})(?:\\s+(?:${lvp}))?)`;
    const segment = key.endsWith('Range') ? `${bound}(?:\\s+${bound})?` : bound;
    const r = new RegExp(`^${segment}(?:\\s*,\\s*${segment})*$`);
    validator = (v) => r.test(v);
  } else if (
    [
      'animationDelay',
      'animationDuration',
      'transitionDelay',
      'transitionDuration',
    ].includes(key)
  ) {
    const r = new RegExp(
      `^-?(${pureNumber}(s|ms)|${varString})(,\\s-?(${pureNumber}(s|ms)|${varString}))*$`,
    );
    validator = (v) => r.test(v);
  } else if (['aspectRatio'].includes(key)) {
    const r = new RegExp(
      `^(auto\\s+)?(${varString}|${numberPattern}(\\s*\\/\\s*${numberPattern})?|auto)(\\s+auto)?$`,
    );
    validator = (v) => r.test(v);
  } else if (['borderImage'].includes(key)) {
    const sliceStr = sliceValuePattern.slice(1, -1);
    const widthStr = `(?:${varString}|${lengthPattern}|${percentagePattern}|${numberPattern}|auto)`;
    const outsetStr = `(?:${varString}|${lengthPattern}|${numberPattern})`;
    const r = new RegExp(
      `^(?:${imageRegex.source.slice(1, -1)}|${varString}|none)(?:\\s+(?:${varString}|${sliceStr}))?(?:\\s*\\/\\s*${widthStr}(?:\\s+${widthStr}){0,3})?(?:\\s*\\/\\s*${outsetStr}(?:\\s+${outsetStr}){0,3})?(?:\\s+(?:${varString}|stretch|repeat|round|space)){0,2}?$`,
    );
    validator = (v) => r.test(v);
  } else if (['borderImageSlice'].includes(key)) {
    validator = (v) => sliceRegex.test(v);
  } else if (key in keywordTokenRules) {
    validator = keywordTokens(key, keywordTokenRules[key]);
  } else if (dashedIdentListProperties.includes(key)) {
    validator = exactly(
      `(?:${dashedIdentString}|${varString})(?:\\s*,\\s*(?:${dashedIdentString}|${varString}))*`,
    );
  } else if (['containerName', 'viewTransitionClass'].includes(key)) {
    const item = `${dashedIdentString}|${customIdentString}|${varString}`;
    const r = new RegExp(`^(?:${item})(?:\\s+(?:${item}))*$`);
    const reserved = new Set([
      ...globalValues,
      'default',
      'none',
      ...(key === 'containerName' ? ['and', 'or', 'not'] : []),
    ]);
    validator = (v) =>
      r.test(v) &&
      !v
        .trim()
        .split(/\s+/)
        .some((token) => reserved.has(token.toLowerCase()));
  } else if (['page', 'viewTransitionGroup'].includes(key)) {
    validator = exactly(`${customIdentString}|${varString}`);
  } else if (['positionAnchor', 'timelineTriggerSource'].includes(key)) {
    validator = exactly(`${dashedIdentString}|${varString}`);
  } else if (keywordListProperties.includes(key)) {
    const item = `${validData[key].join('|')}|${varString}`;
    validator = exactly(`(?:${item})(?:\\s*,\\s*(?:${item}))*`);
  } else if (['alignTracks', 'justifyTracks'].includes(key)) {
    const keywords = validData[key].map((v) => v.replace(' ', '\\s+'));
    const item = `(?:unsafe|safe)\\s+(?:center|start|end|flex-start|flex-end|left|right)|${keywords.join('|')}|${varString}`;
    validator = exactly(`(?:${item})(?:\\s*,\\s*(?:${item}))*`);
  } else if (ruleInsetProperties.includes(key)) {
    const item = `${lengthPattern}|${percentagePattern}|${calcString}|overlap-join|${varString}`;
    const pair = `(?:${item})(?:\\s+(?:${item}))?`;
    validator = exactly(`${pair}(?:\\s*\\/\\s*${pair})?`);
  } else if (containIntrinsicProperties.includes(key)) {
    const item = `(?:auto\\s+)?(?:none|${lengthPattern}|${calcString}|${varString})`;
    validator = exactly(
      key === 'containIntrinsicSize' ? `${item}(?:\\s+${item})?` : item,
    );
  } else if (cornerShapeProperties.includes(key)) {
    const item = `${validData[key].join('|')}|superellipse\\(${mathContentsString}\\)|${varString}`;
    const count =
      key === 'cornerShape'
        ? 4
        : /^corner(?:(?:Top|Bottom)(?:Left|Right)|(?:Start|End)(?:Start|End))Shape$/.test(
              key,
            )
          ? 1
          : 2;
    validator = exactly(`(?:${item})(?:\\s+(?:${item})){0,${count - 1}}`);
  } else if (['textDecorationInset'].includes(key)) {
    const item = `${lengthPattern}|${calcString}|${varString}`;
    validator = exactly(`(?:${item})(?:\\s+(?:${item}))?`);
  } else if (['viewTimelineInset'].includes(key)) {
    const item = `auto|${lengthPattern}|${percentagePattern}|${calcString}|${varString}`;
    const pair = `(?:${item})(?:\\s+(?:${item}))?`;
    validator = exactly(`${pair}(?:\\s*,\\s*${pair})*`);
  } else if (['scrollSnapCoordinate'].includes(key)) {
    const item = `${lengthPattern}|${percentagePattern}|${calcString}|top|bottom|center|left|right|${varString}`;
    const position = `(?:${item})(?:\\s+(?:${item})){0,3}`;
    validator = exactly(`${position}(?:\\s*,\\s*${position})*`);
  } else if (
    ['interestDelay', 'interestDelayEnd', 'interestDelayStart'].includes(key)
  ) {
    const item = `normal|${timeString}|${varString}`;
    validator = exactly(
      key === 'interestDelay' ? `(?:${item})(?:\\s+(?:${item}))?` : item,
    );
  } else if (['fitTolerance'].includes(key)) {
    validator = exactly(
      `${lengthPattern}|${percentagePattern}|${calcString}|${varString}`,
    );
  } else if (['fontSmooth'].includes(key)) {
    validator = exactly(`${lengthPattern}|${calcString}|${varString}`);
  } else if (['pathLength'].includes(key)) {
    validator = exactly(`${pureNumber}|${varString}`);
  } else if (['d'].includes(key)) {
    validator = exactly(`path\\(\\s*${stringString}\\s*\\)|${varString}`);
  } else if (['clip'].includes(key)) {
    const edge = `auto|${lengthPattern}|${calcString}|${varString}`;
    const rect = (sep: string) =>
      `rect\\(\\s*(?:${edge})${sep}(?:${edge})${sep}(?:${edge})${sep}(?:${edge})\\s*\\)`;
    validator = exactly(`${rect('\\s*,\\s*')}|${rect('\\s+')}|${varString}`);
  } else if (['textDecoration'].includes(key)) {
    validator = isValidTextDecoration;
  } else if (['objectViewBox'].includes(key)) {
    validator = exactly(
      `(?:inset|xywh|rect)\\(${mathContentsString}\\)|${varString}`,
    );
  } else if (['dynamicRangeLimit'].includes(key)) {
    validator = exactly(
      `dynamic-range-limit-mix\\(${mathContentsString}\\)|${varString}`,
    );
  } else if (ImageSourceProperties.includes(key)) {
    validator = (v) => imageRegex.test(v);
  } else if (borderProperties.includes(key)) {
    const lvpRegex = new RegExp(`^(${lvp})$`);
    validator = (value: string) => {
      const parts = splitColorValues(value);
      if (parts.length > 3) return false;
      let hasWidth = false,
        hasStyle = false,
        hasColor = false;
      for (const part of parts) {
        if (varRegex.test(part)) continue;
        if (lineWidth.includes(part) || lvpRegex.test(part)) {
          if (hasWidth) return false;
          hasWidth = true;
        } else if (lineStyle.includes(part)) {
          if (hasStyle) return false;
          hasStyle = true;
        } else if (isValidColorValue(part)) {
          if (hasColor) return false;
          hasColor = true;
        } else {
          return false;
        }
      }
      return (
        hasStyle ||
        hasWidth ||
        hasColor ||
        parts.some((part) => varRegex.test(part))
      );
    };
  } else if (singleColorProperties.includes(key)) {
    validator = isValidColorValue;
  } else if (borderColorProperties.includes(key)) {
    validator = isValidMultipleColorValues;
  } else if (integerGroupProperties.includes(key)) {
    const r = positiveIntegerProperties.includes(key)
      ? new RegExp(`^(?:[1-9]\\d*|${varString})$`)
      : new RegExp(`^${integerPattern}$`);
    validator = (v) => r.test(v);
  } else if (otherGroupProperties.includes(key)) {
    const isOtherGroups = [
      'opacity',
      'stopOpacity',
      'strokeOpacity',
      'floodOpacity',
    ].includes(key);
    const r = new RegExp(`^(${numberPattern}${isOtherGroups ? '%?' : ''}|0)$`);
    validator = (v) => r.test(v);
  } else if (lengthValueProperties.includes(key)) {
    const r = new RegExp(`^(${lvp})$`);
    validator = (v) => r.test(v);
  } else if (borderRadiusProperties.includes(key)) {
    const r = new RegExp(
      `^(${lvp})( (?!\\s)(${lvp})){0,3}(\\s*/\\s*(${lvp})( (?!\\s)(${lvp})){0,3})?$`,
    );
    validator = (v) => r.test(v);
  } else if (borderStyleProperties.includes(key)) {
    const r = new RegExp(`^(${lineStyle})( (?!\\s)(${lineStyle})){0,3}$`);
    validator = (v) => r.test(v);
  } else if (multipleValueProperties.includes(key)) {
    const r = new RegExp(
      `^(${lvp})( (?!\\s)(${lvp})){0,${valueCountMap[key] - 1}}$`,
    );
    validator = (v) => r.test(v);
  }

  validatorCache.set(key, validator);
  return validator;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function suggestKeyword(key: string, value: string): string | null {
  const input = value.toLowerCase();
  if (!input || /\s/.test(input)) return null;
  let best: string | null = null;
  let bestDistance = Infinity;
  let tied = false;
  for (const candidate of new Set(validData[key])) {
    if (/\s/.test(candidate)) continue;
    const limit = Math.max(1, Math.floor(candidate.length / 3));
    if (Math.abs(input.length - candidate.length) > limit) continue;
    const distance = editDistance(input, candidate.toLowerCase());
    if (distance > limit) continue;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }
  return tied ? null : best;
}

function valueHint(key: string, value: string): string {
  if (
    integerGroupProperties.includes(key) &&
    /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())
  ) {
    return positiveIntegerProperties.includes(key)
      ? ' Use a positive integer.'
      : ' Use an integer.';
  }
  const suggestion = suggestKeyword(key, value);
  if (suggestion) return ` Did you mean '${suggestion}'?`;
  const keywords = [...new Set(validData[key])];
  if (keywords.length === 0) return '';
  if (!getValidator(key)) return ` Property keywords: ${keywords.join(', ')}.`;
  return ` Keyword examples include ${keywords
    .slice(0, 3)
    .map((keyword) => `'${keyword}'`)
    .join(', ')}.`;
}

const contextDependentUnits = [
  'cap',
  'ch',
  'em',
  'ex',
  'ic',
  'lh',
  'rcap',
  'rch',
  'rem',
  'rex',
  'ric',
  'rlh',
  'cqw',
  'cqh',
  'cqi',
  'cqb',
  'cqmin',
  'cqmax',
];
const contextDependentRegex = new RegExp(
  `(?:var\\(|[\\d.](?:${contextDependentUnits.join('|')})(?![a-zA-Z0-9_-]))`,
  'i',
);
const quotedStringRegex = new RegExp(stringString, 'g');
const timeString = `${pureNumber}(?:ms|s)`;
const resolutionString = `${pureNumber}(?:dpi|dpcm|dppx|x)`;
const customIdentRegex = /^-?[a-zA-Z_][a-zA-Z0-9_-]*$/;

const exactly = (pattern: string): ValidatorFn => {
  const r = new RegExp(`^(?:${pattern})$`);
  return (v) => r.test(v);
};

const varTypeValidators: Record<string, ValidatorFn> = {
  '<length>': exactly(`${lengthPattern}|${calcString}`),
  '<number>': exactly(`${pureNumber}|${calcString}`),
  '<integer>': exactly(`${pureInteger}|${calcString}`),
  '<percentage>': exactly(`${percentagePattern}|${calcString}`),
  '<length-percentage>': exactly(
    `${lengthPattern}|${percentagePattern}|${calcString}`,
  ),
  '<angle>': exactly(`${pureAngle}|${calcString}`),
  '<time>': exactly(`${timeString}|${calcString}`),
  '<resolution>': exactly(`${resolutionString}|${calcString}`),
  '<color>': isColor,
  '<image>': exactly(`${urlString}|${gradientString}|${imageSetString}`),
  '<url>': exactly(urlString),
  '<string>': exactly(stringString),
  '<custom-ident>': (v) =>
    customIdentRegex.test(v) &&
    !globalValues.includes(v.toLowerCase()) &&
    v.toLowerCase() !== 'default',
  '<transform-function>': exactly(transformFunctionString),
  '<transform-list>': exactly(
    `(?:${transformFunctionString})(?:\\s+(?:${transformFunctionString}))*`,
  ),
};

function splitTopLevelSpaces(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    if (depth === 0 && /\s/.test(char)) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function matchesSyntaxComponent(
  component: string,
  value: string,
): boolean | null {
  const multiplier = /[+#]$/.test(component) ? component.slice(-1) : '';
  const name = multiplier ? component.slice(0, -1) : component;
  if (!name.startsWith('<')) return multiplier ? null : value === name;
  const validator = varTypeValidators[name];
  if (!validator) return null;
  if (!multiplier) return validator(value);
  const items =
    multiplier === '+'
      ? splitTopLevelSpaces(value)
      : splitTopLevelCommas(value);
  return items.every((item) => item !== '' && validator(item));
}

function checkInitialValue(
  syntax: string,
  value: string,
): 'varTypeDependent' | 'varTypeMismatch' | null {
  const trimmedSyntax = syntax.trim();
  if (trimmedSyntax === '*') return null;
  if (contextDependentRegex.test(value.replace(quotedStringRegex, ''))) {
    return 'varTypeDependent';
  }
  const trimmedValue = value.trim();
  let unknown = false;
  for (const component of trimmedSyntax.split('|')) {
    const result = matchesSyntaxComponent(component.trim(), trimmedValue);
    if (result) return null;
    if (result === null) unknown = true;
  }
  return unknown ? null : 'varTypeMismatch';
}

// --- Rule Export ---
export const validateValues: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Validate camelCase CSS property values in JS objects or JSX',
    },
    messages: {
      validateValue: "'{{key}}' has an invalid value '{{value}}'.{{hint}}",
      invalidPrimitive:
        "'{{key}}' cannot be assigned a {{type}} value ({{value}}). CSS properties require string or number values.",
      invalidNumber:
        "'{{key}}' does not accept numeric values. Expected a string value.",
      varTypeMismatch:
        "css.varType initialValue '{{value}}' does not match the syntax '{{syntax}}'.",
      varTypeDependent:
        "css.varType initialValue '{{value}}' depends on the font, a container or var(), so the browser drops the @property. Use a value that does not depend on where it is used.",
    },
    schema: [],
  },
  create(context) {
    const plumeriaAliases: Record<string, string> = {};

    function checkStyleObject(node: Rule.Node) {
      const obj = node as ObjectExpression;
      obj.properties.forEach((prop: Property | SpreadElement) => {
        const property = prop as Property;
        if (property.type !== 'Property' || !property.key || !property.value) {
          return;
        }

        // 1. Nested Object (Recursion first)
        if (property.value.type === 'ObjectExpression') {
          if (!property.computed && property.key.type === 'Identifier') {
            const keyName = property.key.name;
            if (validData[keyName]) {
              context.report({
                node: property.value,
                messageId: 'invalidPrimitive',
                data: { key: keyName, type: 'object', value: 'object' },
              });
            }
          }
          checkStyleObject(property.value as Rule.Node);
          return;
        }

        // 2. Computed prop or non-identifier key check
        if (
          property.computed ||
          property.key.type !== 'Identifier' ||
          typeof property.key.name !== 'string'
        ) {
          return;
        }

        const key = property.key.name;
        if (!validData[key]) return;

        const valueNode = property.value;
        let rawValue: Literal['value'];
        if (valueNode.type === 'Literal') {
          rawValue = valueNode.value;
        } else if (
          valueNode.type === 'UnaryExpression' &&
          (valueNode.operator === '-' || valueNode.operator === '+') &&
          valueNode.argument.type === 'Literal' &&
          typeof valueNode.argument.value === 'number'
        ) {
          rawValue =
            valueNode.operator === '-'
              ? -valueNode.argument.value
              : valueNode.argument.value;
        } else {
          return;
        }

        // Boolean and null primitives
        if (typeof rawValue === 'boolean' || rawValue === null) {
          context.report({
            node: property.value,
            messageId: 'invalidPrimitive',
            data: {
              key,
              type: rawValue === null ? 'null' : 'boolean',
              value: String(rawValue),
            },
          });
          return;
        }

        // Number check (O(1) using precomputed Set)
        if (typeof rawValue === 'number') {
          if (!allowsNumberSet.has(key)) {
            context.report({
              node: property.value,
              messageId: 'invalidNumber',
              data: { key },
            });
          } else if (
            integerGroupProperties.includes(key) &&
            !getValidator(key)!(String(rawValue))
          ) {
            context.report({
              node: property.value,
              messageId: 'validateValue',
              data: {
                key,
                value: String(rawValue),
                hint: valueHint(key, String(rawValue)),
              },
            });
          }
          return;
        }

        if (typeof rawValue !== 'string') return;
        const value = rawValue;
        const normalized = normalizeCssVariables(value);
        const folded = value.toLowerCase();

        // Global values, Enums, and CSS Variables validation
        const globalValue =
          !getFoldedValues(key).has(folded) &&
          !globalValues.includes(folded) &&
          !normalized?.isStandalone;

        if (!globalValue) return; // Value is fully valid (enum/global/var)

        // 3. Dynamic Regex validation
        const validator = getValidator(key);

        const accepts = (v: string) =>
          !!validator &&
          (validator(normalizeColorFunctions(v)) ||
            validator(normalizeColorFunctions(v.toLowerCase())));

        if (validator && (!normalized || !accepts(normalized.value))) {
          context.report({
            node: property.value,
            messageId: 'validateValue',
            data: { key, value, hint: valueHint(key, value) },
          });
        } else if (!validator) {
          // Fallback for known properties that don't have a specific Regex implemented but failed Enum checks
          context.report({
            node: property.value,
            messageId: 'validateValue',
            data: { key, value, hint: valueHint(key, value) },
          });
        }
      });
    }

    function checkVarType(arg: Rule.Node | undefined) {
      if (!arg || arg.type !== 'ObjectExpression') return;
      let syntax = '*';
      let initialValue: Property['value'] | null = null;
      for (const prop of arg.properties) {
        if (
          prop.type !== 'Property' ||
          prop.computed ||
          prop.key.type !== 'Identifier'
        ) {
          continue;
        }
        if (prop.key.name === 'syntax') {
          if (prop.value.type !== 'Literal') return;
          if (typeof prop.value.value !== 'string') return;
          syntax = prop.value.value;
        } else if (prop.key.name === 'initialValue') {
          initialValue = prop.value;
        }
      }
      if (!initialValue || initialValue.type !== 'Literal') return;
      const raw = initialValue.value;
      if (typeof raw !== 'string' && typeof raw !== 'number') return;
      const value = String(raw);
      const messageId = checkInitialValue(syntax, value);
      if (messageId) {
        context.report({
          node: initialValue,
          messageId,
          data: { value, syntax },
        });
      }
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value === '@plumeria/core') {
          node.specifiers.forEach((specifier) => {
            if (
              specifier.type === 'ImportNamespaceSpecifier' ||
              specifier.type === 'ImportDefaultSpecifier'
            ) {
              plumeriaAliases[specifier.local.name] = 'NAMESPACE';
            } else {
              const spec = specifier as ImportSpecifier;
              const importedName =
                spec.imported.type === 'Identifier'
                  ? spec.imported.name
                  : String(spec.imported.value);
              plumeriaAliases[specifier.local.name] = importedName;
            }
          });
        }
      },
      CallExpression(node) {
        const styled = styledRule(context, node);
        if (styled) {
          checkStyleObject(styled as Rule.Node);
          return;
        }
        const calleeName =
          node.callee.type === 'MemberExpression'
            ? node.callee.object.type === 'Identifier' &&
              plumeriaAliases[node.callee.object.name] === 'NAMESPACE' &&
              node.callee.property.type === 'Identifier'
              ? node.callee.property.name
              : null
            : node.callee.type === 'Identifier'
              ? plumeriaAliases[node.callee.name]
              : null;
        if (calleeName === 'varType') {
          checkVarType(node.arguments[0] as Rule.Node | undefined);
          return;
        }

        let isCssProperties = false;

        let isPositionTry = false;
        if (node.callee.type === 'MemberExpression') {
          if (
            node.callee.object.type === 'Identifier' &&
            plumeriaAliases[node.callee.object.name] === 'NAMESPACE'
          ) {
            const propertyName =
              node.callee.property.type === 'Identifier'
                ? node.callee.property.name
                : null;
            if (
              propertyName === 'create' ||
              propertyName === 'keyframes' ||
              propertyName === 'viewTransitionClass' ||
              propertyName === 'positionTry'
            ) {
              isCssProperties = true;
              isPositionTry = propertyName === 'positionTry';
            }
          }
        } else if (node.callee.type === 'Identifier') {
          const alias = plumeriaAliases[node.callee.name];
          if (
            alias === 'create' ||
            alias === 'keyframes' ||
            alias === 'viewTransitionClass' ||
            alias === 'positionTry'
          ) {
            isCssProperties = true;
            isPositionTry = alias === 'positionTry';
          }
        }

        if (!isCssProperties) return;

        node.arguments.forEach((arg) => {
          if (arg.type === 'ObjectExpression') {
            if (isPositionTry) {
              checkStyleObject(arg as Rule.Node);
              return;
            }
            arg.properties.forEach((prop) => {
              if (prop.type !== 'Property') return;
              const style = styleObjectFromValue(prop.value);
              if (style) checkStyleObject(style as Rule.Node);
            });
          }
        });
      },
    };
  },
};
