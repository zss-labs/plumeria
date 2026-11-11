## Toolchain Notes

**Setup.** Do not write the configuration by hand. `npx @plumeria/init` detects the package manager and the bundler, installs the packages, writes `plumeria.d.ts` and the bundler config, extends the ESLint flat config, and on esbuild and Bun puts `plumeria-lint --` in front of the `build` script. The other bundler plugins lint the build themselves. It shows the plan before it writes, `--dry-run` stops at the plan, and `--yes` takes every default without asking, which is what makes it usable without a TTY. A project that is already set up reads as done and nothing is written.

**Compiler expectations.** The compiler statically extracts `css.create()` calls, which is why they MUST sit at module top level. Prefer direct, clearly defined references — indirect variable references may be unanalyzable.

**ESLint guarantees.** `@plumeria/eslint-plugin` enforces Plumeria's rules. Treat its errors as blocking, and its warnings (such as `no-order-dependent-overlap`) as defects to resolve rather than noise. It checks:

- **CSS property value validation** — invalid values are caught at lint time.
- **Property sort order** — one canonical order is enforced; the full order is specified under **Property order** below.
- **Property formatting** — one property per line, with no empty lines between properties; see **Property formatting** below.
- **Unused style detection** — unused styles are flagged automatically.

Follow the plugin's rules as documented in its `README.md`.

**Property order.** Properties MUST appear in the order `sort-properties` enforces, and a warning stops the build, so write them in this order from the start — group by group, and within a group in the order listed:

1. composes
2. all
3. position, positionAnchor, positionArea, positionTry, positionTryOrder, positionTryFallbacks, positionVisibility, anchorName, anchorScope, inset, insetBlock, insetBlockStart, insetBlockEnd, insetInline, insetInlineStart, insetInlineEnd, top, right, bottom, left, zIndex, float, clear
4. boxSizing, display, visibility
5. flex, flexGrow, flexShrink, flexBasis, flexFlow, flexDirection, flexWrap, WebkitBoxOrient
6. grid, gridArea, gridTemplate, gridTemplateAreas, gridTemplateRows, gridTemplateColumns, gridRow, gridRowStart, gridRowEnd, gridColumn, gridColumnStart, gridColumnEnd, gridAutoRows, gridAutoColumns, gridAutoFlow, gridGap, gridRowGap, gridColumnGap
7. gap, rowGap, columnGap, placeContent, placeItems, placeSelf, alignContent, alignItems, alignSelf, justifyContent, justifyItems, justifySelf
8. order
9. inlineSize, minInlineSize, maxInlineSize, width, minWidth, maxWidth, blockSize, minBlockSize, maxBlockSize, height, minHeight, maxHeight, aspectRatio
10. padding, paddingBlock, paddingBlockStart, paddingBlockEnd, paddingInline, paddingInlineStart, paddingInlineEnd, paddingTop, paddingRight, paddingBottom, paddingLeft, margin, marginBlock, marginBlockStart, marginBlockEnd, marginInline, marginInlineStart, marginInlineEnd, marginTop, marginRight, marginBottom, marginLeft
11. overflow, overflowInline, overflowBlock, overflowX, overflowY, scrollbarGutter, WebkitOverflowScrolling, msOverflowX, msOverflowY, msOverflowStyle, textOverflow, WebkitLineClamp, lineClamp, scrollBehavior
12. overscrollBehavior, overscrollBehaviorInline, overscrollBehaviorBlock, overscrollBehaviorX, overscrollBehaviorY
13. font, fontFamily, fontSize, fontSizeAdjust, fontVariationSettings, fontStyle, fontWeight, fontOpticalSizing, fontStretch, fontFeatureSettings, fontKerning, fontVariant, fontVariantLigatures, fontVariantCaps, fontVariantAlternates, fontVariantNumeric, fontVariantEastAsian, fontVariantPosition, WebkitFontSmoothing, MozOsxFontSmoothing, fontSmooth
14. lineHeight, verticalAlign, alignmentBaseline, baselineShift, dominantBaseline
15. color, WebkitTextFillColor, WebkitTextStroke, WebkitTextStrokeWidth, WebkitTextStrokeColor
16. textAlign, textAlignLast, textJustify, textIndent, textTransform, wordSpacing, letterSpacing, hyphens, wordBreak, textWrap, wordWrap, overflowWrap, tabSize, whiteSpace, whiteSpaceCollapse
17. textEmphasis, textEmphasisColor, textEmphasisStyle, textEmphasisPosition, textDecoration, textDecorationLine, textDecorationThickness, textDecorationStyle, textDecorationColor, textUnderlinePosition, textUnderlineOffset, textShadow
18. src, fontDisplay, unicodeRange, sizeAdjust, ascentOverride, descentOverride, lineGapOverride
19. appearance, accentColor, pointerEvents, msTouchAction, touchAction, cursor, caretColor, zoom, resize, userSelect, WebkitUserSelect, navIndex, navUp, navRight, navDown, navLeft, outline, outlineWidth, outlineStyle, outlineColor, outlineOffset
20. colorScheme
21. tableLayout, emptyCells, captionSide, borderSpacing, borderCollapse
22. content, quotes
23. listStyle, listStylePosition, listStyleType, listStyleImage, counterReset, counterSet, counterIncrement
24. scrollSnapType, scrollSnapAlign, scrollSnapStop, scrollPadding, scrollPaddingBlock, scrollPaddingBlockStart, scrollPaddingBlockEnd, scrollPaddingInline, scrollPaddingInlineStart, scrollPaddingInlineEnd, scrollPaddingTop, scrollPaddingRight, scrollPaddingBottom, scrollPaddingLeft, scrollMargin, scrollMarginBlock, scrollMarginBlockStart, scrollMarginBlockEnd, scrollMarginInline, scrollMarginInlineStart, scrollMarginInlineEnd, scrollMarginTop, scrollMarginRight, scrollMarginBottom, scrollMarginLeft
25. scrollbarColor, scrollbarWidth
26. objectFit, objectPosition, msInterpolationMode, imageOrientation, imageRendering, imageResolution
27. background, backgroundColor, backgroundImage, backgroundRepeat, backgroundAttachment, backgroundPosition, backgroundPositionX, backgroundPositionY, backgroundClip, backgroundOrigin, backgroundSize, border, borderColor, borderStyle, borderWidth, borderBlock, borderBlockColor, borderBlockStyle, borderBlockWidth, borderBlockStart, borderBlockStartColor, borderBlockStartStyle, borderBlockStartWidth, borderBlockEnd, borderBlockEndColor, borderBlockEndStyle, borderBlockEndWidth, borderInline, borderInlineColor, borderInlineStyle, borderInlineWidth, borderInlineStart, borderInlineStartColor, borderInlineStartStyle, borderInlineStartWidth, borderInlineEnd, borderInlineEndColor, borderInlineEndStyle, borderInlineEndWidth, borderTop, borderTopColor, borderTopStyle, borderTopWidth, borderRight, borderRightColor, borderRightStyle, borderRightWidth, borderBottom, borderBottomColor, borderBottomStyle, borderBottomWidth, borderLeft, borderLeftColor, borderLeftStyle, borderLeftWidth, borderRadius, borderStartStartRadius, borderStartEndRadius, borderEndStartRadius, borderEndEndRadius, borderTopLeftRadius, borderTopRightRadius, borderBottomRightRadius, borderBottomLeftRadius, borderImage, borderImageSource, borderImageSlice, borderImageWidth, borderImageOutset, borderImageRepeat, boxShadow
28. backgroundBlendMode, isolation, mixBlendMode
29. filter, backdropFilter
30. clip, clipPath, maskBorder, maskBorderSource, maskBorderSlice, maskBorderWidth, maskBorderOutset, maskBorderRepeat, maskBorderMode, mask, maskImage, maskMode, maskRepeat, maskPosition, maskClip, maskOrigin, maskSize, maskComposite
31. writingMode
32. textAnchor, fill, fillRule, fillOpacity, stroke, strokeOpacity, strokeWidth, strokeLinecap, strokeLinejoin, strokeMiterlimit, strokeDasharray, strokeDashoffset, colorInterpolation, colorInterpolationFilters, floodColor, floodOpacity, lightingColor, markerStart, markerMid, markerEnd, stopColor, stopOpacity, shapeRendering
33. transform, transformOrigin, rotate, scale, translate, perspective, perspectiveOrigin
34. transition, transitionDelay, transitionTimingFunction, transitionDuration, transitionProperty
35. animation, animationName, animationDuration, animationTimingFunction, animationDelay, animationIterationCount, animationDirection, animationFillMode, animationPlayState, animationComposition, animationTimeline, animationRange, animationRangeStart, animationRangeEnd
36. willChange
37. breakBefore, breakAfter, breakInside, widows, orphans

After every plain property, nested keys follow in this order: pseudo selectors (`:hover` and the like), then `&` selectors, then `@media` and `@container` blocks. A property that does not appear in the list sorts after the listed properties and before the selectors.

**Border shorthands.** Never write `border`, `borderBlock`, `borderInline`, `borderTop`, `borderRight`, `borderBottom`, `borderLeft`, `borderBlockStart`, `borderBlockEnd`, `borderInlineStart` or `borderInlineEnd`. A border shorthand always sets a width, a style and a color at once, even when the value names only one of them, and `expand-border-shorthands` rejects it. Write the three declarations it stands for instead — `borderColor`, `borderStyle`, `borderWidth`, or the per-side forms such as `borderTopColor`, `borderTopStyle`, `borderTopWidth`. For example, `border: 'none'` becomes:

```ts
borderColor: 'currentColor',
borderStyle: 'none',
borderWidth: 'medium',
```

The per-side forms expand into their own three longhands, and the axis forms (`borderBlock`, `borderInline`) expand the same way into `borderBlockColor`, `borderBlockStyle`, `borderBlockWidth` and their `borderInline` counterparts. For example, `borderTop: '1px solid #d1d5db'` becomes:

```ts
borderTopColor: '#d1d5db',
borderTopStyle: 'solid',
borderTopWidth: '1px',
```

A component the value does not name takes its initial value — width `medium`, style `none`, color `currentColor` — and is still written out, so `borderInlineStart: '2px dashed'` becomes:

```ts
borderInlineStartColor: 'currentColor',
borderInlineStartStyle: 'dashed',
borderInlineStartWidth: '2px',
```

**Property formatting.** In a style object, every property sits on its own line, and there are no empty lines between properties. `format-properties` rejects both a shared line and a blank line, and a warning stops the build, so expand compact objects when you write them. A variant map entry such as:

```ts
design: { color: '#1d4ed8', backgroundColor: '#dbeafe' },
```

is written:

```ts
design: {
  color: '#1d4ed8',
  backgroundColor: '#dbeafe',
},
```
