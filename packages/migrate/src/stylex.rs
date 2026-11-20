use std::fs;
use std::process::ExitCode;

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType};
use rustc_hash::{FxHashMap, FxHashSet};

#[path = "../../compiler/src/engine/conditional.rs"]
mod conditional;

use conditional::implies_condition;

use crate::resolve::{resolve, Paths};
use crate::stylesheet::quote;
use crate::{apply, extension, walk as walk_files, Options, SOURCES};

const PACKAGE: &str = "@stylexjs/stylex";
const TYPES: &[&str] = &["StyleXStyles", "StyleXStylesWithout", "StaticStyles", "StaticStylesWithout"];
pub(crate) const SUFFIXES: &[&str] = &[
    "", ".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js", "/index.jsx",
];
const STATE_LIMIT: usize = 64;

#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct Path {
    element: Option<String>,
    at: Option<String>,
    pseudos: Vec<String>,
}

impl Path {
    fn with_pseudos(&self, parts: &[String]) -> Path {
        let mut pseudos = self.pseudos.clone();
        pseudos.extend(parts.iter().cloned());
        pseudos.sort();
        pseudos.dedup();
        Path { pseudos, ..self.clone() }
    }

    fn describe(&self) -> String {
        let mut parts = Vec::new();
        parts.extend(self.at.clone());
        parts.extend(self.element.clone());
        if !self.pseudos.is_empty() {
            parts.push(self.pseudos.concat());
        }
        if parts.is_empty() { "default".to_string() } else { parts.join(" ") }
    }
}

struct Decl {
    prop: String,
    key: String,
    path: Path,
    value: Option<String>,
    at: u32,
}

struct Namespace {
    name: String,
    key: String,
    prefix: String,
    suffix: String,
    decls: Vec<Decl>,
    follows: bool,
}

struct Create {
    start: u32,
    end: u32,
    indent: String,
    binding: Option<SymbolId>,
    namespaces: Vec<Namespace>,
}

#[derive(Clone, Debug)]
pub struct Hold {
    pub kind: &'static str,
    pub detail: String,
    pub at: Option<u32>,
}

#[derive(Default)]
pub struct FileScan {
    stylex: bool,
    holds: Vec<Hold>,
    edits: Vec<(u32, u32, String)>,
    creates: Vec<Create>,
    imports: Vec<(String, Vec<String>, bool)>,
    style_exports: FxHashSet<String>,
    has_core: bool,
    core_insert: (u32, String),
    has_style_prop: bool,
}

fn key_name(key: &PropertyKey) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(name) => Some(name.name.to_string()),
        PropertyKey::StringLiteral(literal) => literal.value.as_str().map(str::to_string),
        _ => None,
    }
}

fn split_pseudos(text: &str) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut depth = 0usize;
    let mut previous = ' ';
    for c in text.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ':' if depth == 0 && previous != ':' => parts.push(String::new()),
            _ => {}
        }
        if let Some(last) = parts.last_mut() {
            last.push(c);
        }
        previous = c;
    }
    parts
}

fn indent_at(text: &str, offset: u32) -> String {
    let start = text[..offset as usize].rfind('\n').map_or(0, |i| i + 1);
    text[start..].chars().take_while(|c| *c == ' ' || *c == '\t').collect()
}

pub fn position(text: &str, offset: u32) -> (u32, u32) {
    let before = &text[..offset as usize];
    let line = before.matches('\n').count() as u32 + 1;
    let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) as u32 + 1;
    (line, column)
}

struct Scan<'s> {
    text: &'s str,
    scoping: &'s Scoping,
    style_prop: &'s str,
    namespaces: FxHashSet<SymbolId>,
    named: FxHashMap<SymbolId, String>,
    allowed: FxHashMap<u32, Option<SymbolId>>,
    top_level: FxHashSet<u32>,
    bindings: FxHashSet<SymbolId>,
    follow_all: FxHashSet<SymbolId>,
    follow_keys: FxHashSet<(SymbolId, String)>,
    props_arg: Option<(usize, bool)>,
    uses_css: bool,
    emits_style_prop: bool,
    holds: Vec<Hold>,
    edits: Vec<(u32, u32, String)>,
    creates: Vec<Create>,
}

impl<'s> Scan<'s> {
    fn hold(&mut self, kind: &'static str, detail: impl Into<String>, at: u32) {
        self.holds.push(Hold { kind, detail: detail.into(), at: Some(at) });
    }

    fn slice(&self, span: oxc_span::Span) -> String {
        self.text[span.start as usize..span.end as usize].to_string()
    }

    fn symbol(&self, identifier: &IdentifierReference) -> Option<SymbolId> {
        self.scoping.get_reference(identifier.reference_id()).symbol_id()
    }

    fn api(&self, callee: &Expression) -> Option<String> {
        match callee {
            Expression::StaticMemberExpression(member) => match &member.object {
                Expression::Identifier(object) if self.symbol(object).is_some_and(|s| self.namespaces.contains(&s)) => {
                    Some(member.property.name.to_string())
                }
                _ => None,
            },
            Expression::Identifier(identifier) => self.symbol(identifier).and_then(|s| self.named.get(&s).cloned()),
            _ => None,
        }
    }

    fn type_api(&self, name: &TSTypeName) -> Option<String> {
        match name {
            TSTypeName::IdentifierReference(identifier) => {
                self.symbol(identifier).and_then(|s| self.named.get(&s).cloned())
            }
            TSTypeName::QualifiedName(qualified) => match &qualified.left {
                TSTypeName::IdentifierReference(left)
                    if self.symbol(left).is_some_and(|s| self.namespaces.contains(&s)) =>
                {
                    Some(qualified.right.name.to_string())
                }
                _ => None,
            },
            _ => None,
        }
    }

    fn follows(&self) -> bool {
        !matches!(self.props_arg, Some((0, true)))
    }

    fn create(&mut self, call: &CallExpression, binding: Option<SymbolId>) {
        let [argument] = call.arguments.as_slice() else {
            return self.hold("create-argument", "stylex.create", call.span.start);
        };
        let Some(Expression::ObjectExpression(object)) = argument.as_expression() else {
            return self.hold("create-argument", "stylex.create", call.span.start);
        };
        self.uses_css = true;
        let mut namespaces = Vec::new();
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                self.hold("spread", "...", property.span().start);
                continue;
            };
            let Some(name) = key_name(&property.key).filter(|_| !property.computed) else {
                self.hold("computed-key", self.slice(property.key.span()), property.span.start);
                continue;
            };
            if name.chars().any(|c| c.is_whitespace() || ">+~,&".contains(c)) {
                self.hold("key-not-selector", name, property.span.start);
                continue;
            }
            let value = &property.value;
            let body = match value.get_inner_expression() {
                Expression::ObjectExpression(body) => Some(&**body),
                Expression::ArrowFunctionExpression(arrow) => arrow_body(arrow),
                _ => None,
            };
            let Some(body) = body else {
                self.hold("namespace-value", name, property.span.start);
                continue;
            };
            let mut decls = Vec::new();
            self.read_namespace(body, None, &mut decls);
            namespaces.push(Namespace {
                key: self.slice(property.key.span()),
                prefix: self.text[value.span().start as usize..body.span.start as usize].to_string(),
                suffix: self.text[body.span.end as usize..value.span().end as usize].to_string(),
                name,
                decls,
                follows: false,
            });
        }
        let indent = indent_at(self.text, call.span.start);
        self.creates.push(Create { start: call.span.start, end: call.span.end, indent, binding, namespaces });
    }

    fn read_namespace(&mut self, object: &ObjectExpression, element: Option<String>, decls: &mut Vec<Decl>) {
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                self.hold("spread", "...", property.span().start);
                continue;
            };
            let Some(name) = key_name(&property.key).filter(|_| !property.computed) else {
                self.hold("computed-key", self.slice(property.key.span()), property.span.start);
                continue;
            };
            if name.starts_with("::") && element.is_none() {
                match property.value.get_inner_expression() {
                    Expression::ObjectExpression(inner) => self.read_namespace(inner, Some(name), decls),
                    _ => self.hold("pseudo-element-value", name, property.span.start),
                }
            } else if name.starts_with(':') || name.starts_with('@') {
                self.hold("nested-condition", name, property.span.start);
            } else {
                let path = Path { element: element.clone(), at: None, pseudos: Vec::new() };
                let key = self.slice(property.key.span());
                self.read_value(&name, &key, &property.value, path, decls);
            }
        }
    }

    fn read_value(&mut self, prop: &str, key: &str, value: &Expression, path: Path, decls: &mut Vec<Decl>) {
        let at = value.span().start;
        match value.get_inner_expression() {
            Expression::NullLiteral(_) => {
                decls.push(Decl { prop: prop.to_string(), key: key.to_string(), path, value: None, at })
            }
            Expression::ObjectExpression(conditions) => {
                for condition in &conditions.properties {
                    let ObjectPropertyKind::ObjectProperty(condition) = condition else {
                        self.hold("spread", "...", condition.span().start);
                        continue;
                    };
                    let Some(name) = key_name(&condition.key).filter(|_| !condition.computed) else {
                        self.hold("computed-key", self.slice(condition.key.span()), condition.span.start);
                        continue;
                    };
                    let next = if name == "default" {
                        path.clone()
                    } else if name.starts_with(':') {
                        let parts = split_pseudos(&name);
                        if path.element.is_some() || parts.iter().any(|p| p.starts_with("::")) {
                            self.hold("pseudo-in-pseudo-element", name, condition.span.start);
                            continue;
                        }
                        path.with_pseudos(&parts)
                    } else if name.starts_with('@') {
                        if path.at.is_some() {
                            self.hold("nested-at-rule", name, condition.span.start);
                            continue;
                        }
                        Path { at: Some(name), ..path.clone() }
                    } else {
                        self.hold("unknown-condition", name, condition.span.start);
                        continue;
                    };
                    self.read_value(prop, key, &condition.value, next, decls);
                }
            }
            Expression::ArrayExpression(_) => self.hold("fallback-value", prop, at),
            Expression::CallExpression(_) | Expression::NewExpression(_) => self.hold("call-value", prop, at),
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                self.hold("function-value", prop, at)
            }
            _ if static_value(value) => decls.push(Decl {
                prop: prop.to_string(),
                key: key.to_string(),
                path,
                value: Some(self.slice(value.span())),
                at,
            }),
            _ => self.hold("dynamic-value", prop, at),
        }
    }

    fn props_text(&mut self, call: &CallExpression) -> Option<String> {
        let mut parts = Vec::new();
        for argument in &call.arguments {
            match argument.as_expression() {
                None => {
                    self.hold("spread-argument", "...", argument.span().start);
                    return None;
                }
                Some(Expression::ArrayExpression(array)) => {
                    self.hold("nested-array", "[...]", array.span.start);
                    return None;
                }
                Some(expression) => parts.push(self.slice(expression.span())),
            }
        }
        let prop = self.style_prop;
        Some(match parts.as_slice() {
            [] => String::new(),
            [single] => format!("{prop}={{{single}}}"),
            _ => format!("{prop}={{[{}]}}", parts.join(", ")),
        })
    }
}

fn flat_constants(call: &CallExpression) -> bool {
    let [argument] = call.arguments.as_slice() else { return false };
    let Some(Expression::ObjectExpression(object)) = argument.as_expression() else { return false };
    object.properties.iter().all(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else { return false };
        !property.computed
            && !property.method
            && !property.shorthand
            && matches!(property.key, PropertyKey::StaticIdentifier(_) | PropertyKey::StringLiteral(_))
            && matches!(property.value, Expression::StringLiteral(_) | Expression::NumericLiteral(_))
    })
}

fn flat_declarations(object: &ObjectExpression) -> bool {
    object.properties.iter().all(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else { return false };
        !property.computed
            && !property.method
            && matches!(property.key, PropertyKey::StaticIdentifier(_) | PropertyKey::StringLiteral(_))
            && static_value(&property.value)
    })
}

fn static_value(expression: &Expression) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(_) | Expression::NumericLiteral(_) | Expression::Identifier(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.iter().all(static_value),
        Expression::StaticMemberExpression(member) => static_value(&member.object),
        Expression::UnaryExpression(unary) => {
            unary.operator == UnaryOperator::UnaryNegation
                && matches!(unary.argument.get_inner_expression(), Expression::NumericLiteral(_))
        }
        _ => false,
    }
}

fn single_object<'a, 'b>(call: &'b CallExpression<'a>) -> Option<&'b ObjectExpression<'a>> {
    let [argument] = call.arguments.as_slice() else { return None };
    match argument.as_expression() {
        Some(Expression::ObjectExpression(object)) => Some(object),
        _ => None,
    }
}

fn flat_argument(call: &CallExpression) -> bool {
    single_object(call).is_some_and(flat_declarations)
}

fn flat_view_transition(call: &CallExpression) -> bool {
    single_object(call).is_some_and(|object| {
        object.properties.iter().all(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else { return false };
            !property.computed
                && key_name(&property.key).is_some_and(|k| ["group", "imagePair", "old", "new"].contains(&k.as_str()))
                && matches!(property.value.get_inner_expression(), Expression::ObjectExpression(inner) if flat_declarations(inner))
        })
    })
}

fn arrow_body<'a, 'b>(arrow: &'b ArrowFunctionExpression<'a>) -> Option<&'b ObjectExpression<'a>> {
    let expression = match &arrow.body {
        ArrowFunctionBody::FunctionBody(body) => match body.statements.as_slice() {
            [Statement::ReturnStatement(ret)] => ret.argument.as_ref()?,
            _ => return None,
        },
        other => other.as_expression()?,
    };
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => Some(object),
        _ => None,
    }
}

impl<'a> Visit<'a> for Scan<'_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some(name) = self.api(&call.callee) {
            match name.as_str() {
                "create" => match self.allowed.get(&call.span.start).copied() {
                    Some(binding) => self.create(call, binding),
                    None => self.hold("create-not-top-level", "stylex.create", call.span.start),
                },
                "keyframes" => {
                    self.uses_css = true;
                    let span = call.callee.span();
                    self.edits.push((span.start, span.end, "css.keyframes".to_string()));
                    for argument in &call.arguments {
                        self.visit_argument(argument);
                    }
                }
                "props" => self.hold("props-outside-jsx", "stylex.props", call.span.start),
                "defineConsts" | "viewTransitionClass" | "positionTry" => {
                    let (target, kind, flat) = match name.as_str() {
                        "defineConsts" => ("createStatic", "unsupported-consts", flat_constants(call)),
                        "viewTransitionClass" => {
                            ("viewTransitionClass", "unsupported-view-transition", flat_view_transition(call))
                        }
                        _ => ("positionTry", "unsupported-position-try", flat_argument(call)),
                    };
                    if !flat || !self.top_level.contains(&call.span.start) {
                        return self.hold(kind, format!("stylex.{name}"), call.span.start);
                    }
                    self.uses_css = true;
                    let span = call.callee.span();
                    self.edits.push((span.start, span.end, format!("css.{target}")));
                    for argument in &call.arguments {
                        self.visit_argument(argument);
                    }
                }
                _ => self.hold("unsupported-api", name, call.span.start),
            }
            return;
        }
        if let Expression::Identifier(callee) = &call.callee
            && callee.name.as_str() == "require"
            && let Some(Expression::StringLiteral(literal)) = call.arguments.first().and_then(|a| a.as_expression())
            && literal.value.as_str().is_some_and(|s| s.starts_with("@stylexjs/"))
        {
            self.hold("require", literal.value.as_str().unwrap_or_default(), call.span.start);
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_import_expression(&mut self, expression: &ImportExpression<'a>) {
        if let Expression::StringLiteral(literal) = &expression.source
            && literal.value.as_str().is_some_and(|s| s.starts_with("@stylexjs/"))
        {
            self.hold("dynamic-import", literal.value.as_str().unwrap_or_default(), expression.span.start);
        }
        walk::walk_import_expression(self, expression);
    }

    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        let intrinsic = matches!(element.name, JSXElementName::Identifier(_));
        let mut spreads: Vec<(usize, &CallExpression<'a>)> = Vec::new();
        let mut beside = None;
        for (index, item) in element.attributes.iter().enumerate() {
            match item {
                JSXAttributeItem::SpreadAttribute(spread) => {
                    if let Expression::CallExpression(call) = spread.argument.get_inner_expression()
                        && self.api(&call.callee).as_deref() == Some("props")
                    {
                        spreads.push((index, call));
                    }
                }
                JSXAttributeItem::Attribute(attribute) => {
                    if let JSXAttributeName::Identifier(name) = &attribute.name {
                        let name = name.name.as_str();
                        if name == "className" || name == "style" || name == self.style_prop {
                            beside = Some(name.to_string());
                        }
                    }
                }
            }
        }
        if spreads.is_empty() {
            return walk::walk_jsx_opening_element(self, element);
        }
        if spreads.len() > 1 {
            self.hold("props-twice", "stylex.props", element.span.start);
        } else if let Some(name) = beside {
            self.hold("props-beside-attribute", name, element.span.start);
        } else if let Some(text) = self.props_text(spreads[0].1) {
            self.emits_style_prop |= !text.is_empty();
            let span = element.attributes[spreads[0].0].span();
            self.edits.push((span.start, span.end, text));
        }
        self.visit_jsx_element_name(&element.name);
        if let Some(arguments) = &element.type_arguments {
            self.visit_ts_type_parameter_instantiation(arguments);
        }
        for (index, item) in element.attributes.iter().enumerate() {
            match spreads.iter().find(|(i, _)| *i == index) {
                Some((_, call)) => {
                    for (position, argument) in call.arguments.iter().enumerate() {
                        let saved = self.props_arg.replace((position, intrinsic));
                        self.visit_argument(argument);
                        self.props_arg = saved;
                    }
                }
                None => self.visit_jsx_attribute_item(item),
            }
        }
    }

    fn visit_ts_type_reference(&mut self, reference: &TSTypeReference<'a>) {
        if let Some(name) = self.type_api(&reference.type_name) {
            if TYPES.contains(&name.as_str()) {
                self.uses_css = true;
                self.edits.push((reference.span.start, reference.span.end, "css.Style".to_string()));
            } else {
                self.hold("unsupported-type", name, reference.span.start);
            }
            return;
        }
        walk::walk_ts_type_reference(self, reference);
    }

    fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
        if let Expression::Identifier(object) = &member.object
            && let Some(symbol) = self.symbol(object)
            && self.bindings.contains(&symbol)
        {
            if self.follows() {
                self.follow_keys.insert((symbol, member.property.name.to_string()));
            }
            return;
        }
        walk::walk_static_member_expression(self, member);
    }

    fn visit_computed_member_expression(&mut self, member: &ComputedMemberExpression<'a>) {
        if let Expression::Identifier(object) = &member.object
            && let Some(symbol) = self.symbol(object)
            && self.bindings.contains(&symbol)
        {
            if self.follows() {
                self.follow_all.insert(symbol);
            }
            return self.visit_expression(&member.expression);
        }
        walk::walk_computed_member_expression(self, member);
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(symbol) = self.symbol(identifier) else { return };
        if self.namespaces.contains(&symbol) || self.named.contains_key(&symbol) {
            self.hold("unsupported-use", identifier.name.to_string(), identifier.span.start);
        } else if self.bindings.contains(&symbol) {
            self.follow_all.insert(symbol);
        }
    }
}

fn imports_of(program: &Program) -> Vec<(String, Vec<String>, bool)> {
    let mut found = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::ImportDeclaration(declaration) => {
                let mut names = Vec::new();
                let mut all = false;
                for specifier in declaration.specifiers.iter().flatten() {
                    match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => names.push(named.imported.name().to_string()),
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => names.push("default".to_string()),
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => all = true,
                    }
                }
                found.push((declaration.source.value.as_str().unwrap_or_default().to_string(), names, all));
            }
            Statement::ExportFromDeclaration(declaration) => {
                let names = declaration.specifiers.iter().map(|s| s.local.name().to_string()).collect();
                found.push((declaration.source.value.as_str().unwrap_or_default().to_string(), names, false));
            }
            Statement::ExportAllDeclaration(declaration) => {
                found.push((declaration.source.value.as_str().unwrap_or_default().to_string(), Vec::new(), true));
            }
            _ => {}
        }
    }
    found
}

struct StylePropVisitor<'s> {
    name: &'s str,
    found: bool,
}

impl<'a> Visit<'a> for StylePropVisitor<'_> {
    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name.as_str() == self.name)
            && matches!(&attribute.value, Some(JSXAttributeValue::ExpressionContainer(_)))
        {
            self.found = true;
        } else {
            walk::walk_jsx_attribute(self, attribute);
        }
    }
}

pub fn scan_file(file: &str, text: &str, style_prop: &str) -> FileScan {
    let mut out = FileScan::default();
    let Ok(source_type) = SourceType::from_path(file) else { return out };
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, source_type).parse();
    let program = &parsed.program;
    out.imports = imports_of(program);
    out.has_core = out.imports.iter().any(|(source, _, _)| source == "@plumeria/core");
    out.core_insert = match program.directives.last() {
        Some(directive) => (directive.span.end, "\nimport '@plumeria/core';".to_string()),
        None => (0, "import '@plumeria/core';\n".to_string()),
    };
    let required: Vec<(String, u32)> = program
        .body
        .iter()
        .filter_map(|statement| match statement {
            Statement::VariableDeclaration(declaration) => Some(declaration),
            _ => None,
        })
        .flat_map(|declaration| &declaration.declarations)
        .filter(|declarator| {
            matches!(declarator.id, BindingPattern::BindingIdentifier(_) | BindingPattern::ObjectPattern(_))
        })
        .filter_map(|declarator| {
            let Some(Expression::CallExpression(call)) = declarator.init.as_ref().map(|e| e.get_inner_expression())
            else {
                return None;
            };
            let Expression::Identifier(callee) = &call.callee else { return None };
            let [argument] = call.arguments.as_slice() else { return None };
            let Some(Expression::StringLiteral(literal)) = argument.as_expression() else { return None };
            let source = literal.value.as_str()?;
            (callee.name.as_str() == "require" && source.starts_with("@stylexjs/"))
                .then(|| (source.to_string(), declarator.span.start))
        })
        .collect();
    out.stylex = !required.is_empty() || out.imports.iter().any(|(source, _, _)| source.starts_with("@stylexjs/"));
    if !required.is_empty() {
        for (source, at) in required {
            out.holds.push(Hold { kind: "require", detail: source, at: Some(at) });
        }
        return out;
    }
    if !out.stylex {
        if !out.has_core && text.contains(style_prop) {
            let mut visitor = StylePropVisitor { name: style_prop, found: false };
            visitor.visit_program(program);
            out.has_style_prop = visitor.found;
        }
        return out;
    }
    if parsed.fatal_error || !parsed.diagnostics.is_empty() {
        out.holds.push(Hold { kind: "parse-error", detail: file.to_string(), at: None });
        return out;
    }

    let semantic = SemanticBuilder::new().build(program).semantic;
    let scoping = semantic.scoping();
    let mut scan = Scan {
        text,
        scoping,
        style_prop,
        namespaces: FxHashSet::default(),
        named: FxHashMap::default(),
        allowed: FxHashMap::default(),
        top_level: FxHashSet::default(),
        bindings: FxHashSet::default(),
        follow_all: FxHashSet::default(),
        follow_keys: FxHashSet::default(),
        props_arg: None,
        uses_css: false,
        emits_style_prop: false,
        holds: Vec::new(),
        edits: Vec::new(),
        creates: Vec::new(),
    };

    let mut stylex_imports = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::ImportDeclaration(declaration) => {
                let source = declaration.source.value.as_str().unwrap_or_default();
                if source == PACKAGE {
                    for specifier in declaration.specifiers.iter().flatten() {
                        match specifier {
                            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                if let Some(symbol) = named.local.symbol_id.get() {
                                    scan.named.insert(symbol, named.imported.name().to_string());
                                }
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                                scan.namespaces.extend(default.local.symbol_id.get());
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                                scan.namespaces.extend(namespace.local.symbol_id.get());
                            }
                        }
                    }
                    stylex_imports.push(declaration.span);
                } else if source.starts_with("@stylexjs/") {
                    scan.hold("unsupported-import", source, declaration.span.start);
                }
            }
            Statement::ExportFromDeclaration(declaration) => {
                let source = declaration.source.value.as_str().unwrap_or_default();
                if source.starts_with("@stylexjs/") {
                    scan.hold("re-export", source, declaration.span.start);
                }
            }
            Statement::ExportAllDeclaration(declaration) => {
                let source = declaration.source.value.as_str().unwrap_or_default();
                if source.starts_with("@stylexjs/") {
                    scan.hold("re-export", source, declaration.span.start);
                }
            }
            _ => {}
        }
    }
    if scoping.symbol_names().any(|name| name == "css") {
        scan.hold("css-binding-taken", "css", 0);
    }

    for statement in &program.body {
        let (declaration, exported) = match statement {
            Statement::VariableDeclaration(declaration) => (Some(declaration), false),
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(declaration) => (Some(declaration), true),
                _ => (None, false),
            },
            Statement::ExportDefaultDeclaration(export) => {
                if let Some(Expression::CallExpression(call)) =
                    export.declaration.as_expression().map(|e| e.get_inner_expression())
                    && scan.api(&call.callee).as_deref() == Some("create")
                {
                    scan.allowed.insert(call.span.start, None);
                    out.style_exports.insert("default".to_string());
                }
                (None, false)
            }
            _ => (None, false),
        };
        let Some(declaration) = declaration else { continue };
        for declarator in &declaration.declarations {
            let Some(Expression::CallExpression(call)) = declarator.init.as_ref().map(|e| e.get_inner_expression())
            else {
                continue;
            };
            match scan.api(&call.callee).as_deref() {
                Some("create") => {}
                Some("defineConsts" | "viewTransitionClass" | "positionTry") => {
                    scan.top_level.insert(call.span.start);
                    continue;
                }
                _ => continue,
            }
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else { continue };
            let binding = identifier.symbol_id.get();
            scan.allowed.insert(call.span.start, binding);
            if let Some(symbol) = binding {
                scan.bindings.insert(symbol);
                if exported {
                    scan.follow_all.insert(symbol);
                    out.style_exports.insert(identifier.name.to_string());
                }
            }
        }
    }
    for statement in &program.body {
        match statement {
            Statement::ExportNamedDeclaration(export) => {
                for specifier in &export.specifiers {
                    if let ModuleExportName::IdentifierReference(local) = &specifier.local
                        && scan.symbol(local).is_some_and(|s| scan.bindings.contains(&s))
                    {
                        out.style_exports.insert(specifier.exported.name().to_string());
                    }
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                if let Some(Expression::Identifier(local)) = export.declaration.as_expression()
                    && scan.symbol(local).is_some_and(|s| scan.bindings.contains(&s))
                {
                    out.style_exports.insert("default".to_string());
                }
            }
            _ => {}
        }
    }

    scan.visit_program(program);

    for create in &mut scan.creates {
        for namespace in &mut create.namespaces {
            namespace.follows = match create.binding {
                None => true,
                Some(symbol) => {
                    scan.follow_all.contains(&symbol) || scan.follow_keys.contains(&(symbol, namespace.name.clone()))
                }
            };
        }
    }

    let header = if scan.uses_css { "import * as css from '@plumeria/core';" } else { "import '@plumeria/core';" };
    for (index, span) in stylex_imports.iter().enumerate() {
        if index == 0 && (scan.uses_css || !scan.emits_style_prop) {
            scan.edits.push((span.start, span.end, header.to_string()));
        } else {
            let rest = &text[span.end as usize..];
            let end = span.end + if rest.starts_with("\r\n") { 2 } else { u32::from(rest.starts_with('\n')) };
            scan.edits.push((span.start, end, String::new()));
        }
    }

    let mut spans: Vec<(u32, u32)> = scan.edits.iter().map(|(s, e, _)| (*s, *e)).collect();
    spans.extend(scan.creates.iter().map(|c| (c.start, c.end)));
    spans.sort();
    if let Some(pair) = spans.windows(2).find(|w| w[1].0 < w[0].1) {
        scan.hold("overlap", "stylex", pair[1].0);
    }

    out.holds = scan.holds;
    out.edits = scan.edits;
    out.creates = scan.creates;
    out
}

type States = FxHashMap<(Option<String>, String), Vec<Path>>;

fn close(paths: &mut Vec<Path>) -> bool {
    loop {
        let mut added = Vec::new();
        for (i, a) in paths.iter().enumerate() {
            for b in &paths[i + 1..] {
                if a.element != b.element || a.at != b.at || a.pseudos.is_empty() || b.pseudos.is_empty() {
                    continue;
                }
                if a.pseudos.iter().all(|p| b.pseudos.contains(p)) || b.pseudos.iter().all(|p| a.pseudos.contains(p)) {
                    continue;
                }
                let union = a.with_pseudos(&b.pseudos);
                if !paths.contains(&union) && !added.contains(&union) {
                    added.push(union);
                }
            }
        }
        if added.is_empty() {
            return true;
        }
        paths.extend(added);
        if paths.len() > STATE_LIMIT {
            return false;
        }
    }
}

fn spans(at: &Option<String>, state: &Option<String>) -> bool {
    match (at, state) {
        (None, _) => true,
        (Some(at), Some(state)) => at == state || implies_condition(state, at),
        (Some(_), None) => false,
    }
}

fn resolve_state<'d>(
    entries: &[(&Path, &'d Option<String>)],
    state: &Path,
) -> Result<Option<&'d Option<String>>, &'static str> {
    let reaches = |p: &Path| p.element == state.element && p.pseudos.iter().all(|x| state.pseudos.contains(x));
    let applicable: Vec<(usize, &Path, &'d Option<String>)> = entries
        .iter()
        .enumerate()
        .filter(|(_, (p, _))| reaches(p) && spans(&p.at, &state.at))
        .map(|(i, (p, v))| (i, *p, *v))
        .collect();
    if applicable.is_empty() {
        return Ok(None);
    }
    let has_at = applicable.iter().any(|(_, p, _)| p.at.is_some());
    let level: Vec<_> = applicable.into_iter().filter(|(_, p, _)| p.at.is_some() == has_at).collect();
    let top: Vec<_> = level
        .iter()
        .filter(|(_, p, _)| {
            !level
                .iter()
                .any(|(_, q, _)| q.pseudos.len() > p.pseudos.len() && p.pseudos.iter().all(|x| q.pseudos.contains(x)))
        })
        .collect();
    let last = top.iter().max_by_key(|(i, _, _)| *i).unwrap();
    let value = last.2;
    if !top.iter().all(|(_, p, v)| p.pseudos == last.1.pseudos || *v == value) {
        return Err("overlapping-states");
    }
    if let Some(region) = &state.at {
        let crossed = entries.iter().any(|(p, v)| {
            reaches(p)
                && p.at.as_ref().is_some_and(|at| !spans(&p.at, &state.at) && !implies_condition(at, region))
                && *v != value
        });
        if crossed {
            return Err("media-order");
        }
    }
    Ok(Some(value))
}

fn settle(namespace: &Namespace, states: &States) -> Result<Vec<(Path, String, String)>, Vec<Hold>> {
    let mut holds = Vec::new();
    let mut out = Vec::new();
    let mut groups: Vec<(Option<String>, String)> = Vec::new();
    for decl in &namespace.decls {
        let group = (decl.path.element.clone(), decl.prop.clone());
        if !groups.contains(&group) {
            groups.push(group);
        }
    }
    for group in groups {
        let decls: Vec<&Decl> = namespace
            .decls
            .iter()
            .filter(|d| d.path.element == group.0 && d.prop == group.1)
            .collect();
        let entries: Vec<(&Path, &Option<String>)> = decls.iter().map(|d| (&d.path, &d.value)).collect();
        let key = decls[0].key.clone();
        let at = decls[0].at;
        let mut required: Vec<Path> = Vec::new();
        for (path, _) in &entries {
            if !required.contains(path) {
                required.push((*path).clone());
            }
        }
        let closed = if namespace.follows {
            let mut extra: Vec<Path> = states.get(&group).cloned().unwrap_or_default();
            extra.retain(|p| !required.contains(p));
            extra.sort();
            required.extend(extra);
            true
        } else {
            close(&mut required)
        };
        if !closed {
            holds.push(Hold { kind: "too-many-states", detail: group.1.clone(), at: Some(at) });
            continue;
        }
        for state in required {
            let detail = || format!("{} at {}", group.1, state.describe());
            let own = decls.iter().rev().find(|d| d.path == state);
            if let Some(decl) = own
                && decl.value.is_none()
            {
                let is_default = state.at.is_none() && state.pseudos.is_empty();
                if namespace.follows || !is_default {
                    holds.push(Hold { kind: "null-value", detail: detail(), at: Some(decl.at) });
                }
                continue;
            }
            match resolve_state(&entries, &state) {
                Ok(Some(Some(value))) => out.push((state.clone(), key.clone(), value.clone())),
                Ok(_) if namespace.follows || own.is_some() => {
                    holds.push(Hold { kind: "unset-state", detail: detail(), at: Some(at) })
                }
                Ok(_) => {}
                Err(kind) => holds.push(Hold { kind, detail: detail(), at: Some(at) }),
            }
        }
    }
    if holds.is_empty() { Ok(out) } else { Err(holds) }
}

#[derive(Default)]
struct Block {
    decls: Vec<(String, String)>,
    children: Vec<(String, Block)>,
}

impl Block {
    fn child(&mut self, key: String) -> &mut Block {
        let index = match self.children.iter().position(|(k, _)| *k == key) {
            Some(index) => index,
            None => {
                self.children.push((key, Block::default()));
                self.children.len() - 1
            }
        };
        &mut self.children[index].1
    }

    fn insert(&mut self, path: &Path, key: String, value: String) {
        let mut block = self;
        if let Some(at) = &path.at {
            block = block.child(quote(at));
        }
        if let Some(element) = &path.element {
            block = block.child(quote(element));
        }
        if !path.pseudos.is_empty() {
            block = block.child(quote(&path.pseudos.concat()));
        }
        block.decls.push((key, value));
    }

    fn render(&self, base: &str, depth: usize, out: &mut String) {
        let pad = format!("{base}{}", "  ".repeat(depth + 1));
        out.push_str("{\n");
        for (key, value) in &self.decls {
            out.push_str(&format!("{pad}{key}: {value},\n"));
        }
        for (key, child) in &self.children {
            out.push_str(&format!("{pad}{key}: "));
            child.render(base, depth + 1, out);
            out.push_str(",\n");
        }
        out.push_str(&format!("{base}{}}}", "  ".repeat(depth)));
    }
}

fn render_create(create: &Create, states: &States) -> Result<String, Vec<Hold>> {
    let base = &create.indent;
    let mut out = String::from("css.create({\n");
    let mut holds = Vec::new();
    for namespace in &create.namespaces {
        match settle(namespace, states) {
            Ok(decls) => {
                let mut block = Block::default();
                for (path, key, value) in decls {
                    block.insert(&path, key, value);
                }
                out.push_str(&format!("{base}  {}: {}", namespace.key, namespace.prefix));
                block.render(base, 1, &mut out);
                out.push_str(&format!("{},\n", namespace.suffix));
            }
            Err(found) => holds.extend(found),
        }
    }
    out.push_str(&format!("{base}}})"));
    if holds.is_empty() { Ok(out) } else { Err(holds) }
}

pub struct Plan {
    pub converted: Vec<usize>,
    pub carriers: Vec<usize>,
    pub rewrites: Vec<(usize, String)>,
    pub held: Vec<(usize, Vec<Hold>)>,
}

fn find<'f>(files: &FxHashMap<&'f str, usize>, candidate: &str) -> Option<usize> {
    SUFFIXES.iter().find_map(|suffix| files.get(format!("{candidate}{suffix}").as_str()).copied())
}

fn root(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

pub fn plan(sources: &[(String, String)], paths: Option<&Paths>, style_prop: &str) -> Plan {
    let scans: Vec<FileScan> = sources.iter().map(|(file, text)| scan_file(file, text, style_prop)).collect();
    let files: FxHashMap<&str, usize> = sources.iter().enumerate().map(|(i, (f, _))| (f.as_str(), i)).collect();

    let mut links: Vec<(usize, Vec<usize>, bool)> = Vec::new();
    for (i, scan) in scans.iter().enumerate() {
        let mut targets = Vec::new();
        let mut carries = false;
        for (specifier, names, all) in &scan.imports {
            let Some(j) = resolve(specifier, &sources[i].0, paths, |c| find(&files, c).is_some())
                .and_then(|c| find(&files, &c))
            else {
                continue;
            };
            if !scans[j].stylex || j == i {
                continue;
            }
            targets.push(j);
            let exports = &scans[j].style_exports;
            if (*all && !exports.is_empty()) || names.iter().any(|n| exports.contains(n)) {
                carries = true;
            }
        }
        links.push((i, targets, carries));
    }
    let mut parent: Vec<usize> = (0..sources.len()).collect();
    let mut carriers = Vec::new();
    for (i, targets, carries) in &links {
        if !scans[*i].stylex && !carries {
            continue;
        }
        if !scans[*i].stylex {
            carriers.push(*i);
        }
        for &j in targets {
            let (a, b) = (root(&mut parent, *i), root(&mut parent, j));
            parent[a] = b;
        }
    }

    let stylex: Vec<usize> = (0..scans.len()).filter(|&i| scans[i].stylex).collect();
    let mut held: FxHashMap<usize, Vec<Hold>> = FxHashMap::default();
    for &i in &stylex {
        if !scans[i].holds.is_empty() {
            held.insert(i, scans[i].holds.clone());
        }
    }
    let members: Vec<usize> = stylex.iter().chain(&carriers).copied().collect();
    let mut rendered: FxHashMap<usize, Vec<(u32, u32, String)>> = FxHashMap::default();
    loop {
        let blocked: FxHashMap<usize, usize> =
            held.keys().map(|&i| (root(&mut parent, i), i)).collect();
        for &i in &members {
            if held.contains_key(&i) {
                continue;
            }
            if let Some(&cause) = blocked.get(&root(&mut parent, i)) {
                let detail = sources[cause].0.clone();
                held.insert(i, vec![Hold { kind: "linked-to-held", detail, at: None }]);
            }
        }

        let mut states: States = FxHashMap::default();
        for &i in stylex.iter().filter(|i| !held.contains_key(i)) {
            for create in &scans[i].creates {
                for namespace in &create.namespaces {
                    for decl in &namespace.decls {
                        let entry = states.entry((decl.path.element.clone(), decl.prop.clone())).or_default();
                        if !entry.contains(&decl.path) {
                            entry.push(decl.path.clone());
                        }
                    }
                }
            }
        }
        let mut overflow = FxHashSet::default();
        for (group, paths) in states.iter_mut() {
            if !close(paths) {
                overflow.insert(group.1.clone());
            }
        }

        let mut fresh = false;
        rendered.clear();
        let open: Vec<usize> = stylex.iter().copied().filter(|i| !held.contains_key(i)).collect();
        for i in open {
            let mut holds = Vec::new();
            let mut edits = Vec::new();
            for create in &scans[i].creates {
                for namespace in &create.namespaces {
                    for decl in namespace.decls.iter().filter(|d| overflow.contains(&d.prop)) {
                        holds.push(Hold { kind: "too-many-states", detail: decl.prop.clone(), at: Some(decl.at) });
                    }
                }
                match render_create(create, &states) {
                    Ok(text) => edits.push((create.start, create.end, text)),
                    Err(found) => holds.extend(found),
                }
            }
            if holds.is_empty() {
                rendered.insert(i, edits);
            } else {
                held.insert(i, holds);
                fresh = true;
            }
        }
        if !fresh {
            break;
        }
    }

    let mut converted = Vec::new();
    let mut rewrites = Vec::new();
    for &i in &stylex {
        let Some(creates) = rendered.remove(&i) else { continue };
        let mut edits = scans[i].edits.clone();
        edits.extend(creates);
        edits.sort_by_key(|(start, _, _)| *start);
        rewrites.push((i, apply(&sources[i].1, &edits)));
        converted.push(i);
    }
    let mut given = Vec::new();
    for &i in &carriers {
        if held.contains_key(&i) || scans[i].has_core || scans[i].has_style_prop {
            continue;
        }
        let (at, text) = &scans[i].core_insert;
        rewrites.push((i, apply(&sources[i].1, &[(*at, *at, text.clone())])));
        given.push(i);
    }
    let mut held: Vec<(usize, Vec<Hold>)> = held.into_iter().collect();
    held.sort_by_key(|(i, _)| *i);
    Plan { converted, carriers: given, rewrites, held }
}

pub fn run(options: &Options) -> ExitCode {
    let mut project = Vec::new();
    walk_files("", &mut project);
    let sources: Vec<(String, String)> = project
        .iter()
        .filter(|p| SOURCES.contains(&extension(p)))
        .filter_map(|p| Some((p.clone(), fs::read_to_string(p).ok()?)))
        .collect();
    if !sources.iter().any(|(_, text)| text.contains(PACKAGE)) {
        println!("No {PACKAGE} import found.");
        return ExitCode::SUCCESS;
    }
    let paths = Paths::load(|path| fs::read_to_string(path).ok());
    let plan = plan(&sources, paths.as_ref(), &options.style_prop);

    for &i in &plan.converted {
        println!("  {}", sources[i].0);
    }
    if options.dry_run {
        println!(
            "\n{} file(s) would be converted, {} file(s) given the core import.\nRun without --dry-run to apply.",
            plan.converted.len(),
            plan.carriers.len()
        );
    } else {
        for (i, text) in &plan.rewrites {
            if let Err(error) = fs::write(&sources[*i].0, text) {
                eprintln!("✖ {}: {error}", sources[*i].0);
                return ExitCode::FAILURE;
            }
        }
        println!(
            "\n✔ converted {} file(s) and gave {} file(s) the core import.",
            plan.converted.len(),
            plan.carriers.len()
        );
    }

    if plan.held.is_empty() {
        return ExitCode::SUCCESS;
    }
    println!("\nLeft in place — nothing was written for these files:\n");
    for (i, holds) in &plan.held {
        let (file, text) = &sources[*i];
        println!("{file}");
        for hold in holds {
            match hold.at {
                Some(at) => {
                    let (line, column) = position(text, at);
                    println!("  {line}:{column}  {}  {}", hold.kind, hold.detail);
                }
                None => println!("  {}  {}", hold.kind, hold.detail),
            }
        }
    }
    ExitCode::FAILURE
}
