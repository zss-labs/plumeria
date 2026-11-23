use super::desugar;

fn run(source: &str) -> String {
    desugar(source, "/app/Button.tsx", "sx").unwrap().unwrap()
}

fn fail(source: &str) -> String {
    match desugar(source, "/app/Button.tsx", "sx") {
        Err(message) => message,
        Ok(output) => panic!("expected an error, got {output:?}"),
    }
}

fn problems(source: &str) -> Vec<String> {
    let allocator = oxc_allocator::Allocator::default();
    let program = match crate::syntax::parse::parse_program(&allocator, source) {
        Ok(program) => program,
        Err(message) => return vec![message],
    };
    oxc_semantic::SemanticBuilder::new()
        .with_check_syntax_error(true)
        .build(&program)
        .diagnostics
        .errors()
        .map(|diagnostic| diagnostic.to_string())
        .collect()
}

fn temp_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "plumeria-styled-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("package.json"), "{}").unwrap();
    dir
}

fn transform(dir: &std::path::Path, name: &str, source: &str) -> Result<String, String> {
    let file = dir.join(name);
    std::fs::write(&file, source).unwrap();
    let file = file.to_str().unwrap().to_string();
    let source = desugar(source, &file, "sx")?.unwrap_or_else(|| source.to_string());
    let env = crate::transform::TransformEnv {
        source,
        module_id: file.clone(),
        file_path: file,
        root: dir.to_str().unwrap().to_string(),
        style_prop: "sx".to_string(),
        class_prop: "className".to_string(),
        policy: None,
        is_dev: false,
        cwd: dir.to_str().unwrap().to_string(),
    };
    let mut project = crate::project::lock_project();
    crate::transform::transform_source(&mut project, &env).map(|output| output.code)
}

#[test]
fn desugared_components_compile_through_the_transform() {
    let dir = temp_dir("transform");
    std::fs::write(
        dir.join("base.tsx"),
        "import { styled } from '@plumeria/react';\nexport const Base = styled.button({ color: 'red', padding: (p: { pad: number }) => p.pad, ':hover': { color: 'navy' } });",
    )
    .unwrap();
    let base = transform(
        &dir,
        "base.tsx",
        &std::fs::read_to_string(dir.join("base.tsx")).unwrap(),
    )
    .unwrap();
    assert!(!base.contains("__styled_css.create"), "{base}");
    assert!(!base.contains(" sx="), "{base}");
    assert!(base.contains("className"), "{base}");

    let ghost = transform(
        &dir,
        "ghost.tsx",
        "import * as css from '@plumeria/core';\nimport { styled } from '@plumeria/react';\nimport { Base } from './base';\nconst styles = css.create({ big: { color: 'green', fontSize: 20 } });\nexport const Ghost = styled(Base)({ color: 'blue' });\nexport const App = () => <Ghost pad={4} sx={styles.big}>Go</Ghost>;",
    )
    .unwrap();
    assert!(!ghost.contains("@plumeria/react"), "{ghost}");
    assert!(!ghost.contains("__styled_css.create"), "{ghost}");
    assert!(
        ghost.contains("<button {...__styled_props} className={"),
        "{ghost}"
    );
    assert!(ghost.contains("[__styled_sx]"), "{ghost}");
    assert!(
        ghost.contains(
            "_value\": ((__plumeria_value) => typeof (__plumeria_value) === 'number' ? (__plumeria_value) + 'px' : (__plumeria_value))(__styled_Ghost__0$0({ pad: __styled_prop0 })) }}"
        ),
        "{ghost}"
    );
    assert!(
        !ghost.contains("<Ghost pad={4} sx={styles.big}>"),
        "{ghost}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn files_without_the_react_import_are_untouched() {
    let source = "import * as css from '@plumeria/core';\nconst styles = css.create({ a: { color: 'red' } });";
    assert_eq!(desugar(source, "/app/a.tsx", "sx").unwrap(), None);
}

#[test]
fn type_only_imports_are_untouched() {
    let source = "import type { StyledRule } from '@plumeria/react';\ntype R = StyledRule<{}>;";
    assert_eq!(desugar(source, "/app/a.tsx", "sx").unwrap(), None);
}

#[test]
fn intrinsic_element_becomes_create_and_sx_component() {
    let output = run(
        "import { styled } from '@plumeria/react';\nconst Button = styled.button({ fontSize: 24, ':hover': { color: 'navy' } });",
    );
    assert_eq!(
        output,
        "import * as __styled_css from '@plumeria/core';\nconst __styled_Button__0 = __styled_css.create({ base: { fontSize: 24, ':hover': { color: 'navy' } } });\nconst Button = ({ sx: __styled_sx, ...__styled_props }) => <button {...__styled_props} sx={[__styled_Button__0.base, __styled_sx]} />;"
    );
}

#[test]
fn dynamic_values_become_function_keys_and_are_not_forwarded() {
    let output = run(
        "import { styled } from '@plumeria/react';\nconst Box = styled.div<{ tone: string }>({ padding: 8, color: (props) => props.tone, ':hover': { borderColor: ({ edge }) => edge } });",
    );
    assert!(output.contains(
        "const __styled_Box__0 = __styled_css.create({ base: { padding: 8 }, d0: (__styled_value) => ({ color: __styled_value }), d1: (__styled_value) => ({ ':hover': { borderColor: __styled_value } }) });"
    ));
    assert!(output.contains("const __styled_Box__0$0 = (props) => props.tone;"));
    assert!(output.contains("const __styled_Box__0$1 = ({ edge }) => edge;"));
    assert!(output.contains(
        "({ sx: __styled_sx, tone: __styled_prop0, edge: __styled_prop1, ...__styled_props }) => <div {...__styled_props} sx={[__styled_Box__0.base, __styled_Box__0.d0(__styled_Box__0$0({ tone: __styled_prop0 })), __styled_Box__0.d1(__styled_Box__0$1({ edge: __styled_prop1 })), __styled_sx]} />"
    ));
}

#[test]
fn nested_styled_flattens_to_the_base_element() {
    let output = run(
        "import { styled } from '@plumeria/react';\nconst A = styled.button({ color: 'red' });\nconst B = styled(A)({ fontSize: 12 });\nconst C = styled(B)({ color: 'blue' });",
    );
    assert!(output.contains(
        "const C = ({ sx: __styled_sx, ...__styled_props }) => <button {...__styled_props} sx={[__styled_A__0.base, __styled_B__1.base, __styled_C__2.base, __styled_sx]} />;"
    ));
}

#[test]
fn plumeria_apis_stay_in_static_values() {
    let output = run(
        "import * as css from '@plumeria/core';\nimport { styled } from '@plumeria/react';\nimport { theme, breakpoints } from './tokens';\nconst Card = styled.div({ ...css.marker('card', ':hover'), color: theme.primary, [breakpoints.sm]: { padding: 4 }, [css.extended('card', ':hover')]: { color: 'blue' } });",
    );
    assert!(output.contains(
        "base: { ...css.marker('card', ':hover'), color: theme.primary, [breakpoints.sm]: { padding: 4 }, [css.extended('card', ':hover')]: { color: 'blue' } }"
    ));
}

#[test]
fn theme_value_objects_are_not_treated_as_selectors() {
    let output = run(
        "import { styled } from '@plumeria/react';\nconst A = styled.p({ color: { default: 'black', theme: 'white' } });",
    );
    assert!(output.contains("base: { color: { default: 'black', theme: 'white' } }"));
}

#[test]
fn exported_components_export_their_layers() {
    let output = run(
        "import { styled } from '@plumeria/react';\nexport const A = styled.a({ color: (p) => p.c });\nconst B = styled(A)({ fontSize: 1 });\nexport { B as Link };",
    );
    assert!(output.ends_with(
        "\nexport { __styled_A__0 as __styled_A__0, __styled_A__0$0 as __styled_A__0$0, __styled_A__0 as __styled_Link__0, __styled_A__0$0 as __styled_Link__0$0, __styled_B__1 as __styled_Link__1 };\n"
    ));
}

#[test]
fn styled_from_another_file_imports_its_layers() {
    let dir = temp_dir("import");
    std::fs::write(
        dir.join("base.tsx"),
        "import { styled } from '@plumeria/react';\nexport const Base = styled.button({ color: (p) => p.c });",
    )
    .unwrap();
    let file = dir.join("ghost.tsx");
    let output = desugar(
        "import { styled } from '@plumeria/react';\nimport { Base } from './base';\nexport const Ghost = styled(Base)({ fontSize: 2 });",
        file.to_str().unwrap(),
        "sx",
    )
    .unwrap()
    .unwrap();
    assert!(output.starts_with(
        "import * as __styled_css from '@plumeria/core';\nimport { __styled_Base__0 as __styled_Ghost__0, __styled_Base__0$0 as __styled_Ghost__0$0 } from './base';"
    ));
    assert!(output.contains(
        "<button {...__styled_props} sx={[__styled_Ghost__0.d0(__styled_Ghost__0$0({ c: __styled_prop0 })), __styled_Ghost__1.base, __styled_sx]} />"
    ));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn custom_style_prop_is_used() {
    let output = desugar(
        "import { styled } from '@plumeria/react';\nconst A = styled.i({ color: 'red' });",
        "/app/a.tsx",
        "css",
    )
    .unwrap()
    .unwrap();
    assert!(output.contains(
        "({ css: __styled_sx, ...__styled_props }) => <i {...__styled_props} css={[__styled_A__0.base, __styled_sx]} />"
    ));
}

#[test]
fn branching_dynamic_values_are_errors() {
    let message = fail(
        "import { styled } from '@plumeria/react';\nconst A = styled.a({ color: (p) => p.on ? 'red' : undefined });",
    );
    assert!(message.contains("branches its value"));
    let message = fail(
        "import { styled } from '@plumeria/react';\nconst A = styled.a({ color: (p) => p.on && 'red' });",
    );
    assert!(message.contains("branches its value"));
}

#[test]
fn runtime_component_choice_is_an_error() {
    let message = fail(
        "import { styled } from '@plumeria/react';\nconst A = styled.a({});\nconst B = styled.b({});\nconst C = styled(flag ? A : B)({});",
    );
    assert!(message.contains("must name a styled component directly"));
}

#[test]
fn plain_components_are_errors() {
    let message = fail(
        "import { styled } from '@plumeria/react';\nconst Plain = (props) => <a {...props} />;\nconst A = styled(Plain)({ color: 'red' });",
    );
    assert!(message.contains("\"Plain\" is not a styled component"));
}

#[test]
fn definitions_read_in_dynamic_values_are_errors() {
    let message = fail(
        "import * as css from '@plumeria/core';\nimport { styled } from '@plumeria/react';\nconst tokens = css.createStatic({ gap: '4px' });\nconst A = styled.a({ margin: (p) => tokens.gap });",
    );
    assert!(message.contains("reads the Plumeria definition \"tokens\""));
}

#[test]
fn whole_props_reads_are_errors() {
    let message = fail(
        "import { styled } from '@plumeria/react';\nconst A = styled.a({ color: (p) => pick(p) });",
    );
    assert!(message.contains("must read props by name"));
}

#[test]
fn non_top_level_calls_are_errors() {
    let message =
        fail("import { styled } from '@plumeria/react';\nfunction f() { return styled.a({}); }");
    assert!(message.contains("only be called at the top level"));
}

#[test]
fn ts_files_are_errors() {
    let message = desugar(
        "import { styled } from '@plumeria/react';\nconst A = styled.a({});",
        "/app/a.ts",
        "sx",
    )
    .unwrap_err();
    assert!(message.contains(".tsx or .jsx"));
}

#[test]
fn prop_names_do_not_shadow_generated_bindings() {
    let output = run(
        "import { styled } from '@plumeria/react';\nconst Box = styled.div({ color: (p) => p.__styled_Box__0, margin: (p) => p.default });",
    );
    assert!(output.contains(
        "({ sx: __styled_sx, __styled_Box__0: __styled_prop0, default: __styled_prop1, ...__styled_props }) => <div {...__styled_props} sx={[__styled_Box__0.d0(__styled_Box__0$0({ __styled_Box__0: __styled_prop0 })), __styled_Box__0.d1(__styled_Box__0$1({ default: __styled_prop1 })), __styled_sx]} />"
    ));
}

#[test]
fn shadowed_parameters_are_not_read_as_props() {
    let output = run(
        "import { styled } from '@plumeria/react';\nconst Box = styled.div({ opacity: (p) => [1].map((p) => p.toFixed()).length + p.level });",
    );
    assert!(
        output.contains("({ sx: __styled_sx, level: __styled_prop0, ...__styled_props })"),
        "{output}"
    );
    assert!(!output.contains("toFixed: "), "{output}");
}

#[test]
fn shadowed_definitions_are_not_definition_reads() {
    let output = run(
        "import * as css from '@plumeria/core';\nimport { styled } from '@plumeria/react';\nconst tokens = css.createStatic({ gap: '4px' });\nconst Box = styled.div({ margin: (p) => [p.gap].map((tokens) => tokens)[0] });",
    );
    assert!(
        output.contains("({ sx: __styled_sx, gap: __styled_prop0, ...__styled_props })"),
        "{output}"
    );
}

#[test]
fn problems_catch_redeclarations() {
    assert!(!problems("const a = 1;\nconst a = 2;").is_empty());
    assert!(problems("const a = 1;").is_empty());
}

#[test]
fn generated_names_avoid_module_names() {
    let output = run(
        "import { styled } from '@plumeria/react';\nexport const __styled_Box__0 = 1;\nconst __plumeria_css = 2;\nconsole.log(__styled_css);\nexport const Box = styled.div({ color: (p) => p.c });",
    );
    assert!(problems(&output).is_empty(), "{output}");
    assert!(
        output.starts_with("import * as __styled1_css from '@plumeria/core';"),
        "{output}"
    );
    assert!(
        output.contains("export const __styled_Box__0 = 1;\nconst __plumeria_css = 2;\nconsole.log(__styled_css);"),
        "{output}"
    );
    assert!(
        output.contains("const __styled1_Box__0 = __styled1_css.create({ d0: (__styled1_value) => ({ color: __styled1_value }) });"),
        "{output}"
    );
    assert!(
        output.contains("({ sx: __styled1_sx, c: __styled1_prop0, ...__styled1_props }) => <div {...__styled1_props} sx={[__styled1_Box__0.d0(__styled1_Box__0$0({ c: __styled1_prop0 })), __styled1_sx]} />"),
        "{output}"
    );
    assert!(
        output.ends_with("\nexport { __styled1_Box__0 as __styled1_Box__0, __styled1_Box__0$0 as __styled1_Box__0$0 };\n"),
        "{output}"
    );
}

#[test]
fn property_names_do_not_move_the_prefix() {
    let output = run(
        "import { styled } from '@plumeria/react';\nconst config = { __styled_x: 1 };\nconst Box = styled.div({ color: (p) => p.__styled_y });",
    );
    assert!(
        output.starts_with("import * as __styled_css from"),
        "{output}"
    );
}

#[test]
fn imported_layers_use_the_exporting_file_prefix() {
    let dir = temp_dir("prefix");
    let base = "import { styled } from '@plumeria/react';\nconst __styled_note = 1;\nexport const Base = styled.button({ color: (p) => p.c });";
    std::fs::write(dir.join("base.tsx"), base).unwrap();
    let base_file = dir.join("base.tsx");
    let exported = desugar(base, base_file.to_str().unwrap(), "sx")
        .unwrap()
        .unwrap();
    assert!(
        exported.ends_with("\nexport { __styled1_Base__0 as __styled1_Base__0, __styled1_Base__0$0 as __styled1_Base__0$0 };\n"),
        "{exported}"
    );
    let file = dir.join("ghost.tsx");
    let output = desugar(
        "import { styled } from '@plumeria/react';\nimport { Base } from './base';\nexport const Ghost = styled(Base)({ fontSize: 2 });",
        file.to_str().unwrap(),
        "sx",
    )
    .unwrap()
    .unwrap();
    assert!(problems(&output).is_empty(), "{output}");
    assert!(
        output.contains("import { __styled1_Base__0 as __styled_Ghost__0, __styled1_Base__0$0 as __styled_Ghost__0$0 } from './base';"),
        "{output}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn style_prop_is_bound_to_its_own_local() {
    let source =
        "import { styled } from '@plumeria/react';\nconst A = styled.i({ color: (p) => p.c });";
    let output = desugar(source, "/app/a.tsx", "__props").unwrap().unwrap();
    assert!(problems(&output).is_empty(), "{output}");
    assert!(
        output.contains("({ __props: __styled_sx, c: __styled_prop0, ...__styled_props }) => <i {...__styled_props} __props={[__styled_A__0.d0(__styled_A__0$0({ c: __styled_prop0 })), __styled_sx]} />"),
        "{output}"
    );
    let output = desugar(source, "/app/a.tsx", "data-sx").unwrap().unwrap();
    assert!(problems(&output).is_empty(), "{output}");
    assert!(
        output.contains("({ \"data-sx\": __styled_sx, c: __styled_prop0, ...__styled_props }) => <i {...__styled_props} data-sx={["),
        "{output}"
    );
}

#[test]
fn function_key_parameter_does_not_capture_computed_keys() {
    let output = run(
        "import * as css from '@plumeria/core';\nimport { styled } from '@plumeria/react';\nconst value = css.createStatic({ sm: '@media (max-width: 1px)' });\nconst Box = styled.div({ [value.sm]: { color: (p) => p.c } });",
    );
    assert!(
        output.contains("d0: (__styled_value) => ({ [value.sm]: { color: __styled_value } })"),
        "{output}"
    );
}

const BASE: &str = "import { styled } from '@plumeria/react';\nexport const Base = styled.button({ color: (p) => p.c });";

fn ghost_through(dir: &std::path::Path, from: &str, name: &str) -> Result<String, String> {
    let file = dir.join("ghost.tsx");
    desugar(
        &format!(
            "import {{ styled }} from '@plumeria/react';\nimport {{ {name} }} from '{from}';\nexport const Ghost = styled({name})({{ fontSize: 2 }});"
        ),
        file.to_str().unwrap(),
        "sx",
    )
    .map(Option::unwrap)
}

#[test]
fn barrels_lead_to_the_defining_file() {
    let dir = temp_dir("barrel");
    std::fs::create_dir_all(dir.join("ui/button")).unwrap();
    std::fs::write(dir.join("ui/button/Base.tsx"), BASE).unwrap();
    std::fs::write(
        dir.join("ui/button/index.ts"),
        "export { Base } from './Base';\nexport { Base as Button } from './Base';",
    )
    .unwrap();
    std::fs::write(
        dir.join("ui/index.ts"),
        "export * from './button';\nimport { Base } from './button';\nexport { Base as Primary };",
    )
    .unwrap();

    let expected = "import { __styled_Base__0 as __styled_Ghost__0, __styled_Base__0$0 as __styled_Ghost__0$0 } from './ui/button/Base.tsx';";
    for (from, name) in [
        ("./ui/button", "Base"),
        ("./ui/button", "Button"),
        ("./ui", "Base"),
        ("./ui", "Button"),
        ("./ui", "Primary"),
    ] {
        let output = ghost_through(&dir, from, name).unwrap();
        assert!(problems(&output).is_empty(), "{output}");
        assert!(output.contains(expected), "{from} {name}\n{output}");
        assert!(
            output.contains("<button {...__styled_props} sx={[__styled_Ghost__0.d0(__styled_Ghost__0$0({ c: __styled_prop0 })), __styled_Ghost__1.base, __styled_sx]} />"),
            "{from} {name}\n{output}"
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn direct_imports_keep_their_specifier() {
    let dir = temp_dir("direct");
    std::fs::write(dir.join("base.tsx"), BASE).unwrap();
    let output = ghost_through(&dir, "./base", "Base").unwrap();
    assert!(output.contains("} from './base';"), "{output}");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn barrels_without_the_component_are_errors() {
    let dir = temp_dir("barrel-missing");
    std::fs::write(dir.join("base.tsx"), BASE).unwrap();
    std::fs::write(
        dir.join("index.ts"),
        "export * from './base';\nexport const Plain = () => null;",
    )
    .unwrap();
    let message = ghost_through(&dir, "./index", "Plain").unwrap_err();
    assert!(message.contains("\"Plain\" from \"./index\" is not a styled component"));
    let message = ghost_through(&dir, "./index", "Missing").unwrap_err();
    assert!(message.contains("\"Missing\" from \"./index\" is not a styled component"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn cyclic_barrels_end_in_an_error() {
    let dir = temp_dir("barrel-cycle");
    std::fs::write(dir.join("a.ts"), "export * from './b';").unwrap();
    std::fs::write(dir.join("b.ts"), "export * from './a';").unwrap();
    let message = ghost_through(&dir, "./a", "Base").unwrap_err();
    assert!(message.contains("is not a styled component"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn barrel_imports_compile_through_the_transform() {
    let dir = temp_dir("barrel-transform");
    std::fs::create_dir_all(dir.join("ui")).unwrap();
    std::fs::write(dir.join("ui/Base.tsx"), BASE).unwrap();
    std::fs::write(dir.join("ui/index.ts"), "export * from './Base';").unwrap();
    transform(&dir, "ui/Base.tsx", BASE).unwrap();
    let ghost = transform(
        &dir,
        "ghost.tsx",
        "import * as css from '@plumeria/core';\nimport { styled } from '@plumeria/react';\nimport { Base } from './ui';\nconst styles = css.create({ big: { color: 'green' } });\nexport const Ghost = styled(Base)({ color: 'blue' });\nexport const App = () => <Ghost c=\"red\" sx={styles.big}>Go</Ghost>;",
    )
    .unwrap();
    assert!(ghost.contains("from './ui/Base.tsx';"), "{ghost}");
    assert!(
        ghost.contains("<button {...__styled_props} className={"),
        "{ghost}"
    );
    assert!(ghost.contains("[__styled_sx]"), "{ghost}");
    std::fs::remove_dir_all(dir).unwrap();
}

const STYLED_BUTTON: &str = "import { styled } from '@plumeria/react';\nexport const Button = styled.button({ color: 'red' });";

#[test]
fn explicit_re_exports_win_over_export_star() {
    let dir = temp_dir("barrel-explicit");
    std::fs::write(dir.join("plain.tsx"), "export const Button = () => null;").unwrap();
    std::fs::write(dir.join("styled.tsx"), STYLED_BUTTON).unwrap();
    std::fs::write(
        dir.join("index.ts"),
        "export { Button } from './plain';\nexport * from './styled';",
    )
    .unwrap();
    let message = ghost_through(&dir, "./index", "Button").unwrap_err();
    assert!(
        message.contains("\"Button\" from \"./index\" is not a styled component"),
        "{message}"
    );
    std::fs::write(
        dir.join("index.ts"),
        "export * from './styled';\nexport { Button } from './plain';",
    )
    .unwrap();
    let message = ghost_through(&dir, "./index", "Button").unwrap_err();
    assert!(message.contains("is not a styled component"), "{message}");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn conflicting_export_stars_are_ambiguous() {
    let dir = temp_dir("barrel-ambiguous");
    std::fs::write(dir.join("a.tsx"), STYLED_BUTTON).unwrap();
    std::fs::write(dir.join("b.tsx"), STYLED_BUTTON).unwrap();
    std::fs::write(
        dir.join("index.ts"),
        "export * from './a';\nexport * from './b';",
    )
    .unwrap();
    let message = ghost_through(&dir, "./index", "Button").unwrap_err();
    assert!(
        message.contains("exported by more than one export *"),
        "{message}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn export_stars_reaching_one_binding_are_not_ambiguous() {
    let dir = temp_dir("barrel-diamond");
    std::fs::write(dir.join("button.tsx"), STYLED_BUTTON).unwrap();
    std::fs::write(dir.join("a.ts"), "export * from './button';").unwrap();
    std::fs::write(dir.join("b.ts"), "export { Button } from './button';").unwrap();
    std::fs::write(
        dir.join("index.ts"),
        "export * from './a';\nexport * from './b';",
    )
    .unwrap();
    let output = ghost_through(&dir, "./index", "Button").unwrap();
    assert!(
        output.contains("import { __styled_Button__0 as __styled_Ghost__0 } from './button.tsx';"),
        "{output}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn destructured_exports_win_over_export_star() {
    let dir = temp_dir("barrel-destructured");
    std::fs::write(dir.join("styled.tsx"), STYLED_BUTTON).unwrap();
    for local in [
        "export const { Button } = plainComponents;",
        "export const { inner: { Button } } = plainComponents;",
        "export const [Button] = plainComponents;",
        "export const [, ...[Button]] = plainComponents;",
        "export const { Button = () => null } = plainComponents;",
        "export const { ...Button } = plainComponents;",
        "const Button = () => null;\ntype Button = {};\nexport { Button };",
    ] {
        std::fs::write(
            dir.join("index.ts"),
            format!("{local}\nexport * from './styled';"),
        )
        .unwrap();
        let message = ghost_through(&dir, "./index", "Button").unwrap_err();
        assert!(
            message.contains("\"Button\" from \"./index\" is not a styled component"),
            "{local}\n{message}"
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn type_only_re_exports_are_not_values() {
    let dir = temp_dir("barrel-types");
    std::fs::write(dir.join("button.tsx"), STYLED_BUTTON).unwrap();
    std::fs::write(dir.join("other.tsx"), STYLED_BUTTON).unwrap();
    std::fs::write(dir.join("types.ts"), "export * from './other';").unwrap();
    for types in [
        "export type * from './types';",
        "export type { Button } from './other';",
        "export { type Button } from './other';",
        "import type { Button } from './other';\nexport { Button };",
        "type Button = {};\nexport { Button };",
    ] {
        std::fs::write(
            dir.join("index.ts"),
            format!("{types}\nexport * from './button';"),
        )
        .unwrap();
        let output = ghost_through(&dir, "./index", "Button").unwrap();
        assert!(
            output.contains("} from './button.tsx';"),
            "{types}\n{output}"
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn unrelated_locals_named_styled_are_not_calls() {
    let output = run(
        "import { styled } from '@plumeria/react';\nconst Box = styled.div({ color: 'red' });\nfunction identity(styled: string) { return styled; }\nconst pick = ({ styled }) => styled.div;\ntype Styled = typeof styled;\nconst other: typeof styled.div = null!;",
    );
    assert!(problems(&output).is_empty(), "{output}");
    assert!(
        output.contains("function identity(styled: string) { return styled; }"),
        "{output}"
    );
    let message = fail(
        "import { styled } from '@plumeria/react';\nfunction f(styled2) { return styled.a({}); }",
    );
    assert!(
        message.contains("only be called at the top level"),
        "{message}"
    );
}

#[test]
fn string_export_names_become_valid_identifiers() {
    let output = run(
        "import { styled } from '@plumeria/react';\nconst Button = styled.button({ color: (p) => p.c });\nexport { Button as \"ui-button\", Button as \"$x\" };",
    );
    assert!(problems(&output).is_empty(), "{output}");
    assert!(
        output.ends_with("\nexport { __styled_Button__0 as __styled_ui$2d$button__0, __styled_Button__0$0 as __styled_ui$2d$button__0$0, __styled_Button__0 as __styled_$24$x__0, __styled_Button__0$0 as __styled_$24$x__0$0 };\n"),
        "{output}"
    );

    let dir = temp_dir("string-export");
    std::fs::write(
        dir.join("base.tsx"),
        "import { styled } from '@plumeria/react';\nconst Base = styled.button({ color: (p) => p.c });\nexport { Base as \"ui-button\" };",
    )
    .unwrap();
    let file = dir.join("ghost.tsx");
    let output = desugar(
        "import { styled } from '@plumeria/react';\nimport { \"ui-button\" as Base } from './base';\nexport const Ghost = styled(Base)({ fontSize: 2 });",
        file.to_str().unwrap(),
        "sx",
    )
    .unwrap()
    .unwrap();
    assert!(problems(&output).is_empty(), "{output}");
    assert!(
        output.contains("import { __styled_ui$2d$button__0 as __styled_Ghost__0, __styled_ui$2d$button__0$0 as __styled_Ghost__0$0 } from './base';"),
        "{output}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn ts_barrels_parse_without_jsx() {
    let dir = temp_dir("ts-barrel");
    std::fs::write(dir.join("button.tsx"), STYLED_BUTTON).unwrap();
    std::fs::write(
        dir.join("index.ts"),
        "export const id = (x: unknown) => <string>x;\nexport { Button } from './button';",
    )
    .unwrap();
    let output = ghost_through(&dir, "./index", "Button").unwrap();
    assert!(output.contains("} from './button.tsx';"), "{output}");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn unparsable_barrels_are_named() {
    let dir = temp_dir("broken-barrel");
    std::fs::write(dir.join("button.tsx"), STYLED_BUTTON).unwrap();
    let barrel = dir.join("index.ts");
    std::fs::write(
        &barrel,
        "export const = 1;\nexport { Button } from './button';",
    )
    .unwrap();
    let message = ghost_through(&dir, "./index", "Button").unwrap_err();
    assert!(
        message.contains(&format!("Cannot read \"{}\"", barrel.display())),
        "{message}"
    );
    assert!(!message.contains("is not a styled component"), "{message}");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn default_exports_can_be_extended() {
    let dir = temp_dir("default-export");
    std::fs::write(
        dir.join("button.tsx"),
        "import { styled } from '@plumeria/react';\nconst Button = styled.button({ color: (p) => p.c });\nexport default Button;",
    )
    .unwrap();
    std::fs::write(
        dir.join("index.ts"),
        "export { default as Button } from './button';",
    )
    .unwrap();
    let file = dir.join("ghost.tsx");
    let output = desugar(
        "import { styled } from '@plumeria/react';\nimport Button from './button';\nexport const Ghost = styled(Button)({ fontSize: 2 });",
        file.to_str().unwrap(),
        "sx",
    )
    .unwrap()
    .unwrap();
    assert!(problems(&output).is_empty(), "{output}");
    assert!(
        output.contains("import { __styled_default__0 as __styled_Ghost__0, __styled_default__0$0 as __styled_Ghost__0$0 } from './button';"),
        "{output}"
    );
    let output = ghost_through(&dir, "./index", "Button").unwrap();
    assert!(
        output.contains("__styled_default__0 as __styled_Ghost__0"),
        "{output}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn anonymous_default_exports_ask_for_a_name() {
    let message = fail(
        "import { styled } from '@plumeria/react';\nexport default styled.a({ color: 'red' });",
    );
    assert!(
        message.contains("A default export of styled needs a name"),
        "{message}"
    );
}

#[test]
fn default_re_exports_of_imports_are_followed() {
    let dir = temp_dir("default-re-export");
    std::fs::write(
        dir.join("button.tsx"),
        "import { styled } from '@plumeria/react';\nconst Button = styled.button({ color: 'red' });\nexport default Button;",
    )
    .unwrap();
    std::fs::write(
        dir.join("index.ts"),
        "import Button from './button';\nexport default Button;",
    )
    .unwrap();
    let file = dir.join("ghost.tsx");
    let output = desugar(
        "import { styled } from '@plumeria/react';\nimport Button from './index';\nexport const Ghost = styled(Button)({ fontSize: 2 });",
        file.to_str().unwrap(),
        "sx",
    )
    .unwrap()
    .unwrap();
    assert!(
        output.contains("import { __styled_default__0 as __styled_Ghost__0 } from './button.tsx';"),
        "{output}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn keyed_variants_reach_the_receiver() {
    let dir = temp_dir("keyed-variant");
    let output = transform(
        &dir,
        "pick.tsx",
        "import * as css from '@plumeria/core';\nimport { styled } from '@plumeria/react';\nconst styles = css.create({ primary: { color: 'blue' }, danger: { color: 'red' } });\nconst Button = styled.button({ color: 'black' });\nexport const Pick = ({ tone }) => <Button sx={styles[tone]} />;\nexport const Both = ({ tone, on }) => <Button sx={[on && styles.primary, styles[tone]]} />;\nexport const Base = ({ p }) => <Button sx={[styles.primary, styles[p.tone]]} />;",
    )
    .unwrap();
    let primary = r#""primary":"x1nt3wzl","danger":"xdeb8kup"}"#;
    assert!(
        output.contains(&format!(
            "<Button sx={{({{__proto__:null,{primary}[tone] ?? \"xfcx1sty\")}} />"
        )),
        "{output}"
    );
    assert!(
        output.contains(&format!(
            "<Button sx={{({{__proto__:null,{primary}[p.tone] ?? \"x1nt3wzl\")}} />"
        )),
        "{output}"
    );
    assert!(
        output.contains(&format!(
            "<Button sx={{((on) ? ({{__proto__:null,{primary}[tone] ?? \"x1nt3wzl\") : ({{__proto__:null,{primary}[tone] ?? \"xfcx1sty\"))}} />"
        )),
        "{output}"
    );
    assert!(!output.contains("String("), "{output}");
    assert!(!output.contains("<Button className="), "{output}");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn received_styles_cannot_be_relayed() {
    let dir = temp_dir("relay");
    let head = "import * as css from '@plumeria/core';\nimport { styled } from '@plumeria/react';\nconst styles = css.create({ base: { padding: 8 }, danger: { color: 'red' } });\nconst Button = styled.button({ color: 'black' });\n";
    for (index, (body, prop, target)) in [
        (
            "const Card = ({ styleArray }) => <Button sx={styleArray} />;\nexport const App = () => <Card styleArray={styles.danger} />;",
            "styleArray",
            "Button",
        ),
        (
            "const Card = ({ styleArray }) => <Button sx={[styles.base, styleArray]} />;",
            "styleArray",
            "Button",
        ),
        ("const Card = ({ styleArray }) => <Button sx={styleArray} />;", "styleArray", "Button"),
        ("const Card = ({ sx }) => <Button sx={sx} />;", "sx", "Button"),
        (
            "const Plain = ({ sx }) => <button sx={sx} />;\nconst Card = ({ styleArray }) => <Plain sx={styleArray} />;",
            "styleArray",
            "Plain",
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let message = transform(&dir, &format!("relay{index}.tsx"), &format!("{head}{body}")).unwrap_err();
        assert!(
            message.contains(&format!(
                "\"{prop}\" is a style received through a prop, so it cannot be passed on to <{target}>, which takes sx too. Pass the style to <{target} sx={{...}} /> where it is chosen"
            )),
            "{body}\n{message}"
        );
    }
    for (index, body) in [
        "export const Card = ({ tone }) => <Button sx={styles[tone]} />;",
        "export const Card = ({ on }) => <Button sx={[styles.base, on && styles.danger]} />;",
        "const local = styles.danger;\nexport const Card = () => <Button sx={local} />;",
        "export const Card = ({ styleArray }) => <button sx={styleArray} />;",
    ]
    .into_iter()
    .enumerate()
    {
        transform(
            &dir,
            &format!("allowed{index}.tsx"),
            &format!("{head}{body}"),
        )
        .unwrap_or_else(|message| panic!("{body}\n{message}"));
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn dynamic_arguments_keep_their_order() {
    let dir = temp_dir("argument-order");
    let head = "import * as css from '@plumeria/core';\nimport { styled } from '@plumeria/react';\nconst styles = css.create({ base: { padding: 8 }, danger: { color: 'red' }, width: (w) => ({ width: w }) });\nconst Button = styled.button({ color: 'black' });\n";
    let later = transform(
        &dir,
        "later.tsx",
        &format!("{head}export const A = ({{ tone, flags }}) => <Button sx={{[styles[tone], styles.width(readWidth()), flags.on && styles.base]}} />;"),
    )
    .unwrap();
    assert!(
        later.contains(
            r#")({__proto__:null,"base":0,"danger":1}[tone], (readWidth()), (flags.on))} />"#
        ) && later.matches("readWidth()").count() == 1,
        "{later}"
    );
    let earlier = transform(
        &dir,
        "earlier.tsx",
        &format!("{head}export const B = ({{ tone }}) => <Button sx={{[styles.width(readWidth()), styles[tone]]}} />;"),
    )
    .unwrap();
    assert!(
        earlier.contains(")((readWidth()), (tone))} />")
            && earlier.matches("readWidth()").count() == 1,
        "{earlier}"
    );
    let guarded = transform(
        &dir,
        "guarded.tsx",
        &format!("{head}export const D = ({{ c, flags }}) => <Button sx={{[c ? styles.width(readWidth()) : null, flags.on && styles.base]}} />;"),
    )
    .unwrap();
    assert!(
        guarded.contains("<Button sx={((c) ? ((__plumeria_key0, __plumeria_key1) => ")
            && guarded.contains(")((readWidth()), (flags.on)) : ((flags.on) ? "),
        "{guarded}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn guards_stay_in_their_own_scope() {
    let dir = temp_dir("guard-scope");
    let head = "import * as css from '@plumeria/core';\nimport { styled } from '@plumeria/react';\nconst styles = css.create({ base: { padding: 8 }, danger: { color: 'red' } });\nconst Button = styled.button({ color: 'black' });\n";
    let awaited = transform(
        &dir,
        "awaited.tsx",
        &format!("{head}export const D = async ({{ tone }}) => <Button sx={{[styles.base, (await isEnabled()) && styles[tone]]}} />;"),
    )
    .unwrap();
    assert!(
        awaited.contains("<Button sx={(((await isEnabled())) ? ({__proto__:null,"),
        "{awaited}"
    );
    assert!(!awaited.contains("=>  ("), "{awaited}");
    let keyed_first = transform(
        &dir,
        "keyed.tsx",
        &format!("{head}export const E = ({{ tone, on }}) => <Button sx={{[styles[tone], on && styles.base]}} />;"),
    )
    .unwrap();
    assert!(
        keyed_first.contains("<Button sx={((__plumeria_key0, __plumeria_key1) => (__plumeria_key0 === 0 ? ((__plumeria_key1) ? ")
            && keyed_first.contains(r#")({__proto__:null,"base":0,"danger":1}[tone], (on))} />"#),
        "{keyed_first}"
    );
    let late = transform(
        &dir,
        "late.tsx",
        &format!("{head}export const F = async ({{ tone }}) => <Button sx={{[styles[tone], (await isEnabled()) && styles.base]}} />;"),
    )
    .unwrap();
    assert!(
        late.contains(
            r#")({__proto__:null,"base":0,"danger":1}[tone], ((await isEnabled())))} />"#
        ),
        "{late}"
    );
    let early = transform(
        &dir,
        "early.tsx",
        &format!("{head}export const G = async ({{ tone, on }}) => <Button sx={{[(await ready()) && styles.base, styles[tone], on && styles.base]}} />;"),
    )
    .unwrap();
    assert!(
        early.contains("<Button sx={(((await ready())) ? ((__plumeria_key0, __plumeria_key1) => ")
            && early.contains(r#"[tone], (on)))} />"#),
        "{early}"
    );
    let ordered = transform(
        &dir,
        "ordered.tsx",
        &format!("{head}export const O = ({{ tone, enabled, p, flags }}) => <Button sx={{[styles[tone], enabled && styles[p.key], flags.on && styles.base]}} />;"),
    )
    .unwrap();
    assert!(
        ordered.contains(r#"<Button sx={((__plumeria_key0, __plumeria_key1) => "#)
            && ordered.contains(r#"[p.key], (flags.on)) : ((flags.on) ? "#)
            && ordered.contains(r#"[tone], (enabled))} />"#),
        "{ordered}"
    );
    let message = transform(
        &dir,
        "nested.tsx",
        &format!("{head}export const H = async ({{ tone, c }}) => <Button sx={{[styles[tone], c ? (await ready()) && styles.base : null]}} />;"),
    )
    .unwrap_err();
    assert!(
        message.contains("This sx value awaits or yields in a condition read only after choosing a style by the key tone"),
        "{message}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}
