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
fn leaves_other_class_names_on_class_name() {
    let css = ".base { color: red }";
    let out = converted(&format!("{IMPORT}<div className={{[props.className, s.base].filter(Boolean).join(' ')}} />;"), css);
    assert!(out.ends_with("<div className={[props.className].filter(Boolean).join(' ')} sx={styles.base} />;"), "{out}");
    let words = converted(&format!("{IMPORT}<div className={{`${{s.base}} active`}} />;"), css);
    assert!(words.ends_with("<div className=\"active\" sx={styles.base} />;"), "{words}");
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
