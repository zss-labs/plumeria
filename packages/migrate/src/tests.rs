use rustc_hash::FxHashMap;

use crate::consumer::{mentions, scan, Sheet};
use crate::resolve::Paths;
use crate::stylesheet::{convert, Converted};
use crate::{apply, target_of};

fn kinds(converted: &Converted) -> Vec<&'static str> {
    converted.reports.iter().map(|r| r.kind).collect()
}

fn sheet(path: &str, css: &str) -> Sheet {
    Sheet { path: path.to_string(), target: target_of(path), converted: convert(css) }
}

struct Run {
    output: String,
    holds: Vec<&'static str>,
}

fn run_with(code: &str, sheets: &[Sheet], paths: Option<&Paths>) -> Run {
    let exists = |p: &str| sheets.iter().any(|s| s.path == p);
    let outcome = scan("src/App.tsx", code, sheets, paths, &exists, "sx");
    Run {
        output: apply(code, &outcome.edits),
        holds: outcome.holds.iter().filter(|h| h.blocking).map(|h| h.kind).collect(),
    }
}

fn run(code: &str, css: &str) -> Run {
    run_with(code, &[sheet("src/Card.module.css", css)], None)
}

fn converted(code: &str, css: &str) -> String {
    let result = run(code, css);
    assert!(result.holds.is_empty(), "unexpected holds {:?}", result.holds);
    result.output
}

const IMPORT: &str = "import s from './Card.module.css';\n";
const HEAD: &str = "import '@plumeria/core';\nimport { styles } from './Card.styles';\n";

#[test]
fn converts_a_flat_class() {
    let out = convert(".card { padding: 16px; color: red }");
    assert!(out.code.contains("card: {"));
    assert!(out.code.contains("padding: 16,"));
    assert!(out.code.contains("color: 'red',"));
    assert_eq!(out.names.get("card").map(String::as_str), Some("card"));
    assert!(out.reports.is_empty());
}

#[test]
fn writes_keyframes_as_a_binding() {
    let out = convert(
        "@keyframes pulse-soft { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
         .badge { animation-name: pulse-soft; animation-duration: 2s }",
    );
    assert!(out.code.contains("const pulseSoft = css.keyframes({"));
    assert!(out.code.contains("'0%, 100%': {"));
    assert!(out.code.contains("animationName: pulseSoft,"));
    assert!(out.code.contains("animationDuration: '2s',"));
    assert!(out.reports.is_empty());
}

#[test]
fn splits_an_animation_shorthand() {
    let out = convert(
        "@keyframes spin { from { rotate: 0deg } to { rotate: 360deg } }
         .icon { animation: spin 1s 200ms linear infinite both }",
    );
    for expected in [
        "animationName: spin,",
        "animationDuration: '1s',",
        "animationDelay: '200ms',",
        "animationTimingFunction: 'linear',",
        "animationIterationCount: 'infinite',",
        "animationFillMode: 'both',",
    ] {
        assert!(out.code.contains(expected), "{expected}\n{}", out.code);
    }
}

#[test]
fn leaves_an_animation_naming_nothing_local() {
    let out = convert(".icon { animation: fade-in 1s; animation-name: fade-out }");
    assert!(out.code.contains("animation: 'fade-in 1s',"));
    assert!(out.code.contains("animationName: 'fade-out',"));
    assert!(out.reports.is_empty());
}

#[test]
fn reports_an_animation_list_it_cannot_split() {
    let out = convert("@keyframes spin { from { rotate: 0deg } } .icon { animation: spin 1s, fade-in 2s }");
    assert!(kinds(&out).contains(&"unsupported-animation"));
    assert!(out.blocked());
}

#[test]
fn notes_unused_keyframes_without_holding() {
    let out = convert("@keyframes spin { from { rotate: 0deg } } .icon { color: red }");
    assert!(!out.code.contains("css.keyframes"));
    assert_eq!(kinds(&out), ["unused-keyframes"]);
    assert!(!out.blocked());
}

#[test]
fn normalises_names_and_values() {
    let out = convert(".card-title { font-size: 12px; --card-gap: 2px; -webkit-line-clamp: 2; margin: -1.5px; opacity: .5 }");
    for expected in ["cardTitle: {", "fontSize: 12,", "'--card-gap': 2,", "WebkitLineClamp: 2,", "margin: -1.5,", "opacity: 0.5,"] {
        assert!(out.code.contains(expected), "{expected}\n{}", out.code);
    }
    assert_eq!(out.names.get("card-title").map(String::as_str), Some("cardTitle"));
}

#[test]
fn escapes_quotes_in_values() {
    let out = convert(".a::before { content: 'it\\'s' }");
    assert!(out.code.contains(r"content: '\'it\\\'s\'',"), "{}", out.code);
}

#[test]
fn nests_pseudo_classes_and_at_rules() {
    let out = convert(".card:hover { color: teal } .card:hover { padding: 2px } @media (min-width: 600px) { .card { padding: 24px } }");
    assert_eq!(out.code.matches("':hover': {").count(), 1);
    assert!(out.code.contains("'@media (min-width: 600px)': {"));
}

#[test]
fn pairs_descendants_into_marker_and_extended() {
    let out = convert(".card .a { color: red } .card .b { color: blue }");
    assert_eq!(out.code.matches("...css.marker('card', ':defined'),").count(), 1);
    assert!(out.code.contains("[css.extended('card', ':defined')]: {"));
    let hover = convert(".card:hover .title { color: red }");
    assert!(hover.code.contains("...css.marker('card', ':hover'),"));
}

#[test]
fn gates_a_marker_chain() {
    let out = convert(".card .body .note { color: red }");
    assert!(out.reports.is_empty());
    assert!(out.code.contains("...css.marker('body', ':defined'),"));
    assert!(out.code.contains("[css.extended('body', ':defined')]: {"));
}

#[test]
fn gives_tags_their_own_keys() {
    let out = convert(".card h2 { color: red } .card > h2 { font-weight: bold }");
    let keys: Vec<_> = out.tags.iter().map(|t| (t.key.as_str(), t.direct)).collect();
    assert_eq!(keys, [("cardH2", false), ("cardChildH2", true)]);
    assert!(out.reports.is_empty());
}

#[test]
fn refuses_what_it_cannot_carry() {
    for (css, kind) in [
        (".item + .item { margin: 1px }", "sibling-combinator"),
        (".card ~ h2 { margin: 1px }", "sibling-combinator"),
        ("h2 { color: red }", "unsupported-selector"),
        ("#card { color: red }", "unsupported-selector"),
        (":hover { color: red }", "unsupported-selector"),
        ("div.card { color: red }", "unsupported-selector"),
        (":global() .card { color: red }", "global"),
        (".card { color: red; @media (width > 1px) { color: blue } }", "nested-rule"),
        (".card { color: red; &:hover { color: blue } }", "nested-rule"),
        (".card { composes: base from './shared.css' }", "composes-external"),
        ("@font-face { font-family: X }", "unsupported-at-rule"),
        (".card-title { color: red } .cardTitle { color: blue }", "key-collision"),
        (".card h2 { color: red } .card-h2 { color: blue }", "key-collision"),
        (".a { color: red } .b { color: blue } .a { padding: 1px }", "split-order"),
        ("@media print { .a { color: black } } .a { color: blue }", "rank-order"),
        (".a { padding-top: 1px; padding: 2px }", "rank-order"),
    ] {
        let out = convert(css);
        assert!(kinds(&out).contains(&kind), "{css}: {:?}", kinds(&out));
        assert!(out.blocked(), "{css}");
    }
}

#[test]
fn accepts_what_settles() {
    for css in [
        ".a { color: red } .b { margin: 1px } .a { padding: 1px }",
        ".a { color: red } @media print { .b { color: blue } } .a { padding: 1px }",
        ".a { color: blue } @media print { .a { color: black } }",
        "@media print { .a { color: black } } .b { color: blue }",
        ".card { padding: 1px } .card.active { color: red }",
    ] {
        let out = convert(css);
        assert!(out.reports.is_empty(), "{css}: {:?}", kinds(&out));
    }
}

#[test]
fn keeps_a_compound_class_off_names_without_its_own_rule() {
    let out = convert(".card.active { color: red }");
    assert!(out.names.contains_key("active"));
    assert!(!out.names.contains_key("card"));
}

#[test]
fn wraps_attributes_and_global_ancestors() {
    let out = convert(".card[data-open='true'] { display: block } :global(.dark) .card { background: black }");
    assert!(out.reports.is_empty(), "{:?}", kinds(&out));
    assert!(out.code.contains("':is([data-open=\"true\"])': {"), "{}", out.code);
    assert!(out.code.contains("':is(.dark *)': {"), "{}", out.code);
}

#[test]
fn reads_undeclared_custom_properties_as_a_function_style() {
    let out = convert(".size { width: var(--styles-size-width); color: var(--styles-size-tone) }");
    assert_eq!(out.functions.get("size").unwrap(), &["--styles-size-width", "--styles-size-tone"]);
    assert!(out.code.contains("size: (width: string | number, tone: string | number) => ({"), "{}", out.code);
    assert!(out.code.contains("    width,\n"));
    assert!(out.code.contains("color: tone,"));
    let declared = convert(".root { --styles-root-gap: 4px } .size { gap: var(--styles-root-gap); color: var(--x5w827vw-size-tone) }");
    assert!(declared.functions.is_empty());
}

#[test]
fn records_order_and_writes() {
    let out = convert(".a { color: red } .b { color: blue } .c { color: teal }");
    let order: FxHashMap<&str, usize> = out.order.iter().map(|(k, v)| (k.as_str(), *v)).collect();
    assert_eq!((order["a"], order["b"], order["c"]), (0, 1, 2));
    let writes = convert("@media print { .a { color: black } } .b:hover { padding: 1px }");
    let a = &writes.writes["a"][0];
    let b = &writes.writes["b"][0];
    assert_eq!((a.property.as_str(), a.suffix.as_str(), a.place), ("color", "", 0));
    assert_eq!((b.property.as_str(), b.suffix.as_str(), b.place), ("padding", ":hover", 1));
    assert!(a.rank > crate::cascade::rank("color", false));
}

#[test]
fn rewrites_a_single_class() {
    let out = converted(&format!("{IMPORT}<div className={{s.card}} />;"), ".card { color: red }");
    assert_eq!(out, format!("{HEAD}<div sx={{styles.card}} />;"));
}

#[test]
fn reads_a_string_key_through_its_camel_key() {
    let out = converted(&format!("{IMPORT}<div className={{s['card-title']}} />;"), ".card-title { color: red }");
    assert!(out.ends_with("<div sx={styles.cardTitle} />;"), "{out}");
}

#[test]
fn keeps_an_existing_core_import() {
    let code = format!("import '@plumeria/core';\n{IMPORT}<div className={{s.card}} />;");
    let out = converted(&code, ".card { color: red }");
    assert_eq!(out, format!("import '@plumeria/core';\nimport {{ styles }} from './Card.styles';\n<div sx={{styles.card}} />;"));
}

#[test]
fn expands_composes_in_stylesheet_order() {
    let css = ".base { font-size: 12px } .card { composes: base; padding: 1px }";
    let out = converted(&format!("{IMPORT}<div className={{s.card}} />;"), css);
    assert!(out.ends_with("<div sx={[styles.base, styles.card]} />;"), "{out}");
}

#[test]
fn writes_class_lists_in_stylesheet_order() {
    let css = ".a { color: red } .b { color: blue }";
    for code in [
        "<div className={[s.b, s.a].join(' ')} />;",
        "<div className={`${s.b} ${s.a}`} />;",
    ] {
        let out = converted(&format!("{IMPORT}{code}"), css);
        assert!(out.ends_with("<div sx={[styles.a, styles.b]} />;"), "{out}");
    }
}

#[test]
fn keeps_conditions_in_place() {
    let css = ".a { color: red } .b { margin: 1px }";
    let out = converted(&format!("{IMPORT}<div className={{[s.a, on && s.b].filter(Boolean).join(' ')}} />;"), css);
    assert!(out.ends_with("<div sx={[styles.a, on && styles.b]} />;"), "{out}");
    let lone = converted(&format!("{IMPORT}<div className={{(on && s.b) || undefined}} />;"), css);
    assert!(lone.ends_with("<div sx={on && styles.b} />;"), "{lone}");
    let ternary = converted(&format!("{IMPORT}<div className={{on ? s.a : s.b}} />;"), css);
    assert!(ternary.ends_with("<div sx={on ? styles.a : styles.b} />;"), "{ternary}");
}

#[test]
fn holds_other_class_names_beside_a_style() {
    let css = ".base { color: red }";
    for code in [
        "<div className={[props.className, s.base].filter(Boolean).join(' ')} />;",
        "<div className={`${s.base} active`} />;",
    ] {
        let result = run(&format!("{IMPORT}{code}"), css);
        assert_eq!(result.holds, ["class-name-mixed"], "{code}");
    }
}

#[test]
fn puts_a_component_class_on_the_style_prop() {
    let out = converted(&format!("{IMPORT}<Chevron className={{s.card}} />;"), ".card { color: red }");
    assert!(out.ends_with("<Chevron sx={styles.card} />;"), "{out}");
}

#[test]
fn reads_a_value_back_through_css_use() {
    let out = converted(&format!("{IMPORT}const c = s.card;"), ".card { color: red }");
    assert_eq!(out, "import * as css from '@plumeria/core';\nimport { styles } from './Card.styles';\nconst c = css.use(styles.card);");
}

#[test]
fn leaves_a_shadowing_binding_alone() {
    let code = format!("{IMPORT}function F() {{ const s = {{ card: 1 }}; return s.card; }}\n<div className={{s.card}} />;");
    let out = converted(&code, ".card { color: red }");
    assert!(out.contains("const s = { card: 1 }; return s.card;"), "{out}");
    assert!(out.ends_with("<div sx={styles.card} />;"), "{out}");
}

#[test]
fn keeps_names_when_two_stylesheets_meet() {
    let sheets = [sheet("src/A.module.css", ".x { color: red }"), sheet("src/B.module.css", ".y { margin: 1px }")];
    let code = "import a from './A.module.css';\nimport b from './B.module.css';\n<div className={`${a.x} ${b.y}`} />;";
    let result = run_with(code, &sheets, None);
    assert!(result.holds.is_empty(), "{:?}", result.holds);
    assert_eq!(
        result.output,
        "import '@plumeria/core';\nimport { styles as a } from './A.styles';\nimport { styles as b } from './B.styles';\n<div sx={[a.x, b.y]} />;"
    );
}

#[test]
fn calls_a_function_style_with_the_inline_variables() {
    let css = ".size { width: var(--styles-size-width) }";
    let code = format!("{IMPORT}<div className={{s.size}} style={{{{ ['--styles-size-width' as string]: typeof w === 'number' ? `${{w}}px` : w }}}} />;");
    let out = converted(&code, css);
    assert!(out.ends_with("<div sx={styles.size(w)} />;"), "{out}");
    let kept = converted(&format!("{IMPORT}<div className={{s.size}} style={{{{ '--styles-size-width': w, color }}}} />;"), css);
    assert!(kept.ends_with("<div sx={styles.size(w)} style={{ color }} />;"), "{kept}");
}

#[test]
fn carries_tag_rules_onto_visible_markup() {
    let css = ".card { padding: 1px } .card h2 { font-size: 20px } .card > p { margin: 0 }";
    let code = format!("{IMPORT}<div className={{s.card}}><h2>a</h2><section><h2>b</h2><p>c</p></section><p>d</p></div>;");
    let out = converted(&code, css);
    assert!(out.contains("<h2 sx={styles.cardH2}>a</h2>"), "{out}");
    assert!(out.contains("<h2 sx={styles.cardH2}>b</h2><p>c</p>"), "{out}");
    assert!(out.contains("<p sx={styles.cardChildP}>d</p>"), "{out}");
}

#[test]
fn writes_a_tag_rule_into_an_existing_style_prop() {
    let css = ".card { padding: 1px } .card h2 { font-size: 20px }";
    for (held, expected) in [
        ("{[]}", "{[styles.cardH2]}"),
        ("{own}", "{[styles.cardH2, own]}"),
        ("{[variants[i]]}", "{[styles.cardH2, variants[i]]}"),
    ] {
        let out = converted(&format!("{IMPORT}<div className={{s.card}}><h2 sx={held}>t</h2></div>;"), css);
        assert!(out.contains(&format!("<h2 sx={expected}>t</h2>")), "{out}");
    }
}

#[test]
fn holds_what_it_cannot_answer_for() {
    let css = ".card { color: red } .card h2 { margin: 0 }";
    for (code, kind) in [
        ("<div className={s[key]} />;", "dynamic-access"),
        ("const all = s;", "dynamic-access"),
        ("<div className={s.unknown} />;", "missing"),
        ("<div className={on && s.card}><h2 /></div>;", "conditional-tag"),
        ("<div className={s.card} sx={base} />;", "style-prop-present"),
    ] {
        let result = run(&format!("{IMPORT}{code}"), css);
        assert!(result.holds.contains(&kind), "{code}: {:?}", result.holds);
    }
}

#[test]
fn holds_imports_it_cannot_rewrite() {
    let css = ".card { color: red }";
    for code in [
        "import raw from './Card.module.css?raw';",
        "import { card } from './Card.module.css';",
        "import './Card.module.css';",
        "export { default } from './Card.module.css';",
        "const s = require('./Card.module.css');",
        "const s = import('./Card.module.css');",
    ] {
        let result = run(code, css);
        assert!(!result.holds.is_empty(), "{code}");
    }
    let twice = converted("import s from '../src/Card.module.css';\nimport t from './Card.module.css';\n<><a className={s.card} /><b className={t.card} /></>;", css);
    assert!(twice.contains("import { styles as s } from './Card.styles';\nimport { styles as t } from './Card.styles';"), "{twice}");
    assert!(twice.ends_with("<><a sx={s.card} /><b sx={t.card} /></>;"), "{twice}");
}

#[test]
fn holds_an_unsettled_pair() {
    let css = "@media print { .a { color: black } } .b { color: blue }";
    let result = run(&format!("{IMPORT}<div className={{[s.a, s.b].join(' ')}} />;"), css);
    assert!(result.holds.contains(&"cascade"), "{:?}", result.holds);
    let settled = run(&format!("{IMPORT}<div className={{s.a}} />;"), css);
    assert!(settled.holds.is_empty());
}

fn tsconfig(files: &[(&str, &str)]) -> Paths {
    let files: FxHashMap<String, String> = files.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    Paths::load(|path| files.get(path).cloned()).unwrap()
}

#[test]
fn resolves_an_alias_through_extends() {
    let paths = tsconfig(&[
        ("tsconfig.json", r#"{ "extends": "./tsconfig.base.json", "compilerOptions": { "paths": { "@theme": ["Card.module.css"] } } }"#),
        ("tsconfig.base.json", r#"{ // base
            "compilerOptions": { "baseUrl": "./src", } }"#),
    ]);
    let sheets = [sheet("src/Card.module.css", ".card { color: red }")];
    assert!(mentions(&sheets[0], Some(&paths), "import s from '@theme';"));
    let result = run_with("import s from '@theme';\n<div className={s.card} />;", &sheets, Some(&paths));
    assert!(result.holds.is_empty(), "{:?}", result.holds);
    assert!(result.output.contains("import { styles } from './Card.styles';"), "{}", result.output);
}

#[test]
fn resolves_paths_defined_in_a_parent() {
    let paths = tsconfig(&[
        ("tsconfig.json", r#"{ "extends": "./config/base" }"#),
        ("config/base.json", r#"{ "compilerOptions": { "paths": { "@/*": ["../src/*"] } } }"#),
    ]);
    let sheets = [sheet("src/ui/Card.module.css", ".card { color: red }")];
    let exists = |p: &str| p == "src/ui/Card.module.css";
    let outcome = scan("src/App.tsx", "import s from '@/ui/Card.module.css';\n<div className={s.card} />;", &sheets, Some(&paths), &exists, "sx");
    assert!(outcome.holds.is_empty());
    let out = apply("import s from '@/ui/Card.module.css';\n<div className={s.card} />;", &outcome.edits);
    assert!(out.contains("from './ui/Card.styles';"), "{out}");
}

type StylexRun = (Vec<(String, String)>, Vec<(String, Vec<&'static str>)>);

fn stylex(files: &[(&str, &str)]) -> StylexRun {
    let sources: Vec<(String, String)> = files.iter().map(|(f, t)| (f.to_string(), t.to_string())).collect();
    let plan = crate::stylex::plan(&sources, None, "sx");
    let rewrites = plan.rewrites.iter().map(|(i, t)| (sources[*i].0.clone(), t.clone())).collect();
    let held = plan.held.iter().map(|(i, h)| (sources[*i].0.clone(), h.iter().map(|h| h.kind).collect())).collect();
    (rewrites, held)
}

fn stylex_one(code: &str) -> String {
    let (rewrites, held) = stylex(&[("src/Card.tsx", code)]);
    assert!(held.is_empty(), "{held:?}");
    rewrites[0].1.clone()
}

fn stylex_holds(code: &str) -> Vec<&'static str> {
    let (_, held) = stylex(&[("src/Card.tsx", code)]);
    held.into_iter().flat_map(|(_, kinds)| kinds).collect()
}

const STYLEX: &str = "import * as stylex from '@stylexjs/stylex';\n";

#[test]
fn stylex_moves_conditions_out_of_values() {
    let code = format!(
        "{STYLEX}
const styles = stylex.create({{
  base: {{
    color: {{ default: 'black', ':hover': 'blue', '@media (max-width: 600px)': 'red' }},
    padding: 8,
  }},
}});

export const Card = () => <div {{...stylex.props(styles.base)}} />;
"
    );
    let expected = "import * as css from '@plumeria/core';

const styles = css.create({
  base: {
    color: 'black',
    padding: 8,
    ':hover': {
      color: 'blue',
    },
    '@media (max-width: 600px)': {
      color: 'red',
    },
  },
});

export const Card = () => <div sx={styles.base} />;
";
    assert_eq!(stylex_one(&code), expected);
}

#[test]
fn stylex_puts_a_pseudo_under_its_at_rule() {
    let code = format!(
        "{STYLEX}const s = stylex.create({{ a: {{ color: {{ default: 'a', ':hover': {{ default: 'b', '@media (x)': 'c' }} }} }} }});\n<div {{...stylex.props(s.a)}} />;"
    );
    let out = stylex_one(&code);
    assert!(out.contains("':hover': {\n      color: 'b',\n    },\n    '@media (x)': {\n      ':hover': {\n        color: 'c',\n      },\n    },"), "{out}");
}

#[test]
fn stylex_fills_the_states_a_later_style_replaces() {
    let code = format!(
        "{STYLEX}const s = stylex.create({{\n  a: {{ color: {{ default: 'black', ':hover': 'blue' }} }},\n  b: {{ color: 'red' }},\n}});\n<div {{...stylex.props(s.a, s.b)}} />;"
    );
    let out = stylex_one(&code);
    assert!(out.contains("  b: {\n    color: 'red',\n    ':hover': {\n      color: 'red',\n    },\n  },"), "{out}");
    assert!(out.ends_with("<div sx={[s.a, s.b]} />;"), "{out}");
}

#[test]
fn stylex_leaves_a_style_that_never_follows_as_written() {
    let code = format!(
        "{STYLEX}const s = stylex.create({{\n  a: {{ color: {{ default: 'black', ':hover': 'blue' }} }},\n  b: {{ color: 'red' }},\n}});\n<div {{...stylex.props(s.b)}} />;\n<p {{...stylex.props(s.a)}} />;"
    );
    let out = stylex_one(&code);
    assert!(out.contains("  b: {\n    color: 'red',\n  },"), "{out}");
}

#[test]
fn stylex_holds_what_plumeria_cannot_state() {
    let null = format!(
        "{STYLEX}const s = stylex.create({{ a: {{ color: 'black' }}, b: {{ color: {{ default: null, ':hover': 'green' }} }} }});\n<div {{...stylex.props(s.a, s.b)}} />;"
    );
    assert_eq!(stylex_holds(&null), ["null-value"]);
    let overlap = format!(
        "{STYLEX}const s = stylex.create({{ a: {{ color: {{ default: 'a', ':hover': 'b', ':focus': 'c' }} }} }});\n<div {{...stylex.props(s.a)}} />;"
    );
    assert_eq!(stylex_holds(&overlap), ["overlapping-states"]);
    let beside = format!(
        "{STYLEX}const s = stylex.create({{ a: {{ color: 'a' }} }});\n<div className=\"x\" {{...stylex.props(s.a)}} />;"
    );
    assert_eq!(stylex_holds(&beside), ["props-beside-attribute"]);
    let theme = format!("{STYLEX}export const dark = stylex.createTheme(vars, {{ color: 'white' }});");
    assert_eq!(stylex_holds(&theme), ["unsupported-api"]);
    let crossed = format!(
        "{STYLEX}const s = stylex.create({{ a: {{ color: {{ default: 'a', '@media (min-width: 600px)': 'b', '@media (orientation: landscape)': 'c' }} }} }});\n<div {{...stylex.props(s.a)}} />;"
    );
    assert_eq!(stylex_holds(&crossed), ["media-order", "media-order"]);
}

#[test]
fn stylex_keeps_media_queries_in_written_order() {
    let narrow_first = format!(
        "{STYLEX}const s = stylex.create({{ a: {{ color: {{ default: 'a', '@media (min-width: 900px)': 'c', '@media (min-width: 600px)': 'b' }} }} }});\n<div {{...stylex.props(s.a)}} />;"
    );
    let out = stylex_one(&narrow_first);
    assert!(out.contains("'@media (min-width: 900px)': {\n      color: 'b',\n    },"), "{out}");
    let broad_first = format!(
        "{STYLEX}const s = stylex.create({{ a: {{ color: {{ default: 'a', '@media (min-width: 600px)': 'b', '@media (min-width: 900px)': 'c' }} }} }});\n<div {{...stylex.props(s.a)}} />;"
    );
    let out = stylex_one(&broad_first);
    assert!(out.contains("'@media (min-width: 900px)': {\n      color: 'c',\n    },"), "{out}");
}

#[test]
fn stylex_reports_the_requires_stylex_compiles() {
    for code in [
        "const stylex = require('@stylexjs/stylex');\nconst s = stylex.create({ a: { color: 'a' } });\n",
        "const { create, props } = require('@stylexjs/stylex');\nconst s = create({ a: { color: 'a' } });\n",
    ] {
        assert_eq!(stylex_holds(code), ["require"], "{code}");
    }
    let tokens = "const stylex = require('@stylexjs/stylex');\nmodule.exports = stylex.create({ a: { color: 'a' } });\n";
    let card = format!("{STYLEX}import t from './tokens';\n<div {{...stylex.props(t.a)}} />;");
    let (rewrites, held) = stylex(&[("src/tokens.js", tokens), ("src/Card.tsx", &card)]);
    assert!(rewrites.is_empty(), "{rewrites:?}");
    assert_eq!(
        held,
        [
            ("src/tokens.js".to_string(), vec!["require"]),
            ("src/Card.tsx".to_string(), vec!["linked-to-held"]),
        ]
    );
}

#[test]
fn stylex_turns_flat_constants_into_create_static() {
    let tokens = "import * as stylex from '@stylexjs/stylex';\nexport const space = stylex.defineConsts({ gap: 8, brand: 'red' });\n";
    let card = "import * as stylex from '@stylexjs/stylex';\nimport { space } from './tokens.stylex';\nconst s = stylex.create({ a: { gap: space.gap, color: space.brand } });\nexport const Card = () => <div {...stylex.props(s.a)} />;\n";
    let (rewrites, held) = stylex(&[("src/tokens.stylex.ts", tokens), ("src/Card.tsx", card)]);
    assert!(held.is_empty(), "{held:?}");
    let out = |file: &str| rewrites.iter().find(|(f, _)| f == file).unwrap().1.clone();
    assert_eq!(
        out("src/tokens.stylex.ts"),
        "import * as css from '@plumeria/core';\nexport const space = css.createStatic({ gap: 8, brand: 'red' });\n"
    );
    let card = out("src/Card.tsx");
    assert!(card.contains("import { space } from './tokens.stylex';"), "{card}");
    assert!(card.contains("const s = css.create({\n  a: {\n    gap: space.gap,\n    color: space.brand,\n  },\n});"), "{card}");
}

#[test]
fn stylex_reports_constants_that_are_not_flat_literals() {
    for code in [
        "export const c = stylex.defineConsts({ gap: { default: 8 } });",
        "export const c = stylex.defineConsts({ gap: -8 });",
        "export const c = stylex.defineConsts({ ...base });",
        "export function f() { return stylex.defineConsts({ gap: 8 }); }",
    ] {
        assert_eq!(stylex_holds(&format!("{STYLEX}{code}")), ["unsupported-consts"], "{code}");
    }
}

#[test]
fn stylex_renames_view_transition_classes_and_position_tries() {
    let code = format!(
        "{STYLEX}const fadeIn = stylex.keyframes({{ from: {{ opacity: 0 }}, to: {{ opacity: 1 }} }});
export const cross = stylex.viewTransitionClass({{ old: {{ animationName: fadeIn, animationDuration: '1.2s' }} }});
const above = stylex.positionTry({{ positionArea: 'top', marginBottom: 8 }});
const s = stylex.create({{ tip: {{ positionTryFallbacks: `${{above}}, flip-inline` }} }});
export const Tip = () => <div {{...stylex.props(s.tip)}} />;
"
    );
    let out = stylex_one(&code);
    assert!(out.starts_with("import * as css from '@plumeria/core';\nconst fadeIn = css.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });\nexport const cross = css.viewTransitionClass({ old: { animationName: fadeIn, animationDuration: '1.2s' } });\nconst above = css.positionTry({ positionArea: 'top', marginBottom: 8 });\n"), "{out}");
    assert!(out.contains("positionTryFallbacks: `${above}, flip-inline`,"), "{out}");
}

#[test]
fn stylex_reports_view_transitions_and_position_tries_it_cannot_rename() {
    for (code, kind) in [
        ("export const v = stylex.viewTransitionClass({ wrapper: { opacity: 0 } });", "unsupported-view-transition"),
        ("export const v = stylex.viewTransitionClass({ old: { opacity: { default: 0, '@media (x)': 1 } } });", "unsupported-view-transition"),
        ("const p = stylex.positionTry({ top: { default: 0, ':hover': 4 } });", "unsupported-position-try"),
        ("function f() { return stylex.positionTry({ top: 0 }); }", "unsupported-position-try"),
        ("const p = stylex.positionTry({ top: getGap() + 1 });", "unsupported-position-try"),
        ("const p = stylex.positionTry({ top: `${getGap()}px` });", "unsupported-position-try"),
        ("const p = stylex.positionTry({ top: gap?.small });", "unsupported-position-try"),
    ] {
        assert_eq!(stylex_holds(&format!("{STYLEX}{code}")), [kind], "{code}");
    }
}

#[test]
fn stylex_converts_only_values_it_can_read_statically() {
    let code = format!(
        "{STYLEX}const s = stylex.create({{ a: {{ marginTop: -4, gap: space.gap, width: `${{size}}px`, color: c }} }});\n<div {{...stylex.props(s.a)}} />;"
    );
    let out = stylex_one(&code);
    assert!(out.contains("    marginTop: -4,\n    gap: space.gap,\n    width: `${size}px`,\n    color: c,\n"), "{out}");
    for value in ["pick() + ''", "`${pick()}px`", "dark ? 'a' : 'b'", "theme?.color", "a + b"] {
        let code = format!("{STYLEX}const s = stylex.create({{ a: {{ color: {value} }} }});\n<div {{...stylex.props(s.a)}} />;");
        assert_eq!(stylex_holds(&code), ["dynamic-value"], "{value}");
    }
}

#[test]
fn stylex_declares_the_compound_of_equal_states() {
    let code = format!(
        "{STYLEX}const s = stylex.create({{ a: {{ color: {{ default: 'a', ':hover': 'b', ':focus': 'b' }} }} }});\n<div {{...stylex.props(s.a)}} />;"
    );
    let out = stylex_one(&code);
    assert!(out.contains("':focus:hover': {\n      color: 'b',\n    },"), "{out}");
}

#[test]
fn stylex_turns_a_style_prop_type_into_css_style() {
    let code = "import * as stylex from '@stylexjs/stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
const styles = stylex.create({ base: { color: 'black' } });
export const Button = ({ xstyle }: { xstyle?: StyleXStyles }) => <button {...stylex.props(styles.base, xstyle)} />;
";
    let expected = "import * as css from '@plumeria/core';
const styles = css.create({
  base: {
    color: 'black',
  },
});
export const Button = ({ xstyle }: { xstyle?: css.Style }) => <button sx={[styles.base, xstyle]} />;
";
    assert_eq!(stylex_one(code), expected);
}

#[test]
fn stylex_holds_the_files_linked_to_a_held_one() {
    let tokens = "import * as stylex from '@stylexjs/stylex';\nexport const colors = stylex.defineVars({ primary: 'blue' });\n";
    let button = "import * as stylex from '@stylexjs/stylex';\nimport { colors } from './tokens.stylex';\nconst s = stylex.create({ a: { color: colors.primary } });\nexport const B = () => <div {...stylex.props(s.a)} />;\n";
    let (rewrites, held) = stylex(&[("src/tokens.stylex.ts", tokens), ("src/Button.tsx", button)]);
    assert!(rewrites.is_empty(), "{rewrites:?}");
    assert_eq!(
        held,
        [
            ("src/tokens.stylex.ts".to_string(), vec!["unsupported-api"]),
            ("src/Button.tsx".to_string(), vec!["linked-to-held"]),
        ]
    );
}

#[test]
fn stylex_gives_a_file_that_carries_styles_the_core_import() {
    let button = "import * as stylex from '@stylexjs/stylex';\nexport const styles = stylex.create({ base: { color: 'black' } });\n";
    let app = "'use client';\nimport { styles } from './Button';\nexport const App = () => <Button xstyle={styles.base} />;\n";
    let (rewrites, held) = stylex(&[("src/Button.tsx", button), ("src/App.tsx", app)]);
    assert!(held.is_empty(), "{held:?}");
    let app = &rewrites.iter().find(|(f, _)| f == "src/App.tsx").unwrap().1;
    assert!(app.starts_with("'use client';\nimport '@plumeria/core';\nimport { styles }"), "{app}");
}

fn tailwind_with(code: &str, css: &str) -> crate::tailwind::Outcome {
    let mut theme = crate::tailwind::Theme::default();
    theme.read(css);
    crate::tailwind::scan_file("src/App.tsx", code, "sx", &theme)
}

fn tailwind_one(code: &str) -> String {
    let outcome = tailwind_with(code, "");
    assert!(outcome.holds.is_empty(), "{:?}", outcome.holds);
    outcome.rewritten.unwrap()
}

fn tailwind_holds(code: &str, css: &str) -> Vec<&'static str> {
    tailwind_with(code, css).holds.iter().map(|h| h.kind).collect()
}

#[test]
fn tailwind_names_the_key_by_the_class_hash() {
    let code = "export const A = () => <div className=\"flex p-4 md:p-8 hover:bg-blue-500\" />;\n";
    let key = crate::tailwind::class_hash(&["flex", "p-4", "md:p-8", "hover:bg-blue-500"]);
    let expected = format!(
        "import * as css from '@plumeria/core';
import * as t from '@plumeria/wind';

const styles = css.create({{
  {key}: {{
    display: 'flex',
    padding: t.spacing[4],
    ':hover': {{
      backgroundColor: t.blue[500],
    }},
    [`@media (width >= ${{t.breakpoint.md}})`]: {{
      padding: t.spacing[8],
    }},
  }},
}});

export const A = () => <div sx={{styles.{key}}} />;
"
    );
    assert_eq!(tailwind_one(code), expected);
    assert_eq!(key, crate::tailwind::class_hash(&["hover:bg-blue-500", "md:p-8", "flex", "p-4", "flex"]));
    assert!(key.starts_with("t_") && key.len() == 9, "{key}");
}

#[test]
fn tailwind_turns_cn_into_a_right_wins_array() {
    let code = "import { cn } from 'cn';\n\nexport const A = ({ active }) => <p className={cn('text-sm', active && 'text-white')} />;\n";
    let out = tailwind_one(code);
    let sm = crate::tailwind::class_hash(&["text-sm"]);
    let white = crate::tailwind::class_hash(&["text-white"]);
    assert!(!out.contains("from 'cn'"), "{out}");
    assert!(out.contains(&format!("sx={{[styles.{sm}, active && styles.{white}]}}")), "{out}");
    assert!(out.contains("fontSize: t.text.sm,\n    lineHeight: t.textLineHeight.sm,"), "{out}");
    assert!(out.contains("color: t.color.white,"), "{out}");
}

#[test]
fn tailwind_keeps_a_nested_condition_grouped() {
    let out = tailwind_one("import { cn } from 'cn';\n<p className={cn(a && (b ? 'flex' : 'grid'))} />;\n");
    let flex = crate::tailwind::class_hash(&["flex"]);
    let grid = crate::tailwind::class_hash(&["grid"]);
    assert!(out.contains(&format!("sx={{a && (b ? styles.{flex} : styles.{grid})}}")), "{out}");
}

#[test]
fn tailwind_declares_the_styles_before_a_later_import() {
    let out = tailwind_one("import a from 'a';\nexport const view = <div className=\"flex\" />;\nimport b from 'b';\n");
    assert!(out.find("const styles").unwrap() < out.find("export const view").unwrap(), "{out}");
}

#[test]
fn tailwind_declares_the_compound_state() {
    let out = tailwind_one("<a className=\"hover:bg-red-500 focus:bg-blue-500\" />;\n");
    assert!(out.contains("':hover:focus': {\n      backgroundColor: t.blue[500],\n    },"), "{out}");
}

#[test]
fn tailwind_resolves_border_and_transition_defaults() {
    let out = tailwind_one("<a className=\"border-t-2 border-dashed transition duration-200\" />;\n");
    assert!(out.contains("borderTopStyle: 'dashed',"), "{out}");
    assert!(out.contains("transitionDuration: '200ms',"), "{out}");
    assert!(!out.contains("t.transition.duration"), "{out}");
    let out = tailwind_one("<a className=\"-translate-x-1/2 bg-black/50\" />;\n");
    assert!(out.contains("translate: '-50% 0',"), "{out}");
    assert!(out.contains("backgroundColor: `color-mix(in oklab, ${t.color.black} 50%, transparent)`,"), "{out}");
}

#[test]
fn tailwind_holds_what_it_cannot_settle() {
    let one = |code: &str| tailwind_holds(code, "");
    assert_eq!(one("<div className=\"prose\" />"), ["unknown-class"]);
    assert_eq!(one("<div className=\"p-2 p-4\" />"), ["conflicting-classes"]);
    assert_eq!(one("<div className=\"group-hover:flex\" />"), ["unknown-variant"]);
    assert_eq!(one("<Button className=\"flex\" />"), ["component-class"]);
    assert_eq!(one("<div className={`flex ${x}`} />"), ["dynamic-class"]);
    assert_eq!(one("import clsx from 'clsx';\n<div className={clsx('flex')} />"), ["clsx"]);
    assert_eq!(one("import { cn } from 'cn';\n<div className={cn('flex', className)} />"), ["dynamic-class"]);
    assert_eq!(one("import { cn } from '@/lib/utils';\n<div className={cn('flex')} />"), ["use-cn"]);
    assert_eq!(one("import { twMerge } from 'tailwind-merge';\n<div className={twMerge('flex')} />"), ["use-cn"]);
    assert_eq!(tailwind_holds("<div className=\"p-4\" />", "@theme { --spacing: 0.3rem; }"), ["theme-override"]);
    assert_eq!(tailwind_holds("<div className=\"dark:flex\" />", "@custom-variant dark (&:where(.dark, .dark *));"), ["custom-variant"]);
}

fn emotion_scan(code: &str) -> crate::emotion::Outcome {
    library_scan(code, &crate::emotion::EMOTION)
}

fn library_scan(code: &str, lib: &crate::emotion::Library) -> crate::emotion::Outcome {
    let files = [
        (
            "src/tokens.ts",
            "export const gap = 8;\nexport const theme = { gap, spacing: { small: 4 } };\nexport const live = readFromWindow();
export const flag = +(2 > 1);\nexport const none = null;\nexport const label = 'x' + true;\nexport const anim = player.keyframes();\n",
        ),
        ("src/anim.ts", "import { keyframes } from '@emotion/react';\nexport const fade = keyframes`from { opacity: 0; }`;\n"),
        ("src/index.ts", "export { gap as space, live } from './tokens';\n"),
    ];
    let modules: FxHashMap<String, crate::emotion::Module> =
        files.iter().map(|(file, text)| (file.to_string(), crate::emotion::module(file, text))).collect();
    let exports = |specifier: &str, name: &str| crate::emotion::resolve_kind(&modules, None, "src/App.tsx", specifier, name);
    crate::emotion::scan_file("src/App.tsx", code, "sx", lib, &exports)
}

fn emotion_one(code: &str) -> String {
    let outcome = emotion_scan(code);
    assert!(outcome.holds.is_empty(), "{:?}", outcome.holds);
    outcome.rewritten.unwrap()
}

fn emotion_holds(code: &str) -> Vec<&'static str> {
    emotion_scan(code).holds.iter().map(|h| h.kind).collect()
}

#[test]
fn emotion_moves_named_styles_into_create() {
    let code = "/** @jsxImportSource @emotion/react */
import { css } from '@emotion/react';

const base = css({
  label: 'base',
  color: 'red',
  'font-size': 14,
  '&:hover, &:focus-visible': { color: 'blue' },
  '&::before': { content: '\"\"' },
  '@media (min-width: 640px)': { color: 'green', '&:hover': { color: 'black' } },
});
const loud = css(base, { fontWeight: 700 });

export const A = ({ on }) => <div css={[base, on && loud]} />;
";
    let expected = "import * as css from '@plumeria/core';

const styles = css.create({
  base: {
    color: 'red',
    fontSize: 14,
    ':hover': {
      color: 'blue',
    },
    ':focus-visible': {
      color: 'blue',
    },
    '::before': {
      content: '\"\"',
    },
    '@media (min-width: 640px)': {
      color: 'green',
      ':hover': {
        color: 'black',
      },
    },
  },
  loud: {
    fontWeight: 700,
  },
});

export const A = ({ on }) => <div sx={[styles.base, on && [styles.base, styles.loud]]} />;
";
    assert_eq!(emotion_one(code), expected);
}

#[test]
fn emotion_hoists_inline_objects_by_hash() {
    let code = "import { css } from '@emotion/react';
export const A = () => <><p css={{ padding: 8 }} /><p css={{ padding: 8 }} /></>;
";
    let out = emotion_one(code);
    let key = out.split("sx={styles.").nth(1).unwrap().split('}').next().unwrap();
    assert!(key.starts_with("e_") && key.len() == 9, "{key}");
    assert_eq!(out.matches(&format!("{key}: {{")).count(), 1, "{out}");
    assert_eq!(out.matches(&format!("sx={{styles.{key}}}")).count(), 2, "{out}");
}

#[test]
fn emotion_turns_local_values_into_function_keys() {
    let code = "const gap = 4;
export const A = ({ color, open }) => <div css={{ color, margin: gap, padding: open ? 16 : 8, ':hover': { color } }} />;
";
    let out = emotion_one(code);
    assert!(out.starts_with("import * as css from '@plumeria/core';\n\nconst gap = 4;\nconst styles = css.create({"), "{out}");
    assert!(out.contains(": (a, b, c) => ({\n    color: a,\n    margin: gap,\n    padding: b,\n    ':hover': {\n      color: c,\n    },\n  }),"), "{out}");
    assert!(out.contains("(color, open ? 16 : 8, color)} />"), "{out}");
}

#[test]
fn emotion_reads_template_literals() {
    let code = "import { css } from '@emotion/react';
const gap = 4;
const base = css`
  label: base;
  color: red;
  margin: ${gap}px;
  &:hover, &:focus { color: blue; }
  @media (min-width: 640px) {
    padding: 16px;
  }
`;
const loud = css`
  ${base};
  font-weight: 700;
`;
export const A = () => <div css={loud} />;
";
    let expected = "import * as css from '@plumeria/core';
const gap = 4;
const styles = css.create({
  base: {
    color: 'red',
    margin: `${gap}px`,
    ':hover': {
      color: 'blue',
    },
    ':focus': {
      color: 'blue',
    },
    '@media (min-width: 640px)': {
      padding: '16px',
    },
  },
  loud: {
    fontWeight: '700',
  },
});
export const A = () => <div sx={[styles.base, styles.loud]} />;
";
    assert_eq!(emotion_one(code), expected);
}

#[test]
fn emotion_passes_local_interpolations_as_arguments() {
    let code = "export const A = ({ size, tone }) => <div css={css`width: ${size}px; color: ${tone};`} />;\n";
    let out = emotion_one(&format!("import {{ css }} from '@emotion/react';\n{code}"));
    assert!(out.contains(": (a, b) => ({\n    width: `${a}px`,\n    color: b,\n  }),"), "{out}");
    assert!(out.contains("(size, tone)} />"), "{out}");
}

#[test]
fn emotion_rewrites_styled_elements() {
    let code = "import { css } from '@emotion/react';
import styled from '@emotion/styled';

const base = css({ color: 'red' });
const Button = styled.button`
  ${base};
  padding: 8px;
`;
const Box = styled('section')({ display: 'grid' });

export const A = () => (
  <Box>
    <Button type=\"submit\">go</Button>
    <Button as=\"a\" href=\"/\" />
  </Box>
);
";
    let expected = "import * as css from '@plumeria/core';

const styles = css.create({
  base: {
    color: 'red',
  },
  Button: {
    padding: '8px',
  },
  Box: {
    display: 'grid',
  },
});

export const A = () => (
  <section sx={styles.Box}>
    <button sx={[styles.base, styles.Button]} type=\"submit\">go</button>
    <a sx={[styles.base, styles.Button]} href=\"/\" />
  </section>
);
";
    assert_eq!(emotion_one(code), expected);
}

#[test]
fn emotion_converts_keyframes_in_place() {
    let code = "import { css, keyframes } from '@emotion/react';
export const bounce = keyframes`
  from, 50% { transform: translateY(0); opacity: 0; }
  50% { opacity: 1; }
  to { transform: translateY(-8px); }
`;
const fade = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
export const A = () => <div css={css`animation: ${bounce} 1s ease infinite;`}><p css={{ animationName: fade }} /></div>;
";
    let out = emotion_one(code);
    let expected_head = "import * as css from '@plumeria/core';
export const bounce = css.keyframes({
  from: {
    transform: 'translateY(0)',
    opacity: '0',
  },
  '50%': {
    transform: 'translateY(0)',
    opacity: '1',
  },
  to: {
    transform: 'translateY(-8px)',
  },
});
const fade = css.keyframes({
  from: {
    opacity: 0,
  },
  to: {
    opacity: 1,
  },
});
const styles = css.create({
";
    assert!(out.starts_with(expected_head), "{out}");
    assert!(out.contains("    animation: `${bounce} 1s ease infinite`,\n"), "{out}");
    assert!(out.contains("    animationName: fade,\n"), "{out}");
}

#[test]
fn emotion_places_create_after_what_it_reads() {
    let code = "import { css } from '@emotion/react';
const base = css({ color: 'red' });
const gap = 8;
export const A = () => <div css={[base, { margin: gap }]} />;
";
    let out = emotion_one(code);
    assert!(out.starts_with("import * as css from '@plumeria/core';\nconst gap = 8;\nconst styles = css.create({\n  base: {"), "{out}");
    let early = "import { css } from '@emotion/react';
export const A = () => <div css={{ margin: gap }} />;
const gap = 8;
";
    assert_eq!(emotion_holds(early), ["hoist-order"]);
    let live = "let gap = 8;\nexport const A = () => <div css={{ margin: gap }} />;\n";
    assert!(emotion_one(live).contains("(gap)} />"), "{}", emotion_one(live));
    let member = "const theme = { gap: 8 };\nexport const A = () => <div css={{ margin: theme.gap, padding: theme.gap }} />;\n";
    let out = emotion_one(member);
    assert!(out.contains("margin: a,\n    padding: b,") && out.contains("(theme.gap, theme.gap)} />"), "{out}");
    let calls = "export const A = () => <div css={{ marginTop: next(), marginBottom: next() }} />;\n";
    let out = emotion_one(calls);
    assert!(out.contains("marginTop: a,\n    marginBottom: b,") && out.contains("(next(), next())} />"), "{out}");
    let comma = "export const A = () => <div css={{ '&:hover, &:focus': { color: next() } }} />;\n";
    assert!(emotion_one(comma).contains("(next())} />"), "{}", emotion_one(comma));
}

#[test]
fn emotion_holds_users_of_held_keyframes() {
    let user = "import { css } from '@emotion/react';
import { bounce } from './animations';
export const A = () => <div css={{ animationName: bounce }} />;
";
    let plan = |animations: &str, user: &str| {
        let sources = vec![
            ("src/animations.ts".to_string(), animations.to_string()),
            ("src/App.tsx".to_string(), user.to_string()),
        ];
        crate::emotion::plan(&sources, None, "sx", &crate::emotion::EMOTION)
    };
    let clean = "import { keyframes } from '@emotion/react';\nexport const bounce = keyframes`from { opacity: 0; }`;\n";
    let both = plan(clean, user);
    assert!(both[0].rewritten.is_some() && both[1].rewritten.is_some());
    let held = plan(
        "import { keyframes, Global } from '@emotion/react';\nexport const bounce = keyframes`from { opacity: 0; }`;\nexport const G = Global;\n",
        user,
    );
    assert!(held[0].rewritten.is_none() && held[1].rewritten.is_none());
    assert_eq!(held[1].holds.iter().map(|h| h.kind).collect::<Vec<_>>(), ["linked-to-held"]);
    assert_eq!(held[1].holds[0].detail, "src/animations.ts");
    let held_user = format!("{user}export const B = () => <div css={{{{ color: 'red' }}}} className=\"x\" />;\n");
    let reverse = plan(clean, &held_user);
    assert!(reverse[0].rewritten.is_none() && reverse[1].rewritten.is_none());
    assert_eq!(reverse[0].holds.iter().map(|h| h.kind).collect::<Vec<_>>(), ["linked-to-held"]);
    assert_eq!(reverse[0].holds[0].detail, "src/App.tsx");
    let held_tail = "export const B = () => <div css={{ color: 'red' }} className=\"x\" />;\n";
    let namespace = format!("import {{ css }} from '@emotion/react';\nimport * as animations from './animations';\nexport const C = animations.bounce;\n{held_tail}");
    let reverse = plan(clean, &namespace);
    assert!(reverse[0].rewritten.is_none(), "{:?}", reverse[0].holds);
    for value in ["animations.bounce", "animations['bounce']", "active ? animations.bounce : 'none'"] {
        let code = format!("import * as animations from './animations';\nexport const A = () => <div css={{{{ animationName: {value} }}}} />;");
        let held = plan(clean, &code);
        assert!(held.iter().all(|file| file.rewritten.is_none()), "{value}");
        assert!(held[1].holds.iter().any(|hold| hold.kind == "dynamic-value"), "{value}");
    }
    for types in ["import type { bounce } from './animations';", "import { type bounce } from './animations';"] {
        let code = format!("import {{ css }} from '@emotion/react';\n{types}\nexport type T = typeof bounce;\n{held_tail}");
        let typed = plan(clean, &code);
        assert!(typed[0].rewritten.is_some() && typed[1].rewritten.is_none(), "{types}");
    }
}

#[test]
fn emotion_holds_what_it_cannot_carry() {
    let one = |code: &str| emotion_holds(&format!("import {{ css }} from '@emotion/react';\n{code}"));
    assert_eq!(one("<div css={{ '& > span': { color: 'red' } }} />"), ["selector"]);
    assert_eq!(one("<div css={{ '.title &': { color: 'red' } }} />"), ["selector"]);
    assert_eq!(one("<div css={{ background: ['red', 'blue'] }} />"), ["fallback-value"]);
    assert_eq!(one("<div css={{ ':hover': { '@media (x)': { color: 'red' } } }} />"), ["at-rule-in-pseudo"]);
    assert_eq!(one("<div css={{ ':hover': { color: 'red' }, ':focus': { color: 'blue' } }} />"), ["overlapping-states"]);
    assert_eq!(
        one("<div css={{ '@media (min-width: 900px)': { color: 'red' }, '@media (min-width: 600px)': { color: 'blue' } }} />"),
        ["media-order"]
    );
    assert_eq!(one("<Button css={{ color: 'red' }} />"), ["component-css"]);
    assert_eq!(one("<div className=\"x\" css={{ color: 'red' }} />"), ["css-beside-attribute"]);
    assert_eq!(one("<div {...props} css={{ color: 'red' }} />"), ["spread-props"]);
    assert_eq!(one("<div css={theme => ({ color: theme.c })} />"), ["theme-function"]);
    assert_eq!(one("<div css={css`${mq} { color: red; }`} />"), ["selector-interpolation"]);
    assert_eq!(one("<div css={css`color: red; ${x};`} />"), ["interpolation-position"]);
    assert_eq!(one("<div css={css`a { color: red; }`} />"), ["selector"]);
    assert_eq!(one("const a = css({ color: 'red' });\nfoo(a);"), ["style-used-elsewhere"]);
    assert_eq!(one("export const a = css({ color: 'red' });"), ["exported-style"]);
    assert_eq!(one("const A = () => { const a = css({ color: 'red' }); return null; };"), ["css-not-top-level"]);
    assert_eq!(one("const a = css({ color: darken('red') });\n<div css={a} />"), ["dynamic-value"]);
    assert_eq!(emotion_holds("import { Global } from '@emotion/react';\n<div css={{}} />"), ["unsupported-api"]);
    assert_eq!(emotion_holds("import { jsx } from '@emotion/react';\njsx('div', {});"), ["jsx-call"]);
    assert_eq!(one("let gap = 8;\nconst a = css({ margin: gap });\n<div css={a} />"), ["dynamic-value"]);
    let skipped = emotion_scan("/** @jsxImportSource other-lib */\n<div css={{ color: 'red' }} />");
    assert!(skipped.rewritten.is_none() && skipped.holds.is_empty());
    let skipped = emotion_scan("/** @jsx h */\nimport { h } from 'x';\n<div css={{ color: 'red' }} />");
    assert!(skipped.rewritten.is_none() && skipped.holds.is_empty());
    assert_eq!(one("const gap = read();\nconst a = css({ margin: gap });\n<div css={a} />"), ["dynamic-value"]);
    assert_eq!(one("import { live } from './tokens';\nconst a = css({ margin: live });\n<div css={a} />"), ["dynamic-value"]);
    assert_eq!(one("import { live } from './index';\nconst a = css({ margin: live });\n<div css={a} />"), ["dynamic-value"]);
    assert_eq!(one("import { gap } from 'pkg';\nconst a = css({ margin: gap });\n<div css={a} />"), ["dynamic-value"]);
    for name in ["flag", "none", "label"] {
        let code = format!("import {{ {name} }} from './tokens';\nconst a = css({{ margin: {name} }});\n<div css={{a}} />");
        assert_eq!(one(&code), ["dynamic-value"], "{name}");
    }
    assert_eq!(one("import { theme } from './tokens';\nconst a = css({ margin: theme.missing });\n<div css={a} />"), ["dynamic-value"]);
    assert_eq!(one("import { theme } from './tokens';\nconst a = css({ margin: theme.spacing });\n<div css={a} />"), ["dynamic-value"]);
    assert!(one("import { theme } from './tokens';\nconst a = css({ margin: theme.spacing.small });\n<div css={a} />").is_empty());
    let frames = "import { css } from '@emotion/react';
import { anim } from './tokens';
import { fade } from './anim';
const local = player.keyframes();
export const A = () => <div css={{ animationName: fade, transitionProperty: anim, animation: local }} />;
";
    let out = emotion_one(frames);
    assert!(out.contains("animationName: fade,") && out.contains("(anim, local)} />"), "{out}");
    let resolved = "import { css } from '@emotion/react';
import { space } from './index';
import { theme } from './tokens';
const a = css({ margin: space, padding: theme.gap });
export const A = () => <div css={[a, { gap: space }]} />;
";
    let out = emotion_one(resolved);
    assert!(out.contains("    margin: space,\n    padding: theme.gap,\n"), "{out}");
    assert!(out.contains("    gap: space,\n"), "{out}");
    assert!(emotion_holds("/** @jsx jsx */\nimport { jsx } from '@emotion/react';\n<div css={{ color: 'red' }} />").is_empty());
    let frames = |code: &str| emotion_holds(&format!("import {{ keyframes }} from '@emotion/react';\n{code}"));
    assert_eq!(frames("const a = keyframes`from { opacity: ${x}; }`;"), ["keyframes-interpolation"]);
    assert_eq!(frames("const a = keyframes`half { opacity: 0; }`;"), ["keyframes-selector"]);
    assert_eq!(frames("const a = keyframes({ from: { opacity: o } });"), ["dynamic-value"]);
    assert_eq!(frames("const A = () => { const a = keyframes`from { opacity: 0; }`; };"), ["unsupported-use"]);
    assert_eq!(emotion_holds("import { cx } from '@emotion/css';\n<div css={{}} />"), ["unsupported-import"]);
    let styled = |code: &str| emotion_holds(&format!("import styled from '@emotion/styled';\n{code}"));
    assert_eq!(styled("const A = styled(Link)`color: red;`;\n<A />"), ["styled-component"]);
    assert_eq!(styled("const A = styled('div', { label: 'a' })`color: red;`;\n<A />"), ["styled-options"]);
    assert_eq!(styled("const A = styled.div`color: ${p => p.c};`;\n<A />"), ["dynamic-value"]);
    assert_eq!(styled("const A = styled.div`color: red;`;\n<A className=\"x\" />"), ["styled-beside-attribute"]);
    assert_eq!(styled("const A = styled.div`color: red;`;\n<A {...props} />"), ["spread-props"]);
    assert_eq!(styled("const A = styled.div`color: red;`;\n<A as={Link} />"), ["styled-as"]);
    assert_eq!(styled("const A = styled.div({ color: 'red' });\n<A tone=\"quiet\" />"), ["custom-prop"]);
    assert!(styled("const A = styled.div({ color: 'red' });\n<A data-x=\"1\" aria-label=\"a\" onClick={f} id=\"a\" />").is_empty());
    assert_eq!(styled("const A = styled.div`color: red;`;\nfoo(A);"), ["style-used-elsewhere"]);
    assert_eq!(styled("export const A = styled.div`color: red;`;"), ["exported-style"]);
    assert_eq!(emotion_holds("const styles = 1;\n<div css={{ color: 'red' }} />"), ["binding-taken"]);
}

fn styled_scan(code: &str) -> crate::emotion::Outcome {
    library_scan(&format!("import styled, {{ css, keyframes }} from 'styled-components';\n{code}"), &crate::emotion::STYLED_COMPONENTS)
}

fn styled_holds(code: &str) -> Vec<&'static str> {
    styled_scan(code).holds.iter().map(|h| h.kind).collect()
}

#[test]
fn styled_components_rewrites_templates_and_keyframes() {
    let outcome = styled_scan(
        "const fade = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const base = css`color: red;`;
const Box = styled.div`
  ${base};
  animation-name: ${fade};
  &:hover { color: blue; }
`;
export const A = () => <Box id=\"a\">hi</Box>;
",
    );
    assert!(outcome.holds.is_empty(), "{:?}", outcome.holds);
    let expected = "import * as css from '@plumeria/core';
const fade = css.keyframes({
  from: {
    opacity: '0',
  },
  to: {
    opacity: '1',
  },
});
const styles = css.create({
  base: {
    color: 'red',
  },
  Box: {
    animationName: fade,
    ':hover': {
      color: 'blue',
    },
  },
});
export const A = () => <div sx={[styles.base, styles.Box]} id=\"a\">hi</div>;
";
    assert_eq!(outcome.rewritten.unwrap(), expected);
}

#[test]
fn styled_components_holds_runtime_forms() {
    assert_eq!(styled_holds("const A = styled.div`color: ${p => p.c};`;\n<A />"), ["dynamic-value"]);
    assert_eq!(styled_holds("const A = styled.div.attrs({ id: 'a' })`color: red;`;\n<A />"), ["unsupported-use"]);
    assert_eq!(styled_holds("const A = styled(Link)`color: red;`;\n<A />"), ["styled-component"]);
    assert_eq!(styled_holds("const A = styled.div`color: red;`;\n<A $tone=\"quiet\" />"), ["custom-prop"]);
    let one = |code: &str| {
        let outcome = library_scan(code, &crate::emotion::STYLED_COMPONENTS);
        outcome.holds.iter().map(|h| h.kind).collect::<Vec<_>>()
    };
    assert_eq!(one("import { createGlobalStyle } from 'styled-components';"), ["unsupported-api"]);
    assert_eq!(one("import * as sc from 'styled-components';"), ["namespace-import"]);
    assert_eq!(one("import styled from 'styled-components/native';"), ["unsupported-import"]);
    assert!(one("/** @jsxImportSource @emotion/react */\nimport { css } from 'styled-components';\n<div css={{}} />").is_empty());
    assert!(one("import { css } from '@emotion/react';\n<div css={{ color: 'red' }} />").is_empty());
}
