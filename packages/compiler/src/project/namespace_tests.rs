use std::path::PathBuf;

use super::*;
use crate::transform::{TransformEnv, transform_source};

fn fixture(label: &str, files: &[(&str, &str)]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "plumeria-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let dir = std::fs::canonicalize(dir).unwrap();
    for (name, source) in files {
        std::fs::write(dir.join(name), source).unwrap();
    }
    dir
}

fn env(dir: &std::path::Path, name: &str) -> TransformEnv {
    let file = dir.join(name).to_string_lossy().into_owned();
    let cwd = dir.to_string_lossy().into_owned();
    TransformEnv {
        source: std::fs::read_to_string(&file).unwrap(),
        module_id: file.clone(),
        file_path: file,
        root: cwd.clone(),
        style_prop: "sx".into(),
        class_prop: "className".into(),
        policy: None,
        is_dev: false,
        cwd,
    }
}

const TOKENS: &str = "import * as css from '@plumeria/core';\nexport const blue = css.createStatic({ '500': '#3b82f6' });\n";

fn resolved(project: &mut Project, file: &str, source: &str) -> (Vec<String>, Vec<String>) {
    let allocator = oxc_allocator::Allocator::default();
    let source = allocator.alloc_str(source);
    let mut program = crate::syntax::parse::parse_program(&allocator, source).unwrap();
    project.resolve_namespace_members(&allocator, &mut program, file);
    #[derive(Default)]
    struct Names(Vec<String>);
    impl<'a> oxc_ast_visit::Visit<'a> for Names {
        fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
            self.0.push(it.name.to_string());
        }
    }
    let mut names = Names::default();
    oxc_ast_visit::Visit::visit_program(&mut names, &program);
    let specifiers = program
        .body
        .iter()
        .filter_map(|statement| match statement {
            Statement::ImportDeclaration(decl) => decl.specifiers.as_ref(),
            _ => None,
        })
        .flatten()
        .map(|specifier| specifier.local().name.to_string())
        .collect();
    (names.0, specifiers)
}

#[test]
fn resolves_a_read_of_an_export_to_a_named_import() {
    let dir = fixture("namespace", &[("tokens.ts", "export const a = 1;\n")]);
    let tokens = dir.join("tokens.ts");
    let app = dir.join("app.tsx").to_string_lossy().into_owned();
    let mut project = Project::default();

    let source = "import * as t from './tokens';\nconst t$a = 0;\nconsole.log(t.a, t.b, t.a);\n";
    let (names, specifiers) = resolved(&mut project, &app, source);
    assert_eq!(names, ["console", "t.a", "t", "t.a"]);
    assert_eq!(specifiers, ["t", "t.a"]);

    std::fs::write(&tokens, "export const a = 1;\nexport const b = 2;\n").unwrap();
    let (names, specifiers) = resolved(&mut project, &app, source);
    assert_eq!(names, ["console", "t.a", "t.b", "t.a"]);
    assert_eq!(specifiers, ["t", "t.a", "t.b"]);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn leaves_a_read_that_is_not_a_plain_value_alone() {
    let dir = fixture(
        "namespace-kept",
        &[(
            "tokens.ts",
            "export let a = 1;\nexport const f = () => 1;\n",
        )],
    );
    let app = dir.join("app.tsx").to_string_lossy().into_owned();
    let mut project = Project::default();

    let source = "import def, * as t from './tokens';\nimport type * as u from './tokens';\nimport * as css from '@plumeria/core';\nt.f();\nt.a = 1;\nt.a++;\ndelete t.a;\nt?.a;\n[t.a] = [1];\nconst g = (t) => t.a;\ncss.create;\nt.a;\n";
    let (names, specifiers) = resolved(&mut project, &app, source);
    assert_eq!(names.iter().filter(|name| *name == "t.a").count(), 1);
    assert!(!names.iter().any(|name| name == "t.f"));
    assert!(
        !names
            .iter()
            .any(|name| name.starts_with("css.") || name.starts_with("u."))
    );
    assert_eq!(specifiers, ["def", "t", "t.a", "u", "css"]);
    std::fs::remove_dir_all(&dir).unwrap();
}

// A process whose first transform is this file has scanned nothing yet.
#[test]
fn compiles_a_namespace_read_before_anything_was_scanned() {
    let dir = fixture(
        "namespace-first",
        &[
            ("tokens.ts", TOKENS),
            (
                "app.tsx",
                "import * as css from '@plumeria/core';\nimport * as t from './tokens';\nconst s = css.create({ a: { color: t.blue[500] } });\nexport const A = () => <div sx={s.a} />;\n",
            ),
        ],
    );
    let mut project = Project::default();
    let output = transform_source(&mut project, &env(&dir, "app.tsx")).unwrap();
    assert!(output.code.contains("className={\""));
    assert!(!output.code.contains("t$blue"));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn exports_read_before_the_first_scan_leave_the_file_to_it() {
    let dir = fixture(
        "exports-first",
        &[
            ("tokens.ts", TOKENS),
            (
                "app.tsx",
                "import * as css from '@plumeria/core';\nimport { blue } from './tokens';\nconst s = css.create({ a: { color: blue[500] } });\nexport const A = () => <div sx={s.a} />;\n",
            ),
        ],
    );
    let mut project = Project::default();
    let tokens = dir.join("tokens.ts").to_string_lossy().into_owned();
    assert!(project.resolve_export(&tokens, "blue").is_some());
    let output = transform_source(&mut project, &env(&dir, "app.tsx")).unwrap();
    assert!(output.code.contains("className={\""));
    std::fs::remove_dir_all(&dir).unwrap();
}
