use std::sync::Arc;

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_span::{GetSpan, Span};
use oxc_syntax::reference::ReferenceId;
use oxc_syntax::symbol::SymbolId;
use rustc_hash::{FxHashMap, FxHashSet};

use super::Project;
use crate::syntax::module::CORE;
use crate::syntax::parse::parse_program;

pub struct NamespaceImport {
    pub local: String,
    pub span: Span,
    pub appended: Span,
    pub unused: bool,
    pub dots: Vec<u32>,
    pub bindings: Vec<String>,
}

pub struct Namespaces {
    pub source: String,
    pub original_len: u32,
    pub separated: bool,
    pub imports: Vec<NamespaceImport>,
}

type Target = (String, String, Vec<String>);

struct Cached {
    source: String,
    targets: Vec<Target>,
    namespaces: Option<Arc<Namespaces>>,
}

#[derive(Default)]
pub struct NamespaceCache(FxHashMap<String, Cached>);

impl Project {
    pub fn expand_namespaces(&mut self, file: &str, source: &str) -> Option<Arc<Namespaces>> {
        let mut targets: Vec<Target> = Vec::new();
        for (local, path) in namespace_imports(source) {
            if path == CORE
                || !source.contains(&format!("{local}."))
                || targets.iter().any(|(seen, _, _)| seen == path)
            {
                continue;
            }
            let Some(actual) = self.resolve_import_path(path, file) else {
                continue;
            };
            let exports = self.export_names(&actual);
            if !exports.is_empty() {
                targets.push((path.to_string(), actual, exports));
            }
        }
        if targets.is_empty() {
            return None;
        }
        if let Some(cached) = self.namespace_cache.0.get(file)
            && cached.targets == targets
            && cached.source == source
        {
            return cached.namespaces.clone();
        }
        let namespaces = expand(source, &targets).map(Arc::new);
        let cache = &mut self.namespace_cache.0;
        if cache.len() >= 4096 {
            cache.clear();
        }
        cache.insert(
            file.to_string(),
            Cached {
                source: source.to_string(),
                targets,
                namespaces: namespaces.clone(),
            },
        );
        namespaces
    }
}

pub fn as_written(namespaces: Option<&Namespaces>, message: String) -> String {
    let Some(namespaces) = namespaces else {
        return message;
    };
    let is_name = |c: char| c.is_alphanumeric() || c == '_' || c == '$';
    let mut bytes = message.clone().into_bytes();
    for import in &namespaces.imports {
        for binding in &import.bindings {
            for (at, _) in message.match_indices(binding.as_str()) {
                let end = at + binding.len();
                if !message[..at].ends_with(is_name) && !message[end..].starts_with(is_name) {
                    bytes[at + import.local.len()] = b'.';
                }
            }
        }
    }
    String::from_utf8(bytes).unwrap_or(message)
}

fn namespace_imports(source: &str) -> Vec<(&str, &str)> {
    let mut found = Vec::new();
    for (index, _) in source.match_indices("import") {
        let rest = source[index + "import".len()..].trim_start();
        let Some(rest) = rest.strip_prefix('*') else {
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix("as") else {
            continue;
        };
        if !rest.starts_with(char::is_whitespace) {
            continue;
        }
        let rest = rest.trim_start();
        let end = rest
            .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
            .unwrap_or(rest.len());
        let (local, rest) = rest.split_at(end);
        let Some(rest) = rest.trim_start().strip_prefix("from") else {
            continue;
        };
        let rest = rest.trim_start();
        let Some(quote) = rest.chars().next().filter(|c| *c == '\'' || *c == '"') else {
            continue;
        };
        if let Some(close) = rest[1..].find(quote)
            && !local.is_empty()
        {
            found.push((local, &rest[1..1 + close]));
        }
    }
    found
}

fn expand(source: &str, resolved: &[Target]) -> Option<Namespaces> {
    let allocator = Allocator::default();
    let program = parse_program(&allocator, source).ok()?;
    let semantic = SemanticBuilder::new().build(&program).semantic;
    let scoping = semantic.scoping();

    let mut targets: FxHashMap<SymbolId, (Span, String, FxHashSet<String>)> = FxHashMap::default();
    for statement in &program.body {
        let Statement::ImportDeclaration(decl) = statement else {
            continue;
        };
        if decl.import_kind.is_type() {
            continue;
        }
        let Some(ImportDeclarationSpecifier::ImportNamespaceSpecifier(spec)) = decl
            .specifiers
            .as_ref()
            .and_then(|specifiers| specifiers.first())
        else {
            continue;
        };
        let Some(symbol) = spec.local.symbol_id.get() else {
            continue;
        };
        let Some((_, _, exports)) = resolved
            .iter()
            .find(|(path, _, _)| path == decl.source.value.as_str())
        else {
            continue;
        };
        let raw = &source[decl.source.span.start as usize..decl.source.span.end as usize];
        targets.insert(
            symbol,
            (
                decl.span,
                raw.to_string(),
                exports.iter().cloned().collect(),
            ),
        );
    }
    if targets.is_empty() {
        return None;
    }
    let mut reads = Reads {
        scoping,
        targets: &targets,
        found: Vec::new(),
        kept: FxHashSet::default(),
    };
    reads.visit_program(&program);
    let bytes = source.as_bytes();
    let mut rewritten = source.as_bytes().to_vec();
    let mut names: FxHashMap<SymbolId, Vec<String>> = FxHashMap::default();
    let mut dots: FxHashMap<SymbolId, Vec<u32>> = FxHashMap::default();
    let mut rewritten_reads: FxHashSet<ReferenceId> = FxHashSet::default();
    let mut taken: FxHashMap<String, bool> = FxHashMap::default();
    for (symbol, reference, object, property, member) in &reads.found {
        let dot = object.end as usize;
        if reads.kept.contains(member)
            || bytes.get(dot) != Some(&b'.')
            || property.start as usize != dot + 1
        {
            continue;
        }
        let local = &source[object.start as usize..object.end as usize];
        let name = &source[property.start as usize..property.end as usize];
        if *taken
            .entry(format!("{local}${name}"))
            .or_insert_with_key(|binding| source.contains(binding.as_str()))
        {
            continue;
        }
        rewritten[dot] = b'$';
        rewritten_reads.insert(*reference);
        dots.entry(*symbol).or_default().push(dot as u32);
        let list = names.entry(*symbol).or_default();
        if !list.iter().any(|existing| existing == name) {
            list.push(name.to_string());
        }
    }
    if names.is_empty() {
        return None;
    }

    let mut source = String::from_utf8(rewritten).ok()?;
    let original_len = source.len() as u32;
    let separated = !source.ends_with('\n');
    if separated {
        source.push('\n');
    }
    let mut imports = Vec::new();
    let mut symbols: Vec<&SymbolId> = names.keys().collect();
    symbols.sort_by_key(|symbol| targets[symbol].0.start);
    for symbol in symbols {
        let (span, raw, _) = &targets[symbol];
        let local = scoping.symbol_name(*symbol);
        let specifiers = names[symbol]
            .iter()
            .map(|name| format!("{name} as {local}${name}"))
            .collect::<Vec<_>>()
            .join(", ");
        let start = source.len() as u32;
        source.push_str(&format!("import {{ {specifiers} }} from {raw};"));
        let unused = scoping
            .get_resolved_reference_ids(*symbol)
            .iter()
            .filter(|&&id| scoping.get_reference(id).is_value())
            .all(|id| rewritten_reads.contains(id));
        imports.push(NamespaceImport {
            local: local.to_string(),
            span: *span,
            appended: Span::new(start, source.len() as u32),
            unused,
            dots: dots.remove(symbol).unwrap_or_default(),
            bindings: names[symbol]
                .iter()
                .map(|name| format!("{local}${name}"))
                .collect(),
        });
    }
    Some(Namespaces {
        source,
        original_len,
        separated,
        imports,
    })
}

struct Reads<'s, 't> {
    scoping: &'s Scoping,
    targets: &'t FxHashMap<SymbolId, (Span, String, FxHashSet<String>)>,
    found: Vec<(SymbolId, ReferenceId, Span, Span, Span)>,
    kept: FxHashSet<Span>,
}

impl Reads<'_, '_> {
    fn keep(&mut self, expr: &Expression) {
        if let Expression::StaticMemberExpression(member) = expr.without_parentheses() {
            self.kept.insert(member.span);
        }
    }
}

impl<'a> Visit<'a> for Reads<'_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        self.keep(&it.callee);
        walk::walk_call_expression(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        self.keep(&it.tag);
        walk::walk_tagged_template_expression(self, it);
    }

    fn visit_simple_assignment_target(&mut self, it: &SimpleAssignmentTarget<'a>) {
        self.kept.insert(it.span());
        walk::walk_simple_assignment_target(self, it);
    }

    fn visit_unary_expression(&mut self, it: &UnaryExpression<'a>) {
        if it.operator.is_delete() {
            self.keep(&it.argument);
        }
        walk::walk_unary_expression(self, it);
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if !it.optional
            && let Expression::Identifier(object) = &it.object
            && let Some(reference) = object.reference_id.get()
            && let Some(symbol) = self.scoping.get_reference(reference).symbol_id()
            && let Some((_, _, exports)) = self.targets.get(&symbol)
            && exports.contains(it.property.name.as_str())
        {
            self.found
                .push((symbol, reference, object.span, it.property.span, it.span));
        }
        walk::walk_static_member_expression(self, it);
    }
}

#[cfg(test)]
#[path = "namespace_tests.rs"]
mod namespace_tests;
