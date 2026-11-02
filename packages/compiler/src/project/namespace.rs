use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::{Visit, VisitMut, walk, walk_mut};
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_span::{GetSpan, Span};
use oxc_syntax::symbol::SymbolId;
use rustc_hash::{FxHashMap, FxHashSet};

use super::Project;
use crate::syntax::module::CORE;

impl Project {
    pub fn resolve_namespace_members<'a>(
        &mut self,
        allocator: &'a Allocator,
        program: &mut Program<'a>,
        file: &str,
    ) {
        let mut paths: FxHashMap<String, String> = FxHashMap::default();
        for statement in &program.body {
            let Statement::ImportDeclaration(decl) = statement else {
                continue;
            };
            if decl.import_kind.is_type() || decl.source.value == CORE {
                continue;
            }
            for specifier in decl.specifiers.iter().flatten() {
                if let ImportDeclarationSpecifier::ImportNamespaceSpecifier(spec) = specifier
                    && let Some(actual) = self.resolve_import_path(decl.source.value.as_str(), file)
                {
                    paths.insert(spec.local.name.to_string(), actual);
                }
            }
        }
        if paths.is_empty() {
            return;
        }

        let (found, kept) = {
            let semantic = SemanticBuilder::new().build(program).semantic;
            let mut targets: FxHashMap<SymbolId, &str> = FxHashMap::default();
            for statement in &program.body {
                let Statement::ImportDeclaration(decl) = statement else {
                    continue;
                };
                for specifier in decl.specifiers.iter().flatten() {
                    if let ImportDeclarationSpecifier::ImportNamespaceSpecifier(spec) = specifier
                        && paths.contains_key(spec.local.name.as_str())
                        && let Some(symbol) = spec.local.symbol_id.get()
                    {
                        targets.insert(symbol, spec.local.name.as_str());
                    }
                }
            }
            let mut members = Members {
                scoping: semantic.scoping(),
                targets: &targets,
                found: Vec::new(),
                kept: FxHashSet::default(),
            };
            members.visit_program(program);
            (members.found, members.kept)
        };

        let mut exports: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();
        let mut names: FxHashMap<Span, &'a str> = FxHashMap::default();
        for (local, name, span) in found {
            if kept.contains(&span) {
                continue;
            }
            let exported = exports
                .entry(local.clone())
                .or_insert_with(|| self.export_names(&paths[&local]).into_iter().collect());
            if exported.contains(&name) {
                names.insert(span, allocator.alloc_str(&format!("{local}.{name}")));
            }
        }
        if names.is_empty() {
            return;
        }

        let builder = AstBuilder::new(allocator);
        let mut resolve = Resolve {
            builder: &builder,
            names: &names,
            bindings: Vec::new(),
        };
        resolve.visit_program(program);
        let bindings = resolve.bindings;

        for statement in &mut program.body {
            let Statement::ImportDeclaration(decl) = statement else {
                continue;
            };
            let Some(specifiers) = &mut decl.specifiers else {
                continue;
            };
            let Some((span, local_span, local)) =
                specifiers.iter().find_map(|specifier| match specifier {
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(spec) => {
                        Some((spec.span, spec.local.span, spec.local.name.as_str()))
                    }
                    _ => None,
                })
            else {
                continue;
            };
            let prefix = format!("{local}.");
            for binding in bindings
                .iter()
                .filter(|binding| binding.starts_with(&prefix))
            {
                let name = &binding[prefix.len()..];
                specifiers.push(ImportDeclarationSpecifier::new_import_specifier(
                    span,
                    ModuleExportName::new_identifier_name(local_span, name, &builder),
                    BindingIdentifier::new(local_span, *binding, &builder),
                    ImportOrExportKind::Value,
                    &builder,
                ));
            }
        }
    }
}

struct Members<'s, 't> {
    scoping: &'s Scoping,
    targets: &'t FxHashMap<SymbolId, &'t str>,
    found: Vec<(String, String, Span)>,
    kept: FxHashSet<Span>,
}

impl Members<'_, '_> {
    fn keep(&mut self, expr: &Expression) {
        if let Expression::StaticMemberExpression(member) = expr.without_parentheses() {
            self.kept.insert(member.span);
        }
    }
}

impl<'a> Visit<'a> for Members<'_, '_> {
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
            && let Some(local) = self.targets.get(&symbol)
        {
            self.found
                .push((local.to_string(), it.property.name.to_string(), it.span));
        }
        walk::walk_static_member_expression(self, it);
    }
}

struct Resolve<'r, 'a> {
    builder: &'r AstBuilder<'a>,
    names: &'r FxHashMap<Span, &'a str>,
    bindings: Vec<&'a str>,
}

impl<'a> VisitMut<'a> for Resolve<'_, 'a> {
    fn visit_expression(&mut self, it: &mut Expression<'a>) {
        let resolved = match it {
            Expression::StaticMemberExpression(member) => self
                .names
                .get(&member.span)
                .map(|&name| (member.span, name)),
            _ => None,
        };
        let Some((span, name)) = resolved else {
            walk_mut::walk_expression(self, it);
            return;
        };
        *it = Expression::new_identifier(span, name, self.builder);
        if !self.bindings.contains(&name) {
            self.bindings.push(name);
        }
    }
}

#[cfg(test)]
#[path = "namespace_tests.rs"]
mod namespace_tests;
