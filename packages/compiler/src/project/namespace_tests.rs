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
        style_prop: "classStyle".into(),
        class_prop: "className".into(),
        policy: None,
        is_dev: false,
        cwd,
    }
}

const TOKENS: &str = "import * as css from '@plumeria/core';\nexport const blue = css.createStatic({ '500': '#3b82f6' });\n";

#[test]
fn finds_namespace_imports_without_parsing() {
    assert_eq!(
        namespace_imports(
            "import * as css from '@plumeria/core';\nimport*as t from\"./tokens\";\nimport * as\n  u\n  from './u';"
        ),
        vec![("css", "@plumeria/core"), ("t", "./tokens"), ("u", "./u")]
    );
    assert!(
        namespace_imports(
            "import type * as t from './tokens';\nimport { a } from './a';\nconst x = a * as;"
        )
        .is_empty()
    );
}

#[test]
fn reads_a_file_once_per_source_and_exports() {
    let dir = fixture("namespace", &[("tokens.ts", "export const a = 1;\n")]);
    let tokens = dir.join("tokens.ts");
    let app = dir.join("app.tsx").to_string_lossy().into_owned();
    let mut project = Project::default();

    let core = "import * as css from '@plumeria/core';\nconst s = css.create({});\n";
    assert!(project.expand_namespaces(&app, core).is_none());
    assert!(project.namespace_cache.0.is_empty());

    let source = "import * as t from './tokens';\nconsole.log(t.a, t.b);\n";
    let first = project.expand_namespaces(&app, source).unwrap();
    assert!(first.source.contains("console.log(t$a, t.b);"));
    let second = project.expand_namespaces(&app, source).unwrap();
    assert!(Arc::ptr_eq(&first, &second));

    std::fs::write(&tokens, "export const a = 1;\nexport const b = 2;\n").unwrap();
    let third = project.expand_namespaces(&app, source).unwrap();
    assert!(!Arc::ptr_eq(&first, &third));
    assert!(third.source.contains("console.log(t$a, t$b);"));
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
                "import * as css from '@plumeria/core';\nimport * as t from './tokens';\nconst s = css.create({ a: { color: t.blue[500] } });\nexport const A = () => <div classStyle={s.a} />;\n",
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
                "import * as css from '@plumeria/core';\nimport { blue } from './tokens';\nconst s = css.create({ a: { color: blue[500] } });\nexport const A = () => <div classStyle={s.a} />;\n",
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

#[test]
fn names_a_namespace_read_in_a_message_as_written() {
    let namespaces = Namespaces {
        source: String::new(),
        original_len: 0,
        separated: false,
        imports: vec![NamespaceImport {
            local: "t".into(),
            span: Span::default(),
            appended: Span::default(),
            unused: true,
            dots: Vec::new(),
            bindings: vec!["t$n".into(), "t$nn".into()],
        }],
    };
    assert_eq!(
        as_written(Some(&namespaces), "(t$n) (t$nn[0]) (at$n) (t$no)".into()),
        "(t.n) (t.nn[0]) (at$n) (t$no)"
    );
}
