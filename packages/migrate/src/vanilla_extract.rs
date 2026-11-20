use std::fs;
use std::process::ExitCode;

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::cascade::{rank, unrepresentable, Write};
use crate::consumer::{mentions, Sheet};
use crate::resolve::{basename, Paths};
use crate::stylesheet::{kebab, quote, Converted, Report};
use crate::stylex::position;
use crate::{apply, finish, walk as walk_files, Options};

const PACKAGE: &str = "@vanilla-extract/css";
const HEADER: &str = "import * as css from '@plumeria/core';";

pub fn is_sheet(path: &str) -> bool {
    path.ends_with(".css.ts") || path.ends_with(".css.js")
}

pub fn target_of(path: &str) -> String {
    match path.strip_suffix(".css.ts") {
        Some(stem) => format!("{stem}.styles.ts"),
        None => format!("{}.styles.js", path.strip_suffix(".css.js").unwrap_or(path)),
    }
}

fn hint(kind: &str) -> &'static str {
    match kind {
        "unsupported-api" | "unsupported-import" => {
            "Only style, styleVariants and keyframes are converted. Move the rest out by hand, then run again."
        }
        "sheet-import" | "imported-by-sheet" => {
            "Stylesheets that import each other are left together. Inline the shared part, then run again."
        }
        "style-reference" => "A style is read outside style(). Plumeria reads styles only through sx.",
        "variant-composition" | "composition-item" => {
            "Only local styles compose. Spell the variant out as an object, or pass both at the call site."
        }
        "rank-order" => "Plumeria ranks this property above the one written after it. Write the higher-ranked one last.",
        "css-binding-taken" | "styles-binding-taken" => "The name is taken in this file. Rename it, then run again.",
        _ => "This is not carried over. Rewrite it by hand, then run again.",
    }
}

fn key_name(key: &PropertyKey) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(name) => Some(name.name.to_string()),
        PropertyKey::StringLiteral(literal) => literal.value.as_str().map(str::to_string),
        _ => None,
    }
}

fn split_top(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut start = 0;
    for (index, c) in text.char_indices() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                parts.push(text[start..index].trim());
                start = index + 1;
            }
            _ => {}
        }
    }
    parts.push(text[start..].trim());
    parts
}

#[derive(Default)]
struct Block {
    decls: Vec<(String, String, String)>,
    children: Vec<(String, Block)>,
}

impl Block {
    fn child(&mut self, key: &str) -> &mut Block {
        let index = match self.children.iter().position(|(k, _)| k == key) {
            Some(index) => index,
            None => {
                self.children.push((key.to_string(), Block::default()));
                self.children.len() - 1
            }
        };
        &mut self.children[index].1
    }

    fn slot(&mut self, place: &Place) -> &mut Block {
        let mut block = self;
        if let Some(at) = &place.at {
            block = block.child(at);
        }
        if !place.pseudo.is_empty() {
            block = block.child(&place.pseudo);
        }
        block
    }

    fn set(&mut self, name: String, key: String, value: String) {
        match self.decls.iter_mut().find(|(n, _, _)| *n == name) {
            Some(decl) => decl.2 = value,
            None => self.decls.push((name, key, value)),
        }
    }

    fn render(&self, depth: usize, out: &mut String) {
        let pad = "  ".repeat(depth + 1);
        out.push_str("{\n");
        for (_, key, value) in &self.decls {
            out.push_str(&format!("{pad}{key}: {value},\n"));
        }
        for (key, child) in &self.children {
            out.push_str(&format!("{pad}{}: ", quote(key)));
            child.render(depth + 1, out);
            out.push_str(",\n");
        }
        out.push_str(&format!("{}}}", "  ".repeat(depth)));
    }
}

fn render_create(entries: &[(String, Block)]) -> String {
    let mut out = String::from("css.create({\n");
    for (key, block) in entries {
        out.push_str(&format!("  {key}: "));
        block.render(1, &mut out);
        out.push_str(",\n");
    }
    out.push_str("})");
    out
}

#[derive(Clone, Default)]
struct Place {
    at: Option<String>,
    pseudo: String,
}

struct Convert<'s> {
    text: &'s str,
    scoping: &'s Scoping,
    api: FxHashMap<SymbolId, String>,
    namespaces: FxHashSet<SymbolId>,
    styles: FxHashMap<SymbolId, String>,
    out: Converted,
    wrote: usize,
}

impl Convert<'_> {
    fn report(&mut self, at: u32, kind: &'static str, source: impl Into<String>) {
        let (line, column) = position(self.text, at);
        self.out.reports.push(Report { line, column, kind, source: source.into(), hint: hint(kind).to_string(), blocking: true });
    }

    fn slice(&self, span: Span) -> String {
        self.text[span.start as usize..span.end as usize].to_string()
    }

    fn symbol(&self, identifier: &IdentifierReference) -> Option<SymbolId> {
        self.scoping.get_reference(identifier.reference_id()).symbol_id()
    }

    fn api_of(&self, callee: &Expression) -> Option<String> {
        match callee.get_inner_expression() {
            Expression::Identifier(identifier) => self.symbol(identifier).and_then(|s| self.api.get(&s).cloned()),
            Expression::StaticMemberExpression(member) => match &member.object {
                Expression::Identifier(object) if self.symbol(object).is_some_and(|s| self.namespaces.contains(&s)) => {
                    Some(member.property.name.to_string())
                }
                _ => None,
            },
            _ => None,
        }
    }

    fn plain(&self, expression: &Expression) -> bool {
        match expression.get_inner_expression() {
            Expression::StringLiteral(_) | Expression::NumericLiteral(_) => true,
            Expression::Identifier(identifier) => self.symbol(identifier).is_none_or(|s| {
                !self.styles.contains_key(&s) && !self.api.contains_key(&s) && !self.namespaces.contains(&s)
            }),
            Expression::TemplateLiteral(template) => template.expressions.iter().all(|e| self.plain(e)),
            Expression::StaticMemberExpression(member) => self.plain(&member.object),
            Expression::UnaryExpression(unary) => {
                unary.operator == UnaryOperator::UnaryNegation
                    && matches!(unary.argument.get_inner_expression(), Expression::NumericLiteral(_))
            }
            _ => false,
        }
    }

    fn rule(&mut self, object: &ObjectExpression, key: &str, place: &Place, block: &mut Block) {
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                self.report(property.span().start, "spread", "...");
                continue;
            };
            let Some(name) = key_name(&property.key).filter(|_| !property.computed) else {
                self.report(property.span.start, "computed-key", self.slice(property.key.span()));
                continue;
            };
            let at = property.span.start;
            let inner = match property.value.get_inner_expression() {
                Expression::ObjectExpression(inner) => Some(&**inner),
                _ => None,
            };
            if name == "selectors" || name.starts_with(':') {
                let entries: Vec<(String, &Expression)> = if name == "selectors" {
                    let Some(inner) = inner else {
                        self.report(at, "selectors-value", name);
                        continue;
                    };
                    let mut entries = Vec::new();
                    for selector in &inner.properties {
                        let ObjectPropertyKind::ObjectProperty(selector) = selector else {
                            self.report(selector.span().start, "spread", "...");
                            continue;
                        };
                        match key_name(&selector.key).filter(|_| !selector.computed) {
                            Some(text) => entries.push((text, &selector.value)),
                            None => self.report(selector.span.start, "computed-key", self.slice(selector.key.span())),
                        }
                    }
                    entries
                } else {
                    vec![(format!("&{name}"), &property.value)]
                };
                for (selector, value) in entries {
                    let Expression::ObjectExpression(body) = value.get_inner_expression() else {
                        self.report(value.span().start, "selector-value", selector);
                        continue;
                    };
                    for part in split_top(&selector) {
                        let rest = part.strip_prefix('&').unwrap_or_default();
                        let fits = rest.starts_with([':', '['])
                            && !rest.contains(['&', ' ', '>', '+', '~'])
                            && !(place.pseudo.contains("::") && !rest.is_empty());
                        if !fits {
                            self.report(value.span().start, "unsupported-selector", part);
                            continue;
                        }
                        let next = Place { pseudo: format!("{}{rest}", place.pseudo), ..place.clone() };
                        self.rule(body, key, &next, block);
                    }
                }
            } else if name.starts_with('@') {
                if !["@media", "@supports", "@container"].contains(&name.as_str()) {
                    self.report(at, "unsupported-at-rule", name);
                    continue;
                }
                if place.at.is_some() {
                    self.report(at, "nested-at-rule", name);
                    continue;
                }
                let Some(inner) = inner else {
                    self.report(at, "at-rule-value", name);
                    continue;
                };
                for query in &inner.properties {
                    let ObjectPropertyKind::ObjectProperty(query) = query else {
                        self.report(query.span().start, "spread", "...");
                        continue;
                    };
                    let Some(condition) = key_name(&query.key).filter(|_| !query.computed) else {
                        self.report(query.span.start, "computed-key", self.slice(query.key.span()));
                        continue;
                    };
                    let Expression::ObjectExpression(body) = query.value.get_inner_expression() else {
                        self.report(query.span.start, "at-rule-value", condition);
                        continue;
                    };
                    let next = Place { at: Some(format!("{name} {condition}")), ..place.clone() };
                    self.rule(body, key, &next, block);
                }
            } else if name == "vars" || name.starts_with("--") {
                self.report(at, "vars", name);
            } else if !self.plain(&property.value) {
                let kind = match property.value.get_inner_expression() {
                    Expression::ArrayExpression(_) => "fallback-value",
                    _ => "dynamic-value",
                };
                self.report(property.value.span().start, kind, name);
            } else {
                let css = kebab(&name);
                self.out.writes.entry(key.to_string()).or_default().push(Write {
                    rank: rank(&css, place.at.is_some()),
                    property: css,
                    suffix: place.pseudo.clone(),
                    place: self.wrote,
                });
                self.wrote += 1;
                let written = self.slice(property.key.span());
                let value = self.slice(property.value.span());
                block.slot(place).set(name, written, value);
            }
        }
    }

    fn style(&mut self, call: &CallExpression, key: &str) -> Block {
        let mut block = Block::default();
        let fits = match call.arguments.as_slice() {
            [_] => true,
            [_, debug] => matches!(debug.as_expression(), Some(Expression::StringLiteral(_))),
            _ => false,
        };
        let argument = call.arguments.first().and_then(|a| a.as_expression()).filter(|_| fits);
        match argument.map(Expression::get_inner_expression) {
            Some(Expression::ObjectExpression(object)) => self.rule(object, key, &Place::default(), &mut block),
            Some(Expression::ArrayExpression(array)) => {
                for element in &array.elements {
                    match element.as_expression().map(Expression::get_inner_expression) {
                        Some(Expression::ObjectExpression(object)) => {
                            self.rule(object, key, &Place::default(), &mut block)
                        }
                        Some(Expression::Identifier(identifier))
                            if let Some(base) = self.symbol(identifier).and_then(|s| self.styles.get(&s).cloned()) =>
                        {
                            self.out.composes.entry(key.to_string()).or_default().push(base)
                        }
                        _ => self.report(element.span().start, "composition-item", self.slice(element.span())),
                    }
                }
            }
            _ => self.report(call.span.start, "style-argument", key),
        }
        block
    }

    fn variants(&mut self, call: &CallExpression, group: &str) -> String {
        let mut entries = Vec::new();
        let object = match call.arguments.as_slice() {
            [argument] => match argument.as_expression().map(Expression::get_inner_expression) {
                Some(Expression::ObjectExpression(object)) => Some(object),
                _ => None,
            },
            _ => None,
        };
        let Some(object) = object else {
            self.report(call.span.start, "variant-map", group);
            return String::new();
        };
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                self.report(property.span().start, "spread", "...");
                continue;
            };
            let Some(name) = key_name(&property.key).filter(|_| !property.computed) else {
                self.report(property.span.start, "computed-key", self.slice(property.key.span()));
                continue;
            };
            if name.contains(|c: char| c.is_whitespace() || ">+~,&".contains(c)) {
                self.report(property.span.start, "key-not-selector", name);
                continue;
            }
            let Expression::ObjectExpression(body) = property.value.get_inner_expression() else {
                self.report(property.value.span().start, "variant-composition", name);
                continue;
            };
            let mut block = Block::default();
            self.rule(body, &format!("{group}.{name}"), &Place::default(), &mut block);
            entries.push((self.slice(property.key.span()), block));
        }
        render_create(&entries)
    }

    fn frames(&mut self, call: &CallExpression) {
        let object = match call.arguments.as_slice() {
            [argument] | [argument, _] => match argument.as_expression().map(Expression::get_inner_expression) {
                Some(Expression::ObjectExpression(object)) => Some(object),
                _ => None,
            },
            _ => None,
        };
        let flat = object.is_some_and(|object| {
            object.properties.iter().all(|frame| {
                let ObjectPropertyKind::ObjectProperty(frame) = frame else { return false };
                let Expression::ObjectExpression(body) = frame.value.get_inner_expression() else { return false };
                !frame.computed
                    && body.properties.iter().all(|decl| {
                        matches!(decl, ObjectPropertyKind::ObjectProperty(decl) if !decl.computed && key_name(&decl.key).is_some() && self.plain(&decl.value))
                    })
            })
        });
        if !flat || call.arguments.len() > 1 {
            self.report(call.span.start, "keyframes-value", "keyframes");
        }
    }
}

impl<'a> Visit<'a> for Convert<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(symbol) = self.symbol(identifier) else { return };
        if let Some(name) = self.api.get(&symbol).cloned() {
            self.report(identifier.span.start, "unsupported-api", name);
        } else if self.namespaces.contains(&symbol) {
            self.report(identifier.span.start, "unsupported-api", identifier.name.to_string());
        } else if self.styles.contains_key(&symbol) {
            self.report(identifier.span.start, "style-reference", identifier.name.to_string());
        }
    }
}

fn declaration_of<'b, 'a>(statement: &'b Statement<'a>) -> Option<&'b VariableDeclaration<'a>> {
    match statement {
        Statement::VariableDeclaration(declaration) => Some(declaration),
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::VariableDeclaration(declaration) => Some(declaration),
            _ => None,
        },
        _ => None,
    }
}

fn single_call<'b, 'a>(declaration: &'b VariableDeclaration<'a>) -> Option<(&'b BindingIdentifier<'a>, &'b CallExpression<'a>)> {
    let [declarator] = declaration.declarations.as_slice() else { return None };
    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else { return None };
    let Some(Expression::CallExpression(call)) = declarator.init.as_ref().map(|e| e.get_inner_expression()) else {
        return None;
    };
    Some((identifier, call))
}

fn through_newline(text: &str, span: Span) -> (u32, u32, String) {
    let end = if text[span.end as usize..].starts_with('\n') { span.end + 1 } else { span.end };
    (span.start, end, String::new())
}

pub fn convert(file: &str, text: &str) -> Converted {
    let mut out = Converted::default();
    let Ok(source_type) = SourceType::from_path(file) else { return out };
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, source_type).parse();
    if parsed.fatal_error || !parsed.diagnostics.is_empty() {
        out.reports.push(Report {
            line: 0,
            column: 0,
            kind: "parse-error",
            source: file.to_string(),
            hint: hint("parse-error").to_string(),
            blocking: true,
        });
        return out;
    }
    let program = &parsed.program;
    let semantic = SemanticBuilder::new().build(program).semantic;
    let scoping = semantic.scoping();
    let mut convert = Convert {
        text,
        scoping,
        api: FxHashMap::default(),
        namespaces: FxHashSet::default(),
        styles: FxHashMap::default(),
        out,
        wrote: 0,
    };

    let mut edits: Vec<(u32, u32, String)> = Vec::new();
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else { continue };
        let source = declaration.source.value.as_str().unwrap_or_default();
        if source == PACKAGE {
            for specifier in declaration.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(named) => {
                        if let Some(symbol) = named.local.symbol_id.get() {
                            convert.api.insert(symbol, named.imported.name().to_string());
                        }
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                        convert.namespaces.extend(default.local.symbol_id.get())
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                        convert.namespaces.extend(namespace.local.symbol_id.get())
                    }
                }
            }
            if edits.is_empty() {
                edits.push((declaration.span.start, declaration.span.end, HEADER.to_string()));
            } else {
                edits.push(through_newline(text, declaration.span));
            }
        } else if source.starts_with("@vanilla-extract/") {
            convert.report(declaration.span.start, "unsupported-import", source);
        } else if source.split(['?', '#']).next().unwrap_or(source).ends_with(".css") {
            convert.report(declaration.span.start, "sheet-import", source);
        }
    }
    for name in ["css", "styles"] {
        if scoping.symbol_names().any(|taken| taken == name) {
            convert.report(0, if name == "css" { "css-binding-taken" } else { "styles-binding-taken" }, name);
        }
    }

    for statement in &program.body {
        let Some((identifier, call)) = declaration_of(statement).and_then(single_call) else { continue };
        if convert.api_of(&call.callee).as_deref() == Some("style")
            && let Some(symbol) = identifier.symbol_id.get()
        {
            convert.styles.insert(symbol, identifier.name.to_string());
        }
    }

    let mut entries: Vec<(String, Block)> = Vec::new();
    let mut style_spans: Vec<Span> = Vec::new();
    let mut variants: Vec<String> = Vec::new();
    for statement in &program.body {
        if matches!(statement, Statement::ImportDeclaration(_)) {
            continue;
        }
        let found = declaration_of(statement).and_then(single_call);
        let api = found.and_then(|(_, call)| convert.api_of(&call.callee));
        let (Some((identifier, call)), Some(api)) = (found, api) else {
            convert.visit_statement(statement);
            continue;
        };
        let name = identifier.name.to_string();
        match api.as_str() {
            "style" => {
                let block = convert.style(call, &name);
                entries.push((name, block));
                style_spans.push(statement.span());
            }
            "styleVariants" => {
                let created = convert.variants(call, &name);
                edits.push((call.span.start, call.span.end, created));
                variants.push(name);
            }
            "keyframes" => {
                convert.frames(call);
                let callee = call.callee.span();
                edits.push((callee.start, callee.end, "css.keyframes".to_string()));
            }
            _ => convert.report(call.span.start, "unsupported-api", api),
        }
    }

    let mut out = std::mem::take(&mut convert.out);
    for (place, (key, _)) in entries.iter().enumerate() {
        out.order.insert(key.clone(), place);
        out.names.insert(key.clone(), key.clone());
    }
    for (place, group) in variants.into_iter().enumerate() {
        out.order.insert(group.clone(), entries.len() + place);
        out.variants.insert(group);
    }
    let mut ranked: Vec<&String> = out.writes.keys().collect();
    ranked.sort();
    let mut late = Vec::new();
    for key in ranked {
        let writes = &out.writes[key];
        if let Some((_, later)) = unrepresentable(writes, writes) {
            late.push(format!("{key}: {}", later.property));
        }
    }
    for source in late {
        out.reports.push(Report { line: 0, column: 0, kind: "rank-order", source, hint: hint("rank-order").to_string(), blocking: true });
    }

    if let Some((last, rest)) = style_spans.split_last() {
        for span in rest {
            edits.push(through_newline(text, *span));
        }
        edits.push((last.start, last.end, format!("export const styles = {};", render_create(&entries))));
    }
    edits.sort_by_key(|(start, _, _)| *start);
    out.code = apply(text, &edits);
    out
}

pub fn run(options: &Options) -> ExitCode {
    let mut project = Vec::new();
    walk_files("", &mut project);
    let mut sheets: Vec<Sheet> = Vec::new();
    let mut texts: Vec<String> = Vec::new();
    for path in project.iter().filter(|p| is_sheet(p)) {
        let Ok(text) = fs::read_to_string(path) else { continue };
        if !text.contains(PACKAGE) {
            continue;
        }
        let mut converted = convert(path, &text);
        let target = target_of(path);
        if fs::metadata(&target).is_ok() {
            converted.reports.push(Report {
                line: 0,
                column: 0,
                kind: "target-exists",
                source: String::new(),
                hint: format!("{} already exists and was not overwritten.", basename(&target)),
                blocking: true,
            });
        }
        sheets.push(Sheet { path: path.clone(), target, converted });
        texts.push(text);
    }
    if sheets.is_empty() {
        println!("No {PACKAGE} stylesheet found.");
        return ExitCode::SUCCESS;
    }
    let paths = Paths::load(|path| fs::read_to_string(path).ok());
    let mut linked = Vec::new();
    for (i, text) in texts.iter().enumerate() {
        if !sheets[i].converted.reports.iter().any(|r| r.kind == "sheet-import") {
            continue;
        }
        for (j, sheet) in sheets.iter().enumerate() {
            if j != i && mentions(sheet, paths.as_ref(), text) {
                linked.push((j, sheets[i].path.clone()));
            }
        }
    }
    for (j, source) in linked {
        sheets[j].converted.reports.push(Report {
            line: 0,
            column: 0,
            kind: "imported-by-sheet",
            source,
            hint: hint("imported-by-sheet").to_string(),
            blocking: true,
        });
    }
    finish(options, &project, sheets)
}
