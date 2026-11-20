use std::fs;
use std::process::ExitCode;

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::stylesheet::quote;
use crate::stylex::position;
use crate::{apply, extension, walk as walk_files, Options, SOURCES};

pub fn class_hash(classes: &[&str]) -> String {
    let mut sorted: Vec<&str> = classes.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in sorted.join(" ").bytes() {
        hash = (hash ^ byte as u64).wrapping_mul(0x0100_0000_01b3);
    }
    let mut digits = Vec::with_capacity(7);
    for _ in 0..7 {
        let digit = (hash % 36) as u8;
        digits.push(if digit < 10 { b'0' + digit } else { b'a' + digit - 10 });
        hash /= 36;
    }
    format!("t_{}", String::from_utf8(digits).unwrap_or_default())
}

#[derive(Clone, PartialEq, Debug)]
enum Part {
    Text(String),
    Token(String),
}

#[derive(Clone, PartialEq, Debug)]
struct Expr(Vec<Part>);

impl Expr {
    fn text(text: impl Into<String>) -> Self {
        Expr(vec![Part::Text(text.into())])
    }

    fn then(mut self, other: Expr) -> Self {
        for part in other.0 {
            match (self.0.last_mut(), part) {
                (Some(Part::Text(last)), Part::Text(next)) => last.push_str(&next),
                (_, part) => self.0.push(part),
            }
        }
        self
    }

    fn wrap(self, before: &str, after: &str) -> Self {
        Expr::text(before).then(self).then(Expr::text(after))
    }

    fn render(&self) -> String {
        match self.0.as_slice() {
            [Part::Token(token)] => token.clone(),
            [] => "''".to_string(),
            parts if parts.iter().all(|p| matches!(p, Part::Text(_))) => {
                let joined: String = parts.iter().map(|p| match p { Part::Text(t) | Part::Token(t) => t.as_str() }).collect();
                quote(&joined)
            }
            parts => {
                let mut out = String::from("`");
                for part in parts {
                    match part {
                        Part::Text(text) => out.push_str(&text.replace('\\', "\\\\").replace('`', "\\`").replace("${", "\\${")),
                        Part::Token(token) => {
                            out.push_str("${");
                            out.push_str(token);
                            out.push('}');
                        }
                    }
                }
                out.push('`');
                out
            }
        }
    }
}

const PALETTES: &[&str] = &[
    "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet",
    "purple", "fuchsia", "pink", "rose", "slate", "gray", "zinc", "neutral", "stone", "mauve", "olive", "mist", "taupe",
];
const SHADES: &[&str] = &["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const SIZES: &[&str] = &["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];
const BREAKPOINTS: &[&str] = &["sm", "md", "lg", "xl", "2xl"];
const CONTAINERS: &[&str] = &["3xs", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl"];
const WEIGHTS: &[&str] = &["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"];
const TRACKING: &[&str] = &["tighter", "tight", "normal", "wide", "wider", "widest"];
const LEADING: &[&str] = &["tight", "snug", "normal", "relaxed", "loose"];
const RADII: &[&str] = &["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];
const SHADOWS: &[&str] = &["2xs", "xs", "sm", "md", "lg", "xl", "2xl"];
const EASES: &[&str] = &["in", "out", "in-out"];
const ANIMATIONS: &[&str] = &["spin", "ping", "pulse", "bounce"];
const FONTS: &[&str] = &["sans", "serif", "mono"];
const SPACING: &[&str] = &[
    "px", "0", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14", "16",
    "20", "24", "28", "32", "36", "40", "44", "48", "52", "56", "60", "64", "72", "80", "96",
];

#[derive(Default)]
pub struct Theme {
    overrides: Vec<String>,
    dark_redefined: bool,
}

impl Theme {
    pub fn read(&mut self, css: &str) {
        let theme = self;
        let mut rest = css;
        while let Some(at) = rest.find("@theme") {
            let Some(open) = rest[at..].find('{') else { break };
            let body = &rest[at + open + 1..];
            let mut depth = 1usize;
            let mut end = body.len();
            for (index, c) in body.char_indices() {
                match c {
                    '{' => depth += 1,
                    '}' => {
                        depth -= 1;
                        if depth == 0 {
                            end = index;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            for declaration in body[..end].split(';') {
                let declaration = declaration.trim();
                if let Some((name, _)) = declaration.split_once(':')
                    && name.trim_start().starts_with("--")
                {
                    theme.overrides.push(name.trim().to_string());
                }
            }
            rest = &body[end..];
        }
        if css.contains("@custom-variant dark") {
            theme.dark_redefined = true;
        }
    }

    fn overridden(&self, variable: &str) -> bool {
        self.overrides.iter().any(|name| match name.strip_suffix('*') {
            Some(prefix) => variable.starts_with(prefix) || prefix.strip_suffix('-') == Some(variable),
            None => name == variable,
        })
    }
}

struct Resolve<'t> {
    theme: &'t Theme,
    wind: bool,
    hold: Option<&'static str>,
}

impl Resolve<'_> {
    fn token(&mut self, group: &str, keys: &[&str], key: &str, variable: &str) -> Option<Expr> {
        if !keys.contains(&key) {
            return None;
        }
        if self.theme.overridden(variable) {
            self.hold = Some("theme-override");
            return None;
        }
        self.wind = true;
        Some(Expr(vec![Part::Token(member(group, key))]))
    }
}

fn arbitrary(value: &str) -> Option<Expr> {
    let inner = value.strip_prefix('[')?.strip_suffix(']')?;
    if inner.is_empty() || inner.contains("--tw-") {
        return None;
    }
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&'_') => {
                out.push('_');
                chars.next();
            }
            '_' => out.push(' '),
            _ => out.push(c),
        }
    }
    Some(Expr::text(out))
}

fn decimal(value: &str) -> Option<f64> {
    let valid = !value.is_empty()
        && value.chars().all(|c| c.is_ascii_digit() || c == '.')
        && value.matches('.').count() <= 1
        && !value.starts_with('.')
        && !value.ends_with('.');
    if valid { value.parse().ok() } else { None }
}

fn number(value: f64) -> String {
    crate::js::number::number_to_string(value)
}

fn fraction(value: &str) -> Option<Expr> {
    let (top, bottom) = value.split_once('/')?;
    let (a, b) = (decimal(top)?, decimal(bottom)?);
    if b == 0.0 {
        return None;
    }
    let percent = a / b * 100.0;
    if (percent * 1e6).fract() == 0.0 && percent.to_string().len() < 12 {
        Some(Expr::text(format!("{}%", number(percent))))
    } else {
        Some(Expr::text(format!("calc({top} / {bottom} * 100%)")))
    }
}

fn negate(expr: Expr) -> Expr {
    match expr.0.as_slice() {
        [Part::Text(text)] if text != "0" => Expr::text(format!("-{text}")),
        [Part::Text(_)] => expr,
        _ => expr.wrap("calc(", " * -1)"),
    }
}

impl Resolve<'_> {
    fn spacing(&mut self, value: &str, negative: bool) -> Option<Expr> {
        let expr = if let Some(expr) = arbitrary(value) {
            expr
        } else if let Some(expr) = self.token("spacing", SPACING, value, "--spacing") {
            expr
        } else if let Some(n) = decimal(value) {
            if (n * 4.0).fract() != 0.0 {
                return None;
            }
            if self.theme.overridden("--spacing") {
                self.hold = Some("theme-override");
                return None;
            }
            Expr::text(format!("{}rem", number(n * 0.25)))
        } else {
            return None;
        };
        Some(if negative { negate(expr) } else { expr })
    }

    fn color(&mut self, value: &str) -> Option<Expr> {
        let (base, alpha) = match value.rsplit_once('/') {
            Some((base, alpha))
                if (decimal(alpha).is_some() || (alpha.starts_with('[') && alpha.ends_with(']')))
                    && (!base.starts_with('[') || base.ends_with(']')) =>
            {
                (base, Some(alpha))
            }
            _ => (value, None),
        };
        let color = match base {
            "transparent" => Expr::text("transparent"),
            "current" => Expr::text("currentColor"),
            "inherit" => Expr::text("inherit"),
            "black" | "white" => self.token("color", &["black", "white"], base, &format!("--color-{base}"))?,
            _ if base.starts_with('[') => {
                let expr = arbitrary(base)?;
                let text = match expr.0.as_slice() {
                    [Part::Text(text)] => text.clone(),
                    _ => return None,
                };
                let colorish = text.starts_with('#')
                    || text.starts_with("rgb")
                    || text.starts_with("hsl")
                    || text.starts_with("oklch")
                    || text.starts_with("oklab")
                    || text.starts_with("color")
                    || text.starts_with("var(");
                if !colorish {
                    return None;
                }
                expr
            }
            _ => {
                let (palette, shade) = base.rsplit_once('-')?;
                if !PALETTES.contains(&palette) {
                    return None;
                }
                self.token(palette, SHADES, shade, &format!("--color-{palette}-{shade}"))?
            }
        };
        let Some(alpha) = alpha else { return Some(color) };
        let amount = match arbitrary(alpha) {
            Some(Expr(parts)) => match parts.as_slice() {
                [Part::Text(text)] => text.clone(),
                _ => return None,
            },
            None => format!("{}%", number(decimal(alpha)?)),
        };
        Some(color.wrap("color-mix(in oklab, ", &format!(" {amount}, transparent)")))
    }

    fn size(&mut self, value: &str, negative: bool, axis: char) -> Option<Expr> {
        let viewport = if matches!(axis, 'h' | 'H') { "vh" } else { "vw" };
        let fixed = match value {
            "auto" => Some("auto".to_string()),
            "full" => Some("100%".to_string()),
            "screen" => Some(format!("100{viewport}")),
            "dvw" | "dvh" | "svw" | "svh" | "lvw" | "lvh" => Some(format!("100{value}")),
            "min" | "max" | "fit" => Some(format!("{value}-content")),
            "none" if matches!(axis, 'W' | 'H') => Some("none".to_string()),
            "prose" if axis == 'W' => Some("65ch".to_string()),
            _ => None,
        };
        if let Some(text) = fixed {
            return (!negative || text == "100%").then(|| {
                let expr = Expr::text(text);
                if negative { negate(expr) } else { expr }
            });
        }
        if let Some(expr) = fraction(value) {
            return Some(if negative { negate(expr) } else { expr });
        }
        if axis != 'p' && CONTAINERS.contains(&value) && !negative {
            return self.token("container", CONTAINERS, value, &format!("--container-{value}"));
        }
        self.spacing(value, negative)
    }
}

#[derive(Clone, Debug)]
struct Decl {
    property: String,
    value: Expr,
    weak: bool,
}

fn decl(property: &str, value: Expr) -> Decl {
    Decl { property: property.to_string(), value, weak: false }
}

fn weak(property: &str, value: Expr) -> Decl {
    Decl { property: property.to_string(), value, weak: true }
}

const FIXED: &[(&str, &[(&str, &str)])] = &[
    ("block", &[("display", "block")]),
    ("inline-block", &[("display", "inline-block")]),
    ("inline", &[("display", "inline")]),
    ("flex", &[("display", "flex")]),
    ("inline-flex", &[("display", "inline-flex")]),
    ("grid", &[("display", "grid")]),
    ("inline-grid", &[("display", "inline-grid")]),
    ("contents", &[("display", "contents")]),
    ("flow-root", &[("display", "flow-root")]),
    ("table", &[("display", "table")]),
    ("hidden", &[("display", "none")]),
    ("static", &[("position", "static")]),
    ("fixed", &[("position", "fixed")]),
    ("absolute", &[("position", "absolute")]),
    ("relative", &[("position", "relative")]),
    ("sticky", &[("position", "sticky")]),
    ("flex-row", &[("flexDirection", "row")]),
    ("flex-row-reverse", &[("flexDirection", "row-reverse")]),
    ("flex-col", &[("flexDirection", "column")]),
    ("flex-col-reverse", &[("flexDirection", "column-reverse")]),
    ("flex-wrap", &[("flexWrap", "wrap")]),
    ("flex-wrap-reverse", &[("flexWrap", "wrap-reverse")]),
    ("flex-nowrap", &[("flexWrap", "nowrap")]),
    ("flex-1", &[("flex", "1")]),
    ("flex-auto", &[("flex", "auto")]),
    ("flex-initial", &[("flex", "0 auto")]),
    ("flex-none", &[("flex", "none")]),
    ("grow", &[("flexGrow", "1")]),
    ("grow-0", &[("flexGrow", "0")]),
    ("shrink", &[("flexShrink", "1")]),
    ("shrink-0", &[("flexShrink", "0")]),
    ("items-start", &[("alignItems", "flex-start")]),
    ("items-end", &[("alignItems", "flex-end")]),
    ("items-center", &[("alignItems", "center")]),
    ("items-baseline", &[("alignItems", "baseline")]),
    ("items-stretch", &[("alignItems", "stretch")]),
    ("justify-start", &[("justifyContent", "flex-start")]),
    ("justify-end", &[("justifyContent", "flex-end")]),
    ("justify-center", &[("justifyContent", "center")]),
    ("justify-between", &[("justifyContent", "space-between")]),
    ("justify-around", &[("justifyContent", "space-around")]),
    ("justify-evenly", &[("justifyContent", "space-evenly")]),
    ("justify-stretch", &[("justifyContent", "stretch")]),
    ("justify-items-center", &[("justifyItems", "center")]),
    ("self-auto", &[("alignSelf", "auto")]),
    ("self-start", &[("alignSelf", "flex-start")]),
    ("self-end", &[("alignSelf", "flex-end")]),
    ("self-center", &[("alignSelf", "center")]),
    ("self-stretch", &[("alignSelf", "stretch")]),
    ("self-baseline", &[("alignSelf", "baseline")]),
    ("content-start", &[("alignContent", "flex-start")]),
    ("content-end", &[("alignContent", "flex-end")]),
    ("content-center", &[("alignContent", "center")]),
    ("content-between", &[("alignContent", "space-between")]),
    ("content-around", &[("alignContent", "space-around")]),
    ("content-evenly", &[("alignContent", "space-evenly")]),
    ("place-items-center", &[("placeItems", "center")]),
    ("place-content-center", &[("placeContent", "center")]),
    ("text-left", &[("textAlign", "left")]),
    ("text-center", &[("textAlign", "center")]),
    ("text-right", &[("textAlign", "right")]),
    ("text-justify", &[("textAlign", "justify")]),
    ("text-start", &[("textAlign", "start")]),
    ("text-end", &[("textAlign", "end")]),
    ("text-ellipsis", &[("textOverflow", "ellipsis")]),
    ("text-clip", &[("textOverflow", "clip")]),
    ("text-wrap", &[("textWrap", "wrap")]),
    ("text-nowrap", &[("textWrap", "nowrap")]),
    ("text-balance", &[("textWrap", "balance")]),
    ("text-pretty", &[("textWrap", "pretty")]),
    ("uppercase", &[("textTransform", "uppercase")]),
    ("lowercase", &[("textTransform", "lowercase")]),
    ("capitalize", &[("textTransform", "capitalize")]),
    ("normal-case", &[("textTransform", "none")]),
    ("italic", &[("fontStyle", "italic")]),
    ("not-italic", &[("fontStyle", "normal")]),
    ("underline", &[("textDecorationLine", "underline")]),
    ("overline", &[("textDecorationLine", "overline")]),
    ("line-through", &[("textDecorationLine", "line-through")]),
    ("no-underline", &[("textDecorationLine", "none")]),
    ("truncate", &[("overflow", "hidden"), ("textOverflow", "ellipsis"), ("whiteSpace", "nowrap")]),
    ("whitespace-normal", &[("whiteSpace", "normal")]),
    ("whitespace-nowrap", &[("whiteSpace", "nowrap")]),
    ("whitespace-pre", &[("whiteSpace", "pre")]),
    ("whitespace-pre-line", &[("whiteSpace", "pre-line")]),
    ("whitespace-pre-wrap", &[("whiteSpace", "pre-wrap")]),
    ("whitespace-break-spaces", &[("whiteSpace", "break-spaces")]),
    ("break-words", &[("overflowWrap", "break-word")]),
    ("wrap-break-word", &[("overflowWrap", "break-word")]),
    ("wrap-anywhere", &[("overflowWrap", "anywhere")]),
    ("break-all", &[("wordBreak", "break-all")]),
    ("break-keep", &[("wordBreak", "keep-all")]),
    ("antialiased", &[("WebkitFontSmoothing", "antialiased"), ("MozOsxFontSmoothing", "grayscale")]),
    ("subpixel-antialiased", &[("WebkitFontSmoothing", "auto"), ("MozOsxFontSmoothing", "auto")]),
    ("overflow-auto", &[("overflow", "auto")]),
    ("overflow-hidden", &[("overflow", "hidden")]),
    ("overflow-clip", &[("overflow", "clip")]),
    ("overflow-visible", &[("overflow", "visible")]),
    ("overflow-scroll", &[("overflow", "scroll")]),
    ("overflow-x-auto", &[("overflowX", "auto")]),
    ("overflow-x-hidden", &[("overflowX", "hidden")]),
    ("overflow-x-scroll", &[("overflowX", "scroll")]),
    ("overflow-x-clip", &[("overflowX", "clip")]),
    ("overflow-x-visible", &[("overflowX", "visible")]),
    ("overflow-y-auto", &[("overflowY", "auto")]),
    ("overflow-y-hidden", &[("overflowY", "hidden")]),
    ("overflow-y-scroll", &[("overflowY", "scroll")]),
    ("overflow-y-clip", &[("overflowY", "clip")]),
    ("overflow-y-visible", &[("overflowY", "visible")]),
    ("pointer-events-none", &[("pointerEvents", "none")]),
    ("pointer-events-auto", &[("pointerEvents", "auto")]),
    ("select-none", &[("userSelect", "none")]),
    ("select-text", &[("userSelect", "text")]),
    ("select-all", &[("userSelect", "all")]),
    ("select-auto", &[("userSelect", "auto")]),
    ("visible", &[("visibility", "visible")]),
    ("invisible", &[("visibility", "hidden")]),
    ("collapse", &[("visibility", "collapse")]),
    ("object-contain", &[("objectFit", "contain")]),
    ("object-cover", &[("objectFit", "cover")]),
    ("object-fill", &[("objectFit", "fill")]),
    ("object-none", &[("objectFit", "none")]),
    ("object-scale-down", &[("objectFit", "scale-down")]),
    ("object-center", &[("objectPosition", "center")]),
    ("list-none", &[("listStyleType", "none")]),
    ("list-disc", &[("listStyleType", "disc")]),
    ("list-decimal", &[("listStyleType", "decimal")]),
    ("list-inside", &[("listStylePosition", "inside")]),
    ("list-outside", &[("listStylePosition", "outside")]),
    ("resize-none", &[("resize", "none")]),
    ("resize", &[("resize", "both")]),
    ("resize-x", &[("resize", "horizontal")]),
    ("resize-y", &[("resize", "vertical")]),
    ("appearance-none", &[("appearance", "none")]),
    ("outline-none", &[("outlineStyle", "none")]),
    ("outline-hidden", &[("outline", "2px solid transparent"), ("outlineOffset", "2px")]),
    ("isolate", &[("isolation", "isolate")]),
    ("box-border", &[("boxSizing", "border-box")]),
    ("box-content", &[("boxSizing", "content-box")]),
    ("border-collapse", &[("borderCollapse", "collapse")]),
    ("border-separate", &[("borderCollapse", "separate")]),
    ("aspect-square", &[("aspectRatio", "1 / 1")]),
    ("aspect-auto", &[("aspectRatio", "auto")]),
    ("shadow-none", &[("boxShadow", "0 0 #0000")]),
    ("rounded-none", &[("borderRadius", "0")]),
    ("rounded-full", &[("borderRadius", "calc(infinity * 1px)")]),
    ("transition-none", &[("transitionProperty", "none")]),
    ("animate-none", &[("animation", "none")]),
    ("bg-cover", &[("backgroundSize", "cover")]),
    ("bg-contain", &[("backgroundSize", "contain")]),
    ("bg-center", &[("backgroundPosition", "center")]),
    ("bg-no-repeat", &[("backgroundRepeat", "no-repeat")]),
    ("bg-repeat", &[("backgroundRepeat", "repeat")]),
    ("bg-fixed", &[("backgroundAttachment", "fixed")]),
    ("bg-none", &[("backgroundImage", "none")]),
    ("leading-none", &[("lineHeight", "1")]),
    ("ease-linear", &[("transitionTimingFunction", "linear")]),
    ("grid-cols-none", &[("gridTemplateColumns", "none")]),
    ("grid-rows-none", &[("gridTemplateRows", "none")]),
    ("col-span-full", &[("gridColumn", "1 / -1")]),
    ("row-span-full", &[("gridRow", "1 / -1")]),
    ("z-auto", &[("zIndex", "auto")]),
    (
        "sr-only",
        &[
            ("position", "absolute"),
            ("width", "1px"),
            ("height", "1px"),
            ("padding", "0"),
            ("margin", "-1px"),
            ("overflow", "hidden"),
            ("clip", "rect(0, 0, 0, 0)"),
            ("whiteSpace", "nowrap"),
            ("borderWidth", "0"),
        ],
    ),
];

const BORDER_STYLES: &[&str] = &["solid", "dashed", "dotted", "double", "hidden", "none"];
const CURSORS: &[&str] = &[
    "auto", "default", "pointer", "wait", "text", "move", "help", "not-allowed", "none", "context-menu", "progress",
    "cell", "crosshair", "vertical-text", "alias", "copy", "no-drop", "grab", "grabbing", "all-scroll", "col-resize",
    "row-resize", "n-resize", "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize", "sw-resize",
    "ew-resize", "ns-resize", "nesw-resize", "nwse-resize", "zoom-in", "zoom-out",
];
const PROPERTY_ORDER: &[&str] = &[
    "position", "inset", "insetBlock", "insetInline", "insetInlineStart", "insetInlineEnd", "top", "right", "bottom",
    "left", "zIndex", "boxSizing", "display", "visibility", "flex", "flexGrow", "flexShrink", "flexBasis",
    "flexDirection", "flexWrap", "WebkitBoxOrient", "gridTemplateRows", "gridTemplateColumns", "gridRow",
    "gridRowStart", "gridRowEnd", "gridColumn", "gridColumnStart", "gridColumnEnd", "gap", "rowGap", "columnGap",
    "placeContent", "placeItems", "alignContent", "alignItems", "alignSelf", "justifyContent", "justifyItems", "order",
    "width", "minWidth", "maxWidth", "height", "minHeight", "maxHeight", "aspectRatio", "padding", "paddingBlock",
    "paddingInline", "paddingInlineStart", "paddingInlineEnd", "paddingTop", "paddingRight", "paddingBottom",
    "paddingLeft", "margin", "marginBlock", "marginInline", "marginInlineStart", "marginInlineEnd", "marginTop",
    "marginRight", "marginBottom", "marginLeft", "overflow", "overflowX", "overflowY", "textOverflow",
    "WebkitLineClamp", "fontFamily", "fontSize", "fontStyle", "fontWeight", "WebkitFontSmoothing",
    "MozOsxFontSmoothing", "lineHeight", "color", "textAlign", "textTransform", "letterSpacing", "wordBreak",
    "textWrap", "overflowWrap", "whiteSpace", "textDecorationLine", "appearance", "pointerEvents", "cursor", "resize",
    "userSelect", "outline", "outlineStyle", "outlineOffset", "borderCollapse", "content", "listStylePosition",
    "listStyleType", "objectFit", "objectPosition", "backgroundColor", "backgroundImage", "backgroundRepeat",
    "backgroundAttachment", "backgroundPosition", "backgroundSize", "borderColor", "borderStyle", "borderWidth",
    "borderBlockColor", "borderBlockStyle", "borderBlockWidth", "borderInlineColor", "borderInlineStyle",
    "borderInlineWidth", "borderInlineStartColor", "borderInlineStartStyle", "borderInlineStartWidth",
    "borderInlineEndColor", "borderInlineEndStyle", "borderInlineEndWidth", "borderTopColor", "borderTopStyle",
    "borderTopWidth", "borderRightColor", "borderRightStyle", "borderRightWidth", "borderBottomColor",
    "borderBottomStyle", "borderBottomWidth", "borderLeftColor", "borderLeftStyle", "borderLeftWidth", "borderRadius",
    "borderStartStartRadius", "borderStartEndRadius", "borderEndStartRadius", "borderEndEndRadius",
    "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius", "boxShadow",
    "isolation", "clip", "fill", "stroke", "strokeWidth", "rotate", "scale", "translate", "transitionDelay",
    "transitionTimingFunction", "transitionDuration", "transitionProperty", "animation",
];
const TRANSITION_COLORS: &str = "color, background-color, border-color, outline-color, text-decoration-color, fill, stroke";

type Family = (&'static str, &'static [&'static str]);

const PADDINGS: &[Family] = &[
    ("px", &["paddingInline"]),
    ("py", &["paddingBlock"]),
    ("ps", &["paddingInlineStart"]),
    ("pe", &["paddingInlineEnd"]),
    ("pt", &["paddingTop"]),
    ("pr", &["paddingRight"]),
    ("pb", &["paddingBottom"]),
    ("pl", &["paddingLeft"]),
    ("p", &["padding"]),
    ("gap-x", &["columnGap"]),
    ("gap-y", &["rowGap"]),
    ("gap", &["gap"]),
];
const MARGINS: &[Family] = &[
    ("mx", &["marginInline"]),
    ("my", &["marginBlock"]),
    ("ms", &["marginInlineStart"]),
    ("me", &["marginInlineEnd"]),
    ("mt", &["marginTop"]),
    ("mr", &["marginRight"]),
    ("mb", &["marginBottom"]),
    ("ml", &["marginLeft"]),
    ("m", &["margin"]),
];
const INSETS: &[Family] = &[
    ("inset-x", &["insetInline"]),
    ("inset-y", &["insetBlock"]),
    ("inset", &["inset"]),
    ("top", &["top"]),
    ("right", &["right"]),
    ("bottom", &["bottom"]),
    ("left", &["left"]),
    ("start", &["insetInlineStart"]),
    ("end", &["insetInlineEnd"]),
    ("translate-x", &["@translate-x"]),
    ("translate-y", &["@translate-y"]),
];
const SIZINGS: &[(&str, &[&str], char)] = &[
    ("min-w", &["minWidth"], 'w'),
    ("min-h", &["minHeight"], 'h'),
    ("max-w", &["maxWidth"], 'W'),
    ("max-h", &["maxHeight"], 'H'),
    ("size", &["width", "height"], 'w'),
    ("basis", &["flexBasis"], 'w'),
    ("w", &["width"], 'w'),
    ("h", &["height"], 'h'),
];
const SIDES: &[(&str, &str)] = &[
    ("x", "Inline"),
    ("y", "Block"),
    ("s", "InlineStart"),
    ("e", "InlineEnd"),
    ("t", "Top"),
    ("r", "Right"),
    ("b", "Bottom"),
    ("l", "Left"),
];
const CORNERS: &[(&str, &[&str])] = &[
    ("tl", &["TopLeft"]),
    ("tr", &["TopRight"]),
    ("br", &["BottomRight"]),
    ("bl", &["BottomLeft"]),
    ("ss", &["StartStart"]),
    ("se", &["StartEnd"]),
    ("ee", &["EndEnd"]),
    ("es", &["EndStart"]),
    ("t", &["TopLeft", "TopRight"]),
    ("r", &["TopRight", "BottomRight"]),
    ("b", &["BottomRight", "BottomLeft"]),
    ("l", &["TopLeft", "BottomLeft"]),
    ("s", &["StartStart", "EndStart"]),
    ("e", &["StartEnd", "EndEnd"]),
];

fn family<'n, T: Copy>(name: &'n str, families: &[(&'static str, T)]) -> Option<(T, &'n str)> {
    families
        .iter()
        .find_map(|(prefix, item)| Some((*item, name.strip_prefix(prefix)?.strip_prefix('-')?)))
}

fn integer(value: &str) -> Option<&str> {
    (!value.is_empty() && value.chars().all(|c| c.is_ascii_digit())).then_some(value)
}

fn all(properties: &[&str], value: Expr) -> Vec<Decl> {
    properties.iter().map(|p| decl(p, value.clone())).collect()
}

impl Resolve<'_> {
    fn utility(&mut self, class: &str) -> Option<Vec<Decl>> {
        let (negative, name) = match class.strip_prefix('-') {
            Some(name) => (true, name),
            None => (false, class),
        };
        if !negative && let Some((_, decls)) = FIXED.iter().find(|(n, _)| *n == name) {
            return Some(decls.iter().map(|(p, v)| decl(p, Expr::text(*v))).collect());
        }
        if !negative && let Some((properties, value)) = family(name, PADDINGS) {
            return Some(all(properties, self.spacing(value, false)?));
        }
        if let Some((properties, value)) = family(name, MARGINS) {
            let expr = if value == "auto" && !negative { Expr::text("auto") } else { self.spacing(value, negative)? };
            return Some(all(properties, expr));
        }
        if let Some((properties, value)) = family(name, INSETS) {
            return Some(all(properties, self.size(value, negative, 'p')?));
        }
        if !negative && let Some(((properties, axis), value)) =
            SIZINGS.iter().find_map(|(prefix, properties, axis)| {
                Some(((*properties, *axis), name.strip_prefix(prefix)?.strip_prefix('-')?))
            })
        {
            return Some(all(properties, self.size(value, false, axis)?));
        }
        let (head, value) = name.split_once('-').unwrap_or((name, ""));
        let numeric = |suffix: &str| -> Option<Vec<Decl>> {
            let n = integer(value)?;
            let text = if negative { format!("-{n}{suffix}") } else { format!("{n}{suffix}") };
            Some(vec![decl(
                match head {
                    "z" => "zIndex",
                    "order" => "order",
                    "rotate" => "rotate",
                    _ => return None,
                },
                Expr::text(text),
            )])
        };
        match head {
            "z" | "order" => return numeric(""),
            "rotate" => return numeric("deg"),
            _ => {}
        }
        if negative {
            return None;
        }
        match head {
            "opacity" => Some(vec![decl("opacity", Expr::text(format!("{}%", integer(value)?)))]),
            "scale" => Some(vec![decl("scale", Expr::text(format!("{}%", integer(value)?)))]),
            "duration" => Some(vec![decl("transitionDuration", Expr::text(format!("{}ms", integer(value)?)))]),
            "delay" => Some(vec![decl("transitionDelay", Expr::text(format!("{}ms", integer(value)?)))]),
            "cursor" => CURSORS.contains(&value).then(|| vec![decl("cursor", Expr::text(value))]),
            "fill" => Some(vec![decl("fill", self.color(value)?)]),
            "stroke" => match integer(value) {
                Some(n) => Some(vec![decl("strokeWidth", Expr::text(n))]),
                None => Some(vec![decl("stroke", self.color(value)?)]),
            },
            "bg" => Some(vec![decl("backgroundColor", self.color(value)?)]),
            "text" => self.text(value),
            "font" => {
                if WEIGHTS.contains(&value) {
                    let expr = self.token("fontWeight", WEIGHTS, value, &format!("--font-weight-{value}"))?;
                    Some(vec![decl("fontWeight", expr)])
                } else {
                    let expr = self.token("font", FONTS, value, &format!("--font-{value}"))?;
                    Some(vec![decl("fontFamily", expr)])
                }
            }
            "leading" => {
                let expr = match self.token("leading", LEADING, value, &format!("--leading-{value}")) {
                    Some(expr) => expr,
                    None => self.spacing(value, false)?,
                };
                Some(vec![decl("lineHeight", expr)])
            }
            "tracking" => {
                let expr = match arbitrary(value) {
                    Some(expr) => expr,
                    None => self.token("tracking", TRACKING, value, &format!("--tracking-{value}"))?,
                };
                Some(vec![decl("letterSpacing", expr)])
            }
            "border" => self.border(value),
            "rounded" => self.rounded(value),
            "shadow" => {
                let key = if value.is_empty() { "sm" } else { value };
                Some(vec![decl("boxShadow", self.token("shadow", SHADOWS, key, &format!("--shadow-{key}"))?)])
            }
            "transition" => self.transition(value),
            "ease" => {
                let expr = self.token("ease", EASES, value, &format!("--ease-{value}"))?;
                Some(vec![decl("transitionTimingFunction", expr)])
            }
            "animate" => {
                if !ANIMATIONS.contains(&value) {
                    return None;
                }
                let timing = self.token("animate", ANIMATIONS, value, &format!("--animate-{value}"))?;
                let expr = Expr(vec![Part::Token(format!("t.{value}")), Part::Text(" ".to_string())]).then(timing);
                Some(vec![decl("animation", expr)])
            }
            "aspect" => {
                let expr = if let Some(expr) = arbitrary(value) {
                    expr
                } else if let Some((a, b)) = value.split_once('/') {
                    Expr::text(format!("{} / {}", integer(a)?, integer(b)?))
                } else {
                    self.token("aspect", &["video"], value, &format!("--aspect-{value}"))?
                };
                Some(vec![decl("aspectRatio", expr)])
            }
            "grid" => {
                let (axis, count) = value.split_once('-')?;
                let property = match axis {
                    "cols" => "gridTemplateColumns",
                    "rows" => "gridTemplateRows",
                    _ => return None,
                };
                let expr = match arbitrary(count) {
                    Some(expr) => expr,
                    None => Expr::text(format!("repeat({}, minmax(0, 1fr))", integer(count)?)),
                };
                Some(vec![decl(property, expr)])
            }
            "col" | "row" => {
                let (kind, n) = value.split_once('-')?;
                let n = integer(n)?;
                let axis = if head == "col" { "gridColumn" } else { "gridRow" };
                match kind {
                    "span" => Some(vec![decl(axis, Expr::text(format!("span {n} / span {n}")))]),
                    "start" => Some(vec![decl(&format!("{axis}Start"), Expr::text(n))]),
                    "end" => Some(vec![decl(&format!("{axis}End"), Expr::text(n))]),
                    _ => None,
                }
            }
            "line" => {
                let n = integer(value.strip_prefix("clamp-")?)?;
                Some(vec![
                    decl("overflow", Expr::text("hidden")),
                    decl("display", Expr::text("-webkit-box")),
                    decl("WebkitBoxOrient", Expr::text("vertical")),
                    decl("WebkitLineClamp", Expr::text(n)),
                ])
            }
            _ => None,
        }
    }

    fn text(&mut self, value: &str) -> Option<Vec<Decl>> {
        let (size, modifier) = match value.split_once('/') {
            Some((size, modifier)) if SIZES.contains(&size) || size.starts_with('[') => (size, Some(modifier)),
            _ => (value, None),
        };
        if SIZES.contains(&size) {
            let font = self.token("text", SIZES, size, &format!("--text-{size}"))?;
            let line = match modifier {
                None => self.token("textLineHeight", SIZES, size, &format!("--text-{size}--line-height"))?,
                Some(modifier) => match self.token("leading", LEADING, modifier, &format!("--leading-{modifier}")) {
                    Some(expr) => expr,
                    None => self.spacing(modifier, false)?,
                },
            };
            return Some(vec![decl("fontSize", font), decl("lineHeight", line)]);
        }
        if let Some(expr) = arbitrary(size)
            && let [Part::Text(text)] = expr.0.as_slice()
            && text.starts_with(|c: char| c.is_ascii_digit() || c == '.')
        {
            let mut decls = vec![decl("fontSize", expr.clone())];
            if let Some(modifier) = modifier {
                decls.push(decl("lineHeight", self.spacing(modifier, false)?));
            }
            return Some(decls);
        }
        Some(vec![decl("color", self.color(value)?)])
    }

    fn border(&mut self, value: &str) -> Option<Vec<Decl>> {
        let (side, rest) = match SIDES.iter().find(|(key, _)| value == *key || value.starts_with(&format!("{key}-"))) {
            Some((key, side)) => (*side, value[key.len()..].trim_start_matches('-')),
            None => ("", value),
        };
        let width = format!("border{side}Width");
        let style = format!("border{side}Style");
        if rest.is_empty() {
            return Some(vec![weak(&style, Expr::text("solid")), decl(&width, Expr::text("1px"))]);
        }
        if let Some(n) = integer(rest) {
            return Some(vec![weak(&style, Expr::text("solid")), decl(&width, Expr::text(format!("{n}px")))]);
        }
        if side.is_empty() && BORDER_STYLES.contains(&rest) {
            return Some(vec![decl("borderStyle", Expr::text(rest))]);
        }
        if let Some(expr) = arbitrary(rest)
            && let [Part::Text(text)] = expr.0.as_slice()
            && text.starts_with(|c: char| c.is_ascii_digit())
        {
            return Some(vec![weak(&style, Expr::text("solid")), decl(&width, expr.clone())]);
        }
        Some(vec![decl(&format!("border{side}Color"), self.color(rest)?)])
    }

    fn rounded(&mut self, value: &str) -> Option<Vec<Decl>> {
        let (corners, key) = match CORNERS.iter().find(|(key, _)| value == *key || value.starts_with(&format!("{key}-"))) {
            Some((key, corners)) => (*corners, value[key.len()..].trim_start_matches('-')),
            None => (&[][..], value),
        };
        let expr = match key {
            "" => self.token("radius", RADII, "sm", "--radius-sm")?,
            "none" => Expr::text("0"),
            "full" => Expr::text("calc(infinity * 1px)"),
            _ => match arbitrary(key) {
                Some(expr) => expr,
                None => self.token("radius", RADII, key, &format!("--radius-{key}"))?,
            },
        };
        if corners.is_empty() {
            return Some(vec![decl("borderRadius", expr)]);
        }
        Some(corners.iter().map(|corner| decl(&format!("border{corner}Radius"), expr.clone())).collect())
    }

    fn transition(&mut self, value: &str) -> Option<Vec<Decl>> {
        let properties = match value {
            "" => format!(
                "{TRANSITION_COLORS}, opacity, box-shadow, transform, translate, scale, rotate, filter, -webkit-backdrop-filter, backdrop-filter, display, content-visibility, overlay, pointer-events"
            ),
            "colors" => TRANSITION_COLORS.to_string(),
            "opacity" => "opacity".to_string(),
            "shadow" => "box-shadow".to_string(),
            "transform" => "transform, translate, scale, rotate".to_string(),
            "all" => "all".to_string(),
            _ => return None,
        };
        let keys = &["duration", "timingFunction"];
        let timing = self.token("transition", keys, "timingFunction", "--default-transition-timing-function")?;
        let duration = self.token("transition", keys, "duration", "--default-transition-duration")?;
        Some(vec![
            decl("transitionProperty", Expr::text(properties)),
            weak("transitionTimingFunction", timing),
            weak("transitionDuration", duration),
        ])
    }
}

const STATES: &[(&str, &str)] = &[
    ("first", ":first-child"),
    ("last", ":last-child"),
    ("only", ":only-child"),
    ("odd", ":nth-child(odd)"),
    ("even", ":nth-child(even)"),
    ("visited", ":visited"),
    ("checked", ":checked"),
    ("placeholder-shown", ":placeholder-shown"),
    ("required", ":required"),
    ("invalid", ":invalid"),
    ("read-only", ":read-only"),
    ("empty", ":empty"),
    ("focus-within", ":focus-within"),
    ("hover", ":hover"),
    ("focus", ":focus"),
    ("focus-visible", ":focus-visible"),
    ("active", ":active"),
    ("enabled", ":enabled"),
    ("disabled", ":disabled"),
];
const ELEMENTS: &[(&str, &str)] = &[
    ("before", "::before"),
    ("after", "::after"),
    ("placeholder", "::placeholder"),
    ("selection", "::selection"),
    ("marker", "::marker"),
    ("file", "::file-selector-button"),
    ("first-line", "::first-line"),
    ("first-letter", "::first-letter"),
];

#[derive(Clone, Default, PartialEq, Eq, PartialOrd, Ord, Debug)]
struct Context {
    ats: Vec<usize>,
    states: Vec<(usize, String)>,
    element: Option<String>,
}

fn split_variants(class: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut start = 0;
    for (index, c) in class.char_indices() {
        match c {
            '[' | '(' => depth += 1,
            ']' | ')' => depth -= 1,
            ':' if depth == 0 => {
                parts.push(&class[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }
    parts.push(&class[start..]);
    parts
}

fn attribute(prefix: &str, value: &str) -> Option<String> {
    if let Some(inner) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
        let (name, matched) = inner.split_once('=').unwrap_or((inner, ""));
        let valid = |text: &str| text.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if name.is_empty() || !valid(name) || !valid(matched) {
            return None;
        }
        return Some(if matched.is_empty() {
            format!("[{prefix}-{name}]")
        } else {
            format!("[{prefix}-{name}=\"{matched}\"]")
        });
    }
    if value.is_empty() || !value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    Some(if prefix == "aria" { format!("[aria-{value}=\"true\"]") } else { format!("[data-{value}]") })
}

fn merge(decls: Vec<(Decl, &str)>) -> Result<Vec<Decl>, (&'static str, String)> {
    let mut strong: Vec<(Decl, &str)> = Vec::new();
    for (decl, class) in decls.iter().filter(|(d, _)| !d.weak) {
        match strong.iter().find(|(d, _)| d.property == decl.property) {
            Some((existing, _)) if existing.value == decl.value => {}
            Some((_, other)) => return Err(("conflicting-classes", format!("{other} {class}"))),
            None => strong.push((decl.clone(), *class)),
        }
    }
    let border_style = strong.iter().find(|(d, _)| d.property == "borderStyle").map(|(d, _)| d.value.clone());
    let mut out: Vec<Decl> = Vec::new();
    for (decl, _) in &decls {
        if out.iter().any(|d| d.property == decl.property) {
            continue;
        }
        if !decl.weak {
            out.push(decl.clone());
            continue;
        }
        if strong.iter().any(|(d, _)| d.property == decl.property) {
            continue;
        }
        let mut decl = decl.clone();
        if decl.property.starts_with("border")
            && decl.property.ends_with("Style")
            && let Some(value) = &border_style
        {
            decl.value = value.clone();
        }
        out.push(decl);
    }
    let x = out.iter().position(|d| d.property == "@translate-x");
    let y = out.iter().position(|d| d.property == "@translate-y");
    if x.is_some() || y.is_some() {
        let value_of = |at: Option<usize>| at.map_or(Expr::text("0"), |i| out[i].value.clone());
        let translate = value_of(x).then(Expr::text(" ")).then(value_of(y));
        let at = x.into_iter().chain(y).min().unwrap_or(0);
        out.retain(|d| !d.property.starts_with("@translate"));
        out.insert(at.min(out.len()), decl("translate", translate));
    }
    Ok(out)
}

impl Resolve<'_> {
    fn context(&mut self, variants: &[&str]) -> Option<Context> {
        let mut context = Context::default();
        for variant in variants {
            if let Some(index) = BREAKPOINTS.iter().position(|b| b == variant) {
                context.ats.push(5 + index);
            } else if let Some(index) = variant.strip_prefix("max-").and_then(|b| BREAKPOINTS.iter().position(|k| *k == b)) {
                context.ats.push(4 - index);
            } else if *variant == "dark" {
                if self.theme.dark_redefined {
                    self.hold = Some("custom-variant");
                    return None;
                }
                context.ats.push(10);
            } else if let Some(index) = STATES.iter().position(|(name, _)| name == variant) {
                context.states.push((index, STATES[index].1.to_string()));
            } else if let Some((_, element)) = ELEMENTS.iter().find(|(name, _)| name == variant) {
                if context.element.is_some() {
                    return None;
                }
                context.element = Some(element.to_string());
            } else if let Some(value) = variant.strip_prefix("data-") {
                context.states.push((STATES.len(), attribute("data", value)?));
            } else if let Some(value) = variant.strip_prefix("aria-") {
                context.states.push((STATES.len() + 1, attribute("aria", value)?));
            } else {
                return None;
            }
        }
        context.ats.sort_unstable();
        context.ats.dedup();
        context.states.sort();
        context.states.dedup();
        Some(context)
    }

    fn at_key(&mut self, ats: &[usize]) -> String {
        let mut expr = Expr::text("@media ");
        for (index, at) in ats.iter().enumerate() {
            if index > 0 {
                expr = expr.then(Expr::text(" and "));
            }
            let condition = match at {
                0..=4 => {
                    let key = BREAKPOINTS[4 - at];
                    let token = self.token("breakpoint", BREAKPOINTS, key, &format!("--breakpoint-{key}"));
                    token.map(|t| t.wrap("(width < ", ")"))
                }
                5..=9 => {
                    let key = BREAKPOINTS[at - 5];
                    let token = self.token("breakpoint", BREAKPOINTS, key, &format!("--breakpoint-{key}"));
                    token.map(|t| t.wrap("(width >= ", ")"))
                }
                _ => Some(Expr::text("(prefers-color-scheme: dark)")),
            };
            expr = expr.then(condition.unwrap_or_else(|| Expr::text("")));
        }
        let rendered = expr.render();
        if rendered.starts_with('`') { format!("[{rendered}]") } else { rendered }
    }

    fn style(&mut self, classes: &[&str]) -> Result<String, (&'static str, String)> {
        let mut grouped: Vec<(Context, Vec<(Decl, &str)>)> = Vec::new();
        for class in classes {
            let mut parts = split_variants(class);
            let utility = parts.pop().unwrap_or_default();
            if utility.starts_with('!') || utility.ends_with('!') {
                return Err(("important", class.to_string()));
            }
            let fail = |resolve: &mut Self, kind: &'static str| (resolve.hold.take().unwrap_or(kind), class.to_string());
            let Some(context) = self.context(&parts) else { return Err(fail(self, "unknown-variant")) };
            let Some(mut decls) = self.utility(utility) else { return Err(fail(self, "unknown-class")) };
            if let Some(element) = &context.element
                && (element == "::before" || element == "::after")
            {
                decls.push(weak("content", Expr::text("\"\"")));
            }
            let index = match grouped.iter().position(|(c, _)| *c == context) {
                Some(index) => index,
                None => {
                    grouped.push((context, Vec::new()));
                    grouped.len() - 1
                }
            };
            grouped[index].1.extend(decls.into_iter().map(|d| (d, *class)));
        }
        let mut merged: Vec<(Context, Vec<Decl>)> = Vec::new();
        for (context, decls) in grouped {
            merged.push((context, merge(decls)?));
        }
        self.compound(&mut merged)?;
        merged.sort_by(|a, b| a.0.cmp(&b.0));
        let rendered = self.render(&merged);
        match self.hold.take() {
            Some(kind) => Err((kind, classes.join(" "))),
            None => Ok(rendered),
        }
    }

    fn compound(&mut self, merged: &mut Vec<(Context, Vec<Decl>)>) -> Result<(), (&'static str, String)> {
        let mut added: Vec<(Context, Decl)> = Vec::new();
        for (i, (context, decls)) in merged.iter().enumerate() {
            if context.states.is_empty() {
                continue;
            }
            for decl in decls {
                let rivals: Vec<&Context> = merged
                    .iter()
                    .enumerate()
                    .filter(|(j, (other, other_decls))| {
                        *j != i
                            && !other.states.is_empty()
                            && other.ats == context.ats
                            && other.element == context.element
                            && other_decls.iter().any(|d| d.property == decl.property)
                    })
                    .map(|(_, (other, _))| other)
                    .collect();
                let disjoint: Vec<&&Context> = rivals
                    .iter()
                    .filter(|other| {
                        !other.states.iter().all(|s| context.states.contains(s))
                            && !context.states.iter().all(|s| other.states.contains(s))
                    })
                    .collect();
                if disjoint.is_empty() {
                    continue;
                }
                if disjoint.len() > 1 {
                    return Err(("overlapping-states", decl.property.clone()));
                }
                let other = disjoint[0];
                let mut union = context.clone();
                union.states.extend(other.states.iter().cloned());
                union.states.sort();
                union.states.dedup();
                let covered = merged.iter().any(|(c, ds)| *c == union && ds.iter().any(|d| d.property == decl.property))
                    || added.iter().any(|(c, d)| *c == union && d.property == decl.property);
                let mine = context.states.iter().map(|s| s.0).max();
                let theirs = other.states.iter().map(|s| s.0).max();
                if !covered && mine > theirs {
                    added.push((union, decl.clone()));
                }
            }
        }
        for (context, decl) in added {
            match merged.iter_mut().find(|(c, _)| *c == context) {
                Some((_, decls)) => decls.push(decl),
                None => merged.push((context, vec![decl])),
            }
        }
        Ok(())
    }

    fn render(&mut self, merged: &[(Context, Vec<Decl>)]) -> String {
        let mut out = String::from("{\n");
        let mut open_at: Option<&Vec<usize>> = None;
        for (context, decls) in merged {
            let nested = !context.ats.is_empty();
            if open_at != Some(&context.ats) {
                if open_at.is_some_and(|a| !a.is_empty()) {
                    out.push_str("    },\n");
                }
                if nested {
                    let key = self.at_key(&context.ats);
                    out.push_str(&format!("    {key}: {{\n"));
                }
                open_at = Some(&context.ats);
            }
            let mut pad = if nested { "      ".to_string() } else { "    ".to_string() };
            let selector: String = context.states.iter().map(|(_, s)| s.as_str()).chain(context.element.as_deref()).collect();
            if !selector.is_empty() {
                out.push_str(&format!("{pad}{}: {{\n", quote(&selector)));
                pad.push_str("  ");
            }
            let mut sorted: Vec<&Decl> = decls.iter().collect();
            sorted.sort_by_key(|d| PROPERTY_ORDER.iter().position(|p| *p == d.property).unwrap_or(PROPERTY_ORDER.len()));
            for decl in sorted {
                out.push_str(&format!("{pad}{}: {},\n", decl.property, decl.value.render()));
            }
            if !selector.is_empty() {
                out.push_str(&format!("{}}},\n", &pad[2..]));
            }
        }
        if open_at.is_some_and(|a| !a.is_empty()) {
            out.push_str("    },\n");
        }
        out.push_str("  }");
        out
    }
}

#[derive(Debug)]
pub struct Hold {
    pub kind: &'static str,
    pub detail: String,
    pub at: u32,
}

#[derive(Default)]
pub struct Outcome {
    pub rewritten: Option<String>,
    pub holds: Vec<Hold>,
    pub wind: bool,
}

struct Scan<'s, 't> {
    text: &'s str,
    style_prop: &'s str,
    scoping: &'s Scoping,
    resolve: Resolve<'t>,
    cn: FxHashSet<SymbolId>,
    joins: FxHashMap<SymbolId, &'static str>,
    cn_seen: usize,
    cn_converted: usize,
    styles: Vec<(String, Vec<String>, String)>,
    edits: Vec<(u32, u32, String)>,
    holds: Vec<Hold>,
}

impl<'s> Scan<'s, '_> {
    fn hold(&mut self, kind: &'static str, detail: impl Into<String>, at: u32) {
        self.holds.push(Hold { kind, detail: detail.into(), at });
    }

    fn source(&self, span: Span) -> &'s str {
        &self.text[span.start as usize..span.end as usize]
    }

    fn symbol(&self, expression: &Expression) -> Option<SymbolId> {
        let Expression::Identifier(identifier) = expression.get_inner_expression() else { return None };
        self.scoping.get_reference(identifier.reference_id.get()?).symbol_id()
    }

    fn classes(&mut self, literal: &str, at: u32) -> Option<String> {
        let tokens: Vec<&str> = literal.split_whitespace().collect();
        if tokens.is_empty() {
            return Some("false".to_string());
        }
        let key = class_hash(&tokens);
        let mut normalized: Vec<String> = tokens.iter().map(|t| t.to_string()).collect();
        normalized.sort_unstable();
        normalized.dedup();
        if let Some((_, existing, _)) = self.styles.iter().find(|(k, _, _)| *k == key) {
            if *existing != normalized {
                self.hold("hash-collision", key, at);
                return None;
            }
            return Some(format!("styles.{key}"));
        }
        match self.resolve.style(&tokens) {
            Ok(body) => {
                self.styles.push((key.clone(), normalized, body));
                Some(format!("styles.{key}"))
            }
            Err((kind, detail)) => {
                self.hold(kind, detail, at);
                None
            }
        }
    }

    fn literal(&self, expression: &Expression) -> Option<&'s str> {
        match expression {
            Expression::StringLiteral(literal) => {
                let span = literal.span;
                Some(&self.text[span.start as usize + 1..span.end as usize - 1])
            }
            Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                let span = template.span;
                Some(&self.text[span.start as usize + 1..span.end as usize - 1])
            }
            _ => None,
        }
    }

    fn item(&mut self, expression: &Expression) -> Option<String> {
        let expression = expression.get_inner_expression();
        let at = expression.span().start;
        if let Some(literal) = self.literal(expression) {
            return self.classes(literal, at);
        }
        match expression {
            Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => Some(self.source(expression.span()).to_string()),
            Expression::Identifier(identifier) if identifier.name.as_str() == "undefined" => Some("undefined".to_string()),
            Expression::ConditionalExpression(conditional) => {
                let consequent = self.item(&conditional.consequent)?;
                let alternate = self.item(&conditional.alternate)?;
                Some(format!("{} ? {consequent} : {alternate}", self.source(conditional.test.span())))
            }
            Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
                let mut right = self.item(&logical.right)?;
                if matches!(logical.right.get_inner_expression(), Expression::ConditionalExpression(_)) {
                    right = format!("({right})");
                }
                Some(format!("{} && {right}", self.source(logical.left.span())))
            }
            _ => {
                self.hold("dynamic-class", self.source(expression.span()).to_string(), at);
                None
            }
        }
    }

    fn value(&mut self, expression: &Expression) -> Option<Option<String>> {
        let expression = expression.get_inner_expression();
        let at = expression.span().start;
        if let Expression::CallExpression(call) = expression {
            let symbol = self.symbol(&call.callee);
            if symbol.is_some_and(|s| self.cn.contains(&s)) {
                let mut items = Vec::new();
                for argument in &call.arguments {
                    let Some(argument) = argument.as_expression() else {
                        self.hold("dynamic-class", self.source(argument.span()).to_string(), argument.span().start);
                        return None;
                    };
                    items.push(self.item(argument)?);
                }
                self.cn_converted += 1;
                return Some(Some(match items.as_slice() {
                    [single] => single.clone(),
                    _ => format!("[{}]", items.join(", ")),
                }));
            }
            let kind = symbol.and_then(|s| self.joins.get(&s).copied()).unwrap_or("dynamic-class");
            let callee = self.source(call.callee.span());
            let detail = if kind == "use-cn" {
                format!("{callee}  rewrite with import {{ cn }} from 'cn'")
            } else {
                callee.to_string()
            };
            self.hold(kind, detail, at);
            return None;
        }
        match expression {
            Expression::StringLiteral(_)
            | Expression::TemplateLiteral(_)
            | Expression::ConditionalExpression(_)
            | Expression::LogicalExpression(_) => Some(Some(self.item(expression)?)),
            _ => Some(None),
        }
    }
}

impl<'a> Visit<'a> for Scan<'_, '_> {
    fn visit_jsx_opening_element(&mut self, opening: &JSXOpeningElement<'a>) {
        let mut class_name = None;
        let mut taken = false;
        let mut spread = false;
        for item in &opening.attributes {
            match item {
                JSXAttributeItem::SpreadAttribute(_) => spread = true,
                JSXAttributeItem::Attribute(attribute) => match &attribute.name {
                    JSXAttributeName::Identifier(name) if name.name.as_str() == "className" => class_name = Some(attribute),
                    JSXAttributeName::Identifier(name) if name.name.as_str() == self.style_prop => taken = true,
                    _ => {}
                },
            }
        }
        if let Some(attribute) = class_name {
            let at = attribute.span.start;
            let value = match &attribute.value {
                Some(JSXAttributeValue::StringLiteral(literal)) => {
                    let span = literal.span;
                    let inner = &self.text[span.start as usize + 1..span.end as usize - 1];
                    if inner.trim().is_empty() { None } else { self.classes(inner, at) }
                }
                Some(JSXAttributeValue::ExpressionContainer(container)) => match container.expression.as_expression() {
                    Some(expression) => self.value(expression).flatten(),
                    None => None,
                },
                _ => None,
            };
            if let Some(value) = value {
                let intrinsic = matches!(&opening.name, JSXElementName::Identifier(identifier)
                    if identifier.name.starts_with(|c: char| c.is_ascii_lowercase()));
                if !intrinsic {
                    self.hold("component-class", self.source(opening.name.span()).to_string(), at);
                } else if spread {
                    self.hold("spread-props", self.source(opening.name.span()).to_string(), at);
                } else if taken {
                    self.hold("style-prop-taken", self.style_prop.to_string(), at);
                } else {
                    self.edits.push((attribute.span.start, attribute.span.end, format!("{}={{{value}}}", self.style_prop)));
                }
            }
        }
        walk::walk_jsx_opening_element(self, opening);
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let symbol = identifier.reference_id.get().and_then(|r| self.scoping.get_reference(r).symbol_id());
        if symbol.is_some_and(|s| self.cn.contains(&s)) {
            self.cn_seen += 1;
        }
    }
}

pub fn scan_file(file: &str, text: &str, style_prop: &str, theme: &Theme) -> Outcome {
    let mut out = Outcome::default();
    if !text.contains("className") {
        return out;
    }
    let Ok(source_type) = SourceType::from_path(file) else { return out };
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, source_type).parse();
    if parsed.fatal_error || !parsed.diagnostics.is_empty() {
        out.holds.push(Hold { kind: "parse-error", detail: file.to_string(), at: 0 });
        return out;
    }
    let program = &parsed.program;
    let semantic = SemanticBuilder::new().build(program).semantic;
    let scoping = semantic.scoping();
    let mut scan = Scan {
        text,
        style_prop,
        scoping,
        resolve: Resolve { theme, wind: false, hold: None },
        cn: FxHashSet::default(),
        joins: FxHashMap::default(),
        cn_seen: 0,
        cn_converted: 0,
        styles: Vec::new(),
        edits: Vec::new(),
        holds: Vec::new(),
    };
    let mut insert_at = program.directives.last().map_or(0, |d| d.span.end);
    let mut cn_imports: Vec<Span> = Vec::new();
    let mut plumeria = None;
    let mut leading = true;
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            leading = false;
            continue;
        };
        if leading {
            insert_at = declaration.span.end;
        }
        let source = declaration.source.value.as_str().unwrap_or_default();
        if source.starts_with("@plumeria/") {
            plumeria = Some((source.to_string(), declaration.span.start));
        }
        let specifiers = declaration.specifiers.iter().flatten().collect::<Vec<_>>();
        for specifier in &specifiers {
            let (imported, local) = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => (named.imported.name().to_string(), &named.local),
                ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => ("default".to_string(), &default.local),
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => continue,
            };
            let Some(symbol) = local.symbol_id.get() else { continue };
            if imported == "cn" && source == "cn" {
                scan.cn.insert(symbol);
                if specifiers.len() == 1 {
                    cn_imports.push(declaration.span);
                }
            } else if imported == "cn" || (source == "tailwind-merge" && matches!(imported.as_str(), "twMerge" | "twJoin")) {
                scan.joins.insert(symbol, "use-cn");
            } else if matches!(source, "clsx" | "classnames" | "clsx/lite") || matches!(imported.as_str(), "clsx" | "cx") {
                scan.joins.insert(symbol, "clsx");
            }
        }
    }

    scan.visit_program(program);
    if scan.edits.is_empty() && scan.holds.is_empty() {
        return out;
    }
    if let Some((source, at)) = plumeria {
        scan.hold("plumeria-import", source, at);
    }
    for name in ["css", "styles", "t"] {
        if scoping.symbol_names().any(|n| n == name) {
            scan.hold("binding-taken", name, 0);
        }
    }
    out.wind = scan.resolve.wind;
    out.holds = scan.holds;
    if !out.holds.is_empty() {
        return out;
    }

    let mut header = String::from("import * as css from '@plumeria/core';");
    if out.wind {
        header.push_str("\nimport * as t from '@plumeria/wind';");
    }
    let mut create = String::from("const styles = css.create({\n");
    for (key, _, body) in &scan.styles {
        create.push_str(&format!("  {key}: {body},\n"));
    }
    create.push_str("});");
    let mut edits = scan.edits;
    let mut inserted = if insert_at == 0 { format!("{header}\n\n{create}\n\n") } else { format!("\n{header}\n\n{create}") };
    if scan.cn_converted == scan.cn_seen {
        for span in cn_imports {
            let end = if text[span.end as usize..].starts_with('\n') { span.end + 1 } else { span.end };
            if insert_at == span.end {
                insert_at = span.start;
                inserted = format!("{header}\n\n{create}\n");
            }
            edits.push((span.start, end, String::new()));
        }
    }
    edits.push((insert_at, insert_at, inserted));
    edits.sort_by_key(|(start, end, _)| (*start, *end));
    out.rewritten = Some(apply(text, &edits));
    out
}

fn tailwind_config() -> Option<String> {
    let read = fs::read_dir(".").ok()?;
    read.filter_map(|e| e.ok()?.file_name().into_string().ok())
        .find(|name| name.starts_with("tailwind.config."))
}

pub fn run(options: &Options) -> ExitCode {
    if let Some(config) = tailwind_config() {
        eprintln!("✖ {config} sets the theme in JavaScript. Only a Tailwind CSS v4 theme written in CSS can be read.");
        return ExitCode::FAILURE;
    }
    let mut project = Vec::new();
    walk_files("", &mut project);
    let mut theme = Theme { overrides: Vec::new(), dark_redefined: false };
    for path in project.iter().filter(|p| extension(p) == "css") {
        if let Ok(css) = fs::read_to_string(path) {
            theme.read(&css);
        }
    }
    let sources: Vec<(String, String)> = project
        .iter()
        .filter(|p| SOURCES.contains(&extension(p)))
        .filter_map(|p| Some((p.clone(), fs::read_to_string(p).ok()?)))
        .collect();

    let mut converted = Vec::new();
    let mut held = Vec::new();
    let mut wind = false;
    for (file, text) in &sources {
        let outcome = scan_file(file, text, &options.style_prop, &theme);
        if let Some(rewritten) = outcome.rewritten {
            wind |= outcome.wind;
            converted.push((file, rewritten));
        } else if !outcome.holds.is_empty() {
            held.push((file, text, outcome.holds));
        }
    }
    if converted.is_empty() && held.is_empty() {
        println!("No Tailwind class found.");
        return ExitCode::SUCCESS;
    }
    for (file, _) in &converted {
        println!("  {file}");
    }
    if options.dry_run {
        println!("\n{} file(s) would be converted.\nRun without --dry-run to apply.", converted.len());
    } else {
        for (file, text) in &converted {
            if let Err(error) = fs::write(file, text) {
                eprintln!("✖ {file}: {error}");
                return ExitCode::FAILURE;
            }
        }
        println!("\n✔ converted {} file(s).", converted.len());
    }
    if wind {
        println!("\nThe styles read @plumeria/wind. Install it with `npm i -D @plumeria/wind`.");
    }
    if held.is_empty() {
        return ExitCode::SUCCESS;
    }
    println!("\nLeft in place — nothing was written for these files:\n");
    for (file, text, holds) in &held {
        println!("{file}");
        for hold in holds {
            let (line, column) = position(text, hold.at);
            println!("  {line}:{column}  {}  {}", hold.kind, hold.detail);
        }
    }
    ExitCode::FAILURE
}

fn member(group: &str, key: &str) -> String {
    let identifier = key.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    let integer = !key.is_empty()
        && key.chars().all(|c| c.is_ascii_digit())
        && (key == "0" || !key.starts_with('0'));
    if identifier {
        format!("t.{group}.{key}")
    } else if integer {
        format!("t.{group}[{key}]")
    } else {
        format!("t.{group}[{}]", quote(key))
    }
}
