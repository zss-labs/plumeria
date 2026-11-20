use std::cell::RefCell;
use std::fs;
use std::process::ExitCode;

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType, Span};
use rustc_hash::{FxHashMap, FxHashSet};

#[path = "../../compiler/src/engine/conditional.rs"]
#[allow(dead_code)]
mod conditional;

use conditional::implies_condition;

use crate::css;
use crate::stylesheet::{is_identifier, quote, to_property};
use crate::resolve::{resolve, Paths};
use crate::stylex::{position, SUFFIXES};
use crate::tailwind::class_hash;
use crate::{apply, extension, walk as walk_files, Options, SOURCES};

const PACKAGE: &str = "@emotion/react";
const AT_RULES: &[&str] = &["@media", "@container", "@supports"];
const PLACEHOLDER: &str = "__emotion_";
const STYLED: &str = "@emotion/styled";
const DOM_PROPS: &[&str] = &[
    "accept", "action", "alt", "autoComplete", "autoFocus", "autoPlay", "checked", "children", "colSpan", "cols",
    "contentEditable", "controls", "cx", "cy", "d", "dangerouslySetInnerHTML", "decoding", "defaultChecked",
    "defaultValue", "dir", "disabled", "download", "draggable", "encType", "enterKeyHint", "fill", "form", "height",
    "hidden", "href", "htmlFor", "id", "inputMode", "itemProp", "key", "label", "lang", "loading", "loop", "max",
    "maxLength", "method", "min", "minLength", "multiple", "muted", "name", "noValidate", "open", "pattern",
    "placeholder", "playsInline", "points", "poster", "preload", "r", "readOnly", "ref", "rel", "required", "role",
    "rowSpan", "rows", "selected", "sizes", "slot", "spellCheck", "src", "srcSet", "step", "stroke", "strokeWidth",
    "style", "suppressHydrationWarning", "tabIndex", "target", "title", "transform", "translate", "type", "value",
    "viewBox", "width", "x", "xmlns", "y",
];

fn dom_prop(name: &str) -> bool {
    name.starts_with("data-")
        || name.starts_with("aria-")
        || name.strip_prefix("on").is_some_and(|rest| rest.starts_with(|c: char| c.is_ascii_uppercase()))
        || DOM_PROPS.contains(&name)
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
    depends: Vec<(String, String)>,
}

#[derive(Clone, PartialEq)]
struct Path {
    at: Option<String>,
    pseudo: String,
}

struct Decl {
    path: Path,
    prop: String,
    key: String,
    value: String,
    at: u32,
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

    fn render(&self, depth: usize, out: &mut String) {
        let pad = "  ".repeat(depth + 1);
        out.push_str("{\n");
        for (key, value) in &self.decls {
            out.push_str(&format!("{pad}{key}: {value},\n"));
        }
        for (key, child) in &self.children {
            out.push_str(&format!("{pad}{key}: "));
            child.render(depth + 1, out);
            out.push_str(",\n");
        }
        out.push_str(&format!("{}}}", "  ".repeat(depth)));
    }
}

fn key_name(key: &PropertyKey) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(name) => Some(name.name.to_string()),
        PropertyKey::StringLiteral(literal) => literal.value.as_str().map(str::to_string),
        _ => None,
    }
}

type Params = Vec<(String, String, String)>;

#[derive(Clone, PartialEq, Debug)]
pub enum Shape {
    Num,
    Str,
    Bool,
    Null,
    Object(FxHashMap<String, Shape>),
    Frames,
}

impl Shape {
    fn primitive(&self) -> bool {
        matches!(self, Shape::Num | Shape::Str | Shape::Bool)
    }
}

fn const_inits<'b, 'a>(program: &'b Program<'a>) -> FxHashMap<&'b str, &'b Expression<'a>> {
    program
        .body
        .iter()
        .filter_map(|statement| match statement {
            Statement::VariableDeclaration(declaration) => Some(&**declaration),
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(declaration) => Some(&**declaration),
                _ => None,
            },
            _ => None,
        })
        .filter(|declaration| declaration.kind == VariableDeclarationKind::Const)
        .flat_map(|declaration| &declaration.declarations)
        .filter_map(|declarator| match (&declarator.id, &declarator.init) {
            (BindingPattern::BindingIdentifier(identifier), Some(init)) => Some((identifier.name.as_str(), init)),
            _ => None,
        })
        .collect()
}

fn evaluate(expression: &Expression, inits: &FxHashMap<&str, &Expression>, visiting: &mut Vec<String>) -> Option<Shape> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(_) => Some(Shape::Str),
        Expression::NumericLiteral(_) => Some(Shape::Num),
        Expression::BooleanLiteral(_) => Some(Shape::Bool),
        Expression::NullLiteral(_) => Some(Shape::Null),
        Expression::UnaryExpression(unary) => {
            let argument = evaluate(&unary.argument, inits, visiting)?;
            match unary.operator {
                UnaryOperator::LogicalNot if argument.primitive() => Some(Shape::Bool),
                UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus | UnaryOperator::BitwiseNot
                    if argument == Shape::Num =>
                {
                    Some(Shape::Num)
                }
                _ => None,
            }
        }
        Expression::BinaryExpression(binary) => {
            let left = evaluate(&binary.left, inits, visiting)?;
            let right = evaluate(&binary.right, inits, visiting)?;
            let numeric = binary.operator.is_arithmetic() || binary.operator.is_bitwise();
            if numeric && left == Shape::Num && right == Shape::Num {
                return Some(Shape::Num);
            }
            let text = |shape: &Shape| matches!(shape, Shape::Num | Shape::Str);
            (binary.operator == BinaryOperator::Addition
                && text(&left)
                && text(&right)
                && (left == Shape::Str || right == Shape::Str))
                .then_some(Shape::Str)
        }
        Expression::TemplateLiteral(template) => {
            for expression in &template.expressions {
                evaluate(expression, inits, visiting).filter(Shape::primitive)?;
            }
            Some(Shape::Str)
        }
        Expression::ObjectExpression(object) => {
            let mut keys = FxHashMap::default();
            for property in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else { return None };
                let key = key_name(&property.key).filter(|_| !property.computed && !property.method)?;
                keys.insert(key, evaluate(&property.value, inits, visiting)?);
            }
            Some(Shape::Object(keys))
        }
        Expression::Identifier(identifier) => constant(identifier.name.as_str(), inits, visiting),
        _ => None,
    }
}

fn constant(name: &str, inits: &FxHashMap<&str, &Expression>, visiting: &mut Vec<String>) -> Option<Shape> {
    if visiting.iter().any(|v| v == name) {
        return None;
    }
    let init = inits.get(name)?;
    visiting.push(name.to_string());
    let found = evaluate(init, inits, visiting);
    visiting.pop();
    found.filter(|shape| *shape != Shape::Null)
}

fn frames_of(init: &Expression, names: &FxHashSet<&str>) -> bool {
    let callee = match init.get_inner_expression() {
        Expression::CallExpression(call) => &call.callee,
        Expression::TaggedTemplateExpression(tagged) => &tagged.tag,
        _ => return false,
    };
    matches!(callee.get_inner_expression(), Expression::Identifier(identifier) if names.contains(identifier.name.as_str()))
}

#[derive(Default)]
pub struct Module {
    kinds: FxHashMap<String, Shape>,
    forwards: FxHashMap<String, (String, String)>,
}

pub fn module(file: &str, text: &str) -> Module {
    let mut out = Module::default();
    let Ok(source_type) = SourceType::from_path(file) else { return out };
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, source_type).parse();
    let program = &parsed.program;
    let inits = const_inits(program);
    let mut imports: FxHashMap<&str, (String, String)> = FxHashMap::default();
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else { continue };
        let source = declaration.source.value.as_str().unwrap_or_default();
        for specifier in declaration.specifiers.iter().flatten() {
            match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                    imports.insert(named.local.name.as_str(), (source.to_string(), named.imported.name().to_string()));
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                    imports.insert(default.local.name.as_str(), (source.to_string(), "default".to_string()));
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => {}
            }
        }
    }
    let frames: FxHashSet<&str> = imports
        .iter()
        .filter(|(_, (source, imported))| source == PACKAGE && imported == "keyframes")
        .map(|(local, _)| *local)
        .collect();
    let export = |exported: &str, local: &str, out: &mut Module| {
        let shape = match inits.get(local) {
            Some(init) if frames_of(init, &frames) => Some(Shape::Frames),
            Some(_) => constant(local, &inits, &mut Vec::new()),
            None => None,
        };
        if let Some(shape) = shape {
            out.kinds.insert(exported.to_string(), shape);
        } else if let Some(forward) = imports.get(local) {
            out.forwards.insert(exported.to_string(), forward.clone());
        }
    };
    for statement in &program.body {
        match statement {
            Statement::ExportDeclaration(declaration) => {
                if let Declaration::VariableDeclaration(declaration) = &declaration.declaration {
                    for declarator in &declaration.declarations {
                        if let BindingPattern::BindingIdentifier(identifier) = &declarator.id {
                            export(identifier.name.as_str(), identifier.name.as_str(), &mut out);
                        }
                    }
                }
            }
            Statement::ExportNamedDeclaration(declaration) => {
                for specifier in &declaration.specifiers {
                    export(&specifier.exported.name(), &specifier.local.name(), &mut out);
                }
            }
            Statement::ExportFromDeclaration(declaration) => {
                let source = declaration.source.value.as_str().unwrap_or_default();
                for specifier in &declaration.specifiers {
                    let forward = (source.to_string(), specifier.local.name().to_string());
                    out.forwards.insert(specifier.exported.name().to_string(), forward);
                }
            }
            _ => {}
        }
    }
    out
}

pub fn resolve_kind(
    modules: &FxHashMap<String, Module>,
    paths: Option<&Paths>,
    importer: &str,
    specifier: &str,
    name: &str,
) -> Option<Shape> {
    resolve_site(modules, paths, importer, specifier, name).map(|(_, shape)| shape)
}

fn resolve_site(
    modules: &FxHashMap<String, Module>,
    paths: Option<&Paths>,
    importer: &str,
    specifier: &str,
    name: &str,
) -> Option<(String, Shape)> {
    let find = |candidate: &str| {
        SUFFIXES.iter().map(|suffix| format!("{candidate}{suffix}")).find(|path| modules.contains_key(path))
    };
    let mut visited: Vec<(String, String)> = Vec::new();
    let (mut importer, mut specifier, mut name) = (importer.to_string(), specifier.to_string(), name.to_string());
    loop {
        let file = resolve(&specifier, &importer, paths, |c| find(c).is_some()).and_then(|c| find(&c))?;
        if visited.contains(&(file.clone(), name.clone())) {
            return None;
        }
        visited.push((file.clone(), name.clone()));
        let module = &modules[&file];
        if let Some(kind) = module.kinds.get(&name) {
            return Some((file, kind.clone()));
        }
        let (next, imported) = module.forwards.get(&name)?.clone();
        importer = file;
        specifier = next;
        name = imported;
    }
}

fn single_object<'a, 'b>(call: &'b CallExpression<'a>) -> Option<&'b ObjectExpression<'a>> {
    let [argument] = call.arguments.as_slice() else { return None };
    match argument.as_expression() {
        Some(Expression::ObjectExpression(object)) => Some(object),
        _ => None,
    }
}

fn camel(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut upper = false;
    for c in name.chars() {
        if c == '-' {
            upper = true;
        } else if upper {
            out.push(c.to_ascii_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

fn split_top(text: &str, separator: char) -> Vec<String> {
    let mut parts = vec![String::new()];
    let mut depth = 0usize;
    for c in text.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ => {}
        }
        if c == separator && depth == 0 {
            parts.push(String::new());
        } else {
            parts.last_mut().unwrap().push(c);
        }
    }
    parts
}

fn selector(part: &str) -> Option<String> {
    let part = part.trim();
    let part = part.strip_prefix('&').unwrap_or(part);
    if !part.starts_with(':') && !part.starts_with('[') {
        return None;
    }
    let mut depth = 0usize;
    for c in part.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            '&' => return None,
            c if depth == 0 && (c.is_whitespace() || ">+~.#,".contains(c)) => return None,
            _ => {}
        }
    }
    Some(part.to_string())
}

fn states(pseudo: &str) -> (String, Vec<String>) {
    let (state, element) = match pseudo.find("::") {
        Some(i) => (&pseudo[..i], pseudo[i..].to_string()),
        None => (pseudo, String::new()),
    };
    let mut parts: Vec<String> = Vec::new();
    let mut depth = 0usize;
    for c in state.chars() {
        if depth == 0 && (c == ':' || c == '[') {
            parts.push(String::new());
        }
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ => {}
        }
        if let Some(last) = parts.last_mut() {
            last.push(c);
        }
    }
    parts.sort();
    (element, parts)
}

struct Scan<'s> {
    text: &'s str,
    style_prop: &'s str,
    scoping: &'s Scoping,
    css: FxHashSet<SymbolId>,
    styled: FxHashSet<SymbolId>,
    keyframes: FxHashSet<SymbolId>,
    jsx: FxHashSet<SymbolId>,
    animations: Vec<(u32, u32, String)>,
    reads: RefCell<FxHashSet<SymbolId>>,
    components: FxHashMap<SymbolId, (String, String)>,
    aliases: FxHashMap<SymbolId, String>,
    handled: FxHashSet<u32>,
    taken: FxHashSet<String>,
    params: Option<Params>,
    kinds: FxHashMap<SymbolId, Shape>,
    imported: FxHashMap<SymbolId, (String, String)>,
    exports: &'s dyn Fn(&str, &str) -> Option<Shape>,
    styles: Vec<(String, String)>,
    edits: Vec<(u32, u32, String)>,
    holds: Vec<Hold>,
}

impl<'s> Scan<'s> {
    fn hold(&mut self, kind: &'static str, detail: impl Into<String>, at: u32) {
        self.holds.push(Hold { kind, detail: detail.into(), at });
    }

    fn source(&self, span: Span) -> &'s str {
        &self.text[span.start as usize..span.end as usize]
    }

    fn reference(&self, identifier: &IdentifierReference) -> Option<SymbolId> {
        self.scoping.get_reference(identifier.reference_id.get()?).symbol_id()
    }

    fn is_css(&self, callee: &Expression) -> bool {
        matches!(callee.get_inner_expression(), Expression::Identifier(identifier)
            if self.reference(identifier).is_some_and(|s| self.css.contains(&s)))
    }

    fn is_styled(&self, expression: &Expression) -> bool {
        matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
            if self.reference(identifier).is_some_and(|s| self.styled.contains(&s)))
    }

    fn styled_tag(&self, tag: &Expression) -> Option<Result<String, &'static str>> {
        match tag.get_inner_expression() {
            Expression::StaticMemberExpression(member) if self.is_styled(&member.object) => {
                Some(Ok(member.property.name.to_string()))
            }
            Expression::CallExpression(call) if self.is_styled(&call.callee) => Some(match call.arguments.as_slice() {
                [argument] => match argument.as_expression() {
                    Some(Expression::StringLiteral(literal)) => match literal.value.as_str() {
                        Some(tag) if tag.starts_with(|c: char| c.is_ascii_lowercase()) => Ok(tag.to_string()),
                        _ => Err("styled-component"),
                    },
                    _ => Err("styled-component"),
                },
                _ => Err("styled-options"),
            }),
            _ => None,
        }
    }

    fn styled_element(&mut self, element: &JSXElement, tag: &str, sx: &str) {
        let opening = &element.opening_element;
        let at = opening.span.start;
        let mut tag = tag.to_string();
        let mut removed = None;
        for item in &opening.attributes {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return self.hold("spread-props", self.source(opening.name.span()), at);
            };
            let JSXAttributeName::Identifier(name) = &attribute.name else { continue };
            let name = name.name.as_str();
            if name == "as" {
                match &attribute.value {
                    Some(JSXAttributeValue::StringLiteral(literal))
                        if literal.value.as_str().is_some_and(|v| v.starts_with(|c: char| c.is_ascii_lowercase())) =>
                    {
                        tag = literal.value.as_str().unwrap_or_default().to_string();
                        removed = Some(attribute.span);
                    }
                    _ => return self.hold("styled-as", self.source(attribute.span), at),
                }
            } else if name == "className" || name == "css" || name == self.style_prop {
                return self.hold("styled-beside-attribute", name, at);
            } else if !dom_prop(name) {
                return self.hold("custom-prop", name, attribute.span.start);
            }
        }
        let name = opening.name.span();
        self.edits.push((name.start, name.end, format!("{tag} {}={{{sx}}}", self.style_prop)));
        if let Some(span) = removed {
            let start = if self.text[..span.start as usize].ends_with(' ') { span.start - 1 } else { span.start };
            self.edits.push((start, span.end, String::new()));
        }
        if let Some(closing) = &element.closing_element {
            let name = closing.name.span();
            self.edits.push((name.start, name.end, tag));
        }
    }

    fn root_static(&self, expression: &Expression) -> bool {
        self.shape(expression).is_some_and(|shape| shape.primitive() || shape == Shape::Frames)
    }

    fn shape(&self, expression: &Expression) -> Option<Shape> {
        match expression.get_inner_expression() {
            Expression::StringLiteral(_) => Some(Shape::Str),
            Expression::NumericLiteral(_) => Some(Shape::Num),
            Expression::UnaryExpression(unary)
                if unary.operator == UnaryOperator::UnaryNegation
                    && matches!(unary.argument.get_inner_expression(), Expression::NumericLiteral(_)) =>
            {
                Some(Shape::Num)
            }
            Expression::TemplateLiteral(template) => {
                template.expressions.iter().all(|e| self.root_static(e)).then_some(Shape::Str)
            }
            Expression::StaticMemberExpression(member) if self.params.is_none() => match self.shape(&member.object)? {
                Shape::Object(keys) => keys.get(member.property.name.as_str()).cloned(),
                _ => None,
            },
            Expression::Identifier(identifier) => {
                let symbol = self.reference(identifier)?;
                if self.scoping.symbol_scope_id(symbol) != self.scoping.root_scope_id()
                    || self.aliases.contains_key(&symbol)
                    || self.css.contains(&symbol)
                {
                    return None;
                }
                let shape = match (self.kinds.get(&symbol), self.imported.get(&symbol)) {
                    (Some(shape), _) => Some(shape.clone()),
                    (None, Some((source, name))) => (self.exports)(source, name),
                    (None, None) => None,
                }?;
                if self.params.is_some() && !shape.primitive() && shape != Shape::Frames {
                    return None;
                }
                self.reads.borrow_mut().insert(symbol);
                Some(shape)
            }
            _ => None,
        }
    }

    fn nest(&mut self, path: &Path, name: &str, at: u32) -> Vec<Path> {
        if name.starts_with('@') {
            if !AT_RULES.iter().any(|rule| name.starts_with(rule)) {
                self.hold("unsupported-at-rule", name, at);
            } else if path.at.is_some() {
                self.hold("nested-at-rule", name, at);
            } else if !path.pseudo.is_empty() {
                self.hold("at-rule-in-pseudo", name, at);
            } else {
                return vec![Path { at: Some(name.to_string()), pseudo: String::new() }];
            }
            return Vec::new();
        }
        let parts: Option<Vec<String>> = split_top(name, ',').iter().map(|p| selector(p)).collect();
        let Some(parts) = parts else {
            self.hold("selector", name, at);
            return Vec::new();
        };
        parts.into_iter().map(|part| Path { at: path.at.clone(), pseudo: format!("{}{part}", path.pseudo) }).collect()
    }

    fn read_css(&mut self, nodes: &[css::Node], path: &Path, root: bool, exprs: &[Option<&Expression>], seen: &mut FxHashSet<usize>, at: u32, decls: &mut Vec<Decl>) {
        for node in nodes {
            match node {
                css::Node::Decl(decl) => {
                    let prop = to_property(&decl.prop);
                    if prop == "label" && root && path.at.is_none() && path.pseudo.is_empty() {
                        continue;
                    }
                    let Some(value) = self.interpolate(&decl.value, exprs, seen) else {
                        self.hold("dynamic-value", decl.prop.clone(), at);
                        continue;
                    };
                    let key = if is_identifier(&prop) { prop.clone() } else { quote(&prop) };
                    decls.push(Decl { path: path.clone(), prop, key, value, at });
                }
                css::Node::Rule(rule) => {
                    if rule.prelude.contains(PLACEHOLDER) {
                        self.hold("selector-interpolation", rule.prelude.clone(), at);
                        continue;
                    }
                    for next in self.nest(path, &rule.prelude, at) {
                        self.read_css(&rule.children, &next, false, exprs, seen, at, decls);
                    }
                }
                css::Node::At(rule) => {
                    let name = format!("@{} {}", rule.name, rule.params);
                    match &rule.block {
                        _ if name.contains(PLACEHOLDER) => self.hold("selector-interpolation", name, at),
                        None => self.hold("unsupported-at-rule", name, at),
                        Some(children) => {
                            for next in self.nest(path, &name, at) {
                                self.read_css(children, &next, false, exprs, seen, at, decls);
                            }
                        }
                    }
                }
            }
        }
    }

    fn interpolate(&mut self, value: &str, exprs: &[Option<&Expression>], seen: &mut FxHashSet<usize>) -> Option<String> {
        let mut pieces: Vec<Result<String, usize>> = Vec::new();
        let mut rest = value;
        while let Some(start) = rest.find(PLACEHOLDER) {
            let after = &rest[start + PLACEHOLDER.len()..];
            let digits = after.find('_')?;
            let index: usize = after[..digits].parse().ok()?;
            if start > 0 {
                pieces.push(Ok(rest[..start].to_string()));
            }
            pieces.push(Err(index));
            rest = after[digits..].strip_prefix("__")?;
        }
        if !rest.is_empty() {
            pieces.push(Ok(rest.to_string()));
        }
        let mut parts = Vec::new();
        for piece in &pieces {
            match piece {
                Ok(text) => parts.push(Ok(text.clone())),
                Err(index) => {
                    let expression = (*exprs.get(*index)?)?;
                    seen.insert(*index);
                    let text = if self.root_static(expression) {
                        self.source(expression.span()).to_string()
                    } else {
                        self.param(expression)?
                    };
                    parts.push(Err(text));
                }
            }
        }
        Some(match parts.as_slice() {
            [Err(only)] => only.clone(),
            _ if parts.iter().all(Result::is_ok) => quote(value),
            _ => {
                let mut out = String::from("`");
                for part in parts {
                    match part {
                        Ok(text) => out.push_str(&text.replace('\\', "\\\\").replace('`', "\\`").replace("${", "\\${")),
                        Err(text) => out.push_str(&format!("${{{text}}}")),
                    }
                }
                out.push('`');
                out
            }
        })
    }

    fn template(&mut self, tagged: &TaggedTemplateExpression, name: Option<&str>) -> Option<Vec<String>> {
        let quasi = &tagged.quasi;
        let at = tagged.span.start;
        let mut items = Vec::new();
        let mut text = String::from("&{");
        let mut exprs: Vec<Option<&Expression>> = Vec::new();
        let mut leading = true;
        let mut skip = false;
        for (index, element) in quasi.quasis.iter().enumerate() {
            let mut raw = self.source(element.span);
            if skip {
                raw = raw.trim_start().strip_prefix(';').unwrap_or(raw);
            }
            skip = false;
            leading &= raw.trim().is_empty();
            text.push_str(raw);
            let Some(expression) = quasi.expressions.get(index) else { continue };
            let next = quasi.quasis.get(index + 1).map_or("", |q| self.source(q.span)).trim_start();
            if leading && (next.is_empty() || next.starts_with(';')) {
                items.push(self.item(expression)?);
                exprs.push(None);
                skip = true;
            } else {
                text.push_str(&format!("{PLACEHOLDER}{index}__"));
                exprs.push(Some(expression));
            }
        }
        text.push('}');
        let text: String = text.lines().filter(|line| !line.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        let (nodes, broken) = css::parse(&text);
        let [css::Node::Rule(rule)] = nodes.as_slice() else {
            self.hold("template-parse", broken.first().map_or(String::new(), |b| b.source.clone()), at);
            return None;
        };
        let before = self.holds.len();
        let saved = std::mem::replace(&mut self.params, name.is_none().then(Vec::new));
        let mut decls = Vec::new();
        let mut seen = FxHashSet::default();
        self.read_css(&rule.children, &Path { at: None, pseudo: String::new() }, true, &exprs, &mut seen, at, &mut decls);
        let params = std::mem::replace(&mut self.params, saved).unwrap_or_default();
        if self.holds.len() == before && exprs.iter().enumerate().any(|(i, e)| e.is_some() && !seen.contains(&i)) {
            self.hold("interpolation-position", "${}", at);
        }
        if self.holds.len() > before {
            return None;
        }
        if !decls.is_empty() || items.is_empty() {
            items.push(self.finish(decls, params, name)?);
        }
        Some(items)
    }

    fn is_keyframes(&self, callee: &Expression) -> bool {
        matches!(callee.get_inner_expression(), Expression::Identifier(identifier)
            if self.reference(identifier).is_some_and(|s| self.keyframes.contains(&s)))
    }

    fn frames(&mut self, init: &Expression) -> Option<String> {
        let at = init.span().start;
        let mut frames: Vec<(String, Vec<(String, String)>)> = Vec::new();
        match init {
            Expression::TaggedTemplateExpression(tagged) => {
                if !tagged.quasi.expressions.is_empty() {
                    self.hold("keyframes-interpolation", "${}", at);
                    return None;
                }
                let (nodes, broken) = css::parse(self.source(tagged.quasi.span).trim_matches('`'));
                if let Some(broken) = broken.first() {
                    self.hold("template-parse", broken.source.clone(), at);
                    return None;
                }
                for node in &nodes {
                    let css::Node::Rule(rule) = node else {
                        self.hold("keyframes-rule", "@", at);
                        return None;
                    };
                    let mut decls = Vec::new();
                    for child in &rule.children {
                        let css::Node::Decl(decl) = child else {
                            self.hold("keyframes-nested", rule.prelude.clone(), at);
                            return None;
                        };
                        let prop = to_property(&decl.prop);
                        let key = if is_identifier(&prop) { prop } else { quote(&prop) };
                        decls.push((key, quote(&decl.value)));
                    }
                    frames.push((rule.prelude.clone(), decls));
                }
            }
            Expression::CallExpression(call) => {
                let Some(object) = single_object(call) else {
                    self.hold("keyframes-argument", "keyframes", at);
                    return None;
                };
                for property in &object.properties {
                    let ObjectPropertyKind::ObjectProperty(property) = property else {
                        self.hold("spread", "...", property.span().start);
                        return None;
                    };
                    let name = key_name(&property.key).filter(|_| !property.computed);
                    let (Some(name), Expression::ObjectExpression(inner)) = (name, property.value.get_inner_expression())
                    else {
                        self.hold("keyframes-argument", self.source(property.key.span()), property.span.start);
                        return None;
                    };
                    let mut decls = Vec::new();
                    for item in &inner.properties {
                        let ObjectPropertyKind::ObjectProperty(item) = item else {
                            self.hold("spread", "...", item.span().start);
                            return None;
                        };
                        let prop = key_name(&item.key).filter(|_| !item.computed);
                        let (Some(prop), true) = (prop, self.root_static(&item.value)) else {
                            self.hold("dynamic-value", self.source(item.key.span()), item.span.start);
                            return None;
                        };
                        let key = if prop.starts_with("--") || !prop.contains('-') {
                            self.source(item.key.span()).to_string()
                        } else {
                            camel(&prop)
                        };
                        decls.push((key, self.source(item.value.span()).to_string()));
                    }
                    frames.push((name, decls));
                }
            }
            _ => return None,
        }
        let mut block = Block::default();
        for (selector, decls) in frames {
            for part in split_top(&selector, ',') {
                let part = part.trim();
                let valid = part == "from"
                    || part == "to"
                    || part.strip_suffix('%').is_some_and(|n| !n.is_empty() && n.parse::<f64>().is_ok());
                if !valid {
                    self.hold("keyframes-selector", part, at);
                    return None;
                }
                let key = if part == "from" || part == "to" { part.to_string() } else { quote(part) };
                let frame = block.child(key);
                for (key, value) in &decls {
                    frame.decls.retain(|(k, _)| k != key);
                    frame.decls.push((key.clone(), value.clone()));
                }
            }
        }
        let mut out = String::from("css.keyframes(");
        block.render(0, &mut out);
        out.push(')');
        Some(out)
    }

    fn read(&mut self, object: &ObjectExpression, path: &Path, root: bool, decls: &mut Vec<Decl>) {
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                self.hold("spread", "...", property.span().start);
                continue;
            };
            let Some(name) = key_name(&property.key).filter(|_| !property.computed) else {
                self.hold("computed-key", self.source(property.key.span()), property.span.start);
                continue;
            };
            let at = property.span.start;
            if let Expression::ObjectExpression(inner) = property.value.get_inner_expression() {
                for next in self.nest(path, &name, at) {
                    self.read(inner, &next, false, decls);
                }
                continue;
            }
            if name == "label" && root && path.at.is_none() && path.pseudo.is_empty() {
                continue;
            }
            let value = &property.value;
            let value = match value.get_inner_expression() {
                Expression::ArrayExpression(_) => None,
                expression if self.root_static(expression) => Some(self.source(value.span()).to_string()),
                expression => self.param(expression),
            };
            let Some(value) = value else {
                let kind = if matches!(property.value.get_inner_expression(), Expression::ArrayExpression(_)) {
                    "fallback-value"
                } else {
                    "dynamic-value"
                };
                self.hold(kind, name, at);
                continue;
            };
            let (prop, key) = if name.starts_with("--") || !name.contains('-') {
                (name.clone(), self.source(property.key.span()).to_string())
            } else {
                let prop = camel(&name);
                (prop.clone(), prop)
            };
            decls.push(Decl { path: path.clone(), prop, key, value, at });
        }
    }

    fn param(&mut self, expression: &Expression) -> Option<String> {
        let source = self.source(expression.span()).to_string();
        let key = expression.span().start.to_string();
        let taken = &self.taken;
        let params = self.params.as_mut()?;
        if let Some((_, _, name)) = params.iter().find(|(k, _, _)| *k == key) {
            return Some(name.clone());
        }
        let name = (0..)
            .map(|i: usize| {
                let letter = (b'a' + (i % 26) as u8) as char;
                if i < 26 { letter.to_string() } else { format!("{letter}{}", i / 26) }
            })
            .find(|n| !taken.contains(n) && !params.iter().any(|(_, _, p)| p == n))
            .unwrap();
        params.push((key, source, name.clone()));
        Some(name)
    }

    fn settle(&mut self, decls: Vec<Decl>) -> Option<String> {
        let mut kept: Vec<Decl> = Vec::new();
        for decl in decls {
            kept.retain(|d| !(d.path == decl.path && d.prop == decl.prop));
            kept.push(decl);
        }
        let mut clean = true;
        for (i, a) in kept.iter().enumerate() {
            for b in &kept[i + 1..] {
                if a.prop != b.prop || a.value == b.value {
                    continue;
                }
                if a.path.at == b.path.at && a.path.pseudo != b.path.pseudo {
                    let (ea, sa) = states(&a.path.pseudo);
                    let (eb, sb) = states(&b.path.pseudo);
                    let nested = sa.iter().all(|s| sb.contains(s)) || sb.iter().all(|s| sa.contains(s));
                    if ea == eb && !nested {
                        self.hold("overlapping-states", format!("{} at {} and {}", a.prop, a.path.pseudo, b.path.pseudo), b.at);
                        clean = false;
                    }
                } else if a.path.pseudo == b.path.pseudo
                    && let (Some(first), Some(second)) = (&a.path.at, &b.path.at)
                    && first != second
                    && !implies_condition(second, first)
                {
                    self.hold("media-order", format!("{} at {first} and {second}", a.prop), b.at);
                    clean = false;
                }
            }
        }
        if !clean {
            return None;
        }
        let mut block = Block::default();
        for decl in kept {
            let mut target = &mut block;
            if let Some(at) = &decl.path.at {
                target = target.child(quote(at));
            }
            if !decl.path.pseudo.is_empty() {
                target = target.child(quote(&decl.path.pseudo));
            }
            target.decls.push((decl.key, decl.value));
        }
        let mut out = String::new();
        block.render(1, &mut out);
        Some(out)
    }

    fn hoist(&mut self, object: &ObjectExpression, name: Option<&str>) -> Option<String> {
        let before = self.holds.len();
        let saved = std::mem::replace(&mut self.params, name.is_none().then(Vec::new));
        let mut decls = Vec::new();
        self.read(object, &Path { at: None, pseudo: String::new() }, true, &mut decls);
        let params = std::mem::replace(&mut self.params, saved).unwrap_or_default();
        if self.holds.len() > before {
            return None;
        }
        self.finish(decls, params, name)
    }

    fn finish(&mut self, decls: Vec<Decl>, params: Params, name: Option<&str>) -> Option<String> {
        let mut body = self.settle(decls)?;
        if !params.is_empty() {
            let names: Vec<&str> = params.iter().map(|(_, _, n)| n.as_str()).collect();
            body = format!("({}) => ({body})", names.join(", "));
        }
        let key = match name {
            Some(name) => name.to_string(),
            None => format!("e{}", &class_hash(&[&body])[1..]),
        };
        if !self.styles.iter().any(|(k, _)| *k == key) {
            self.styles.push((key.clone(), body));
        }
        if params.is_empty() {
            Some(format!("styles.{key}"))
        } else {
            let arguments: Vec<&str> = params.iter().map(|(_, s, _)| s.as_str()).collect();
            Some(format!("styles.{key}({})", arguments.join(", ")))
        }
    }

    fn arguments(&mut self, call: &CallExpression, name: Option<&str>) -> Option<Vec<String>> {
        let objects = call.arguments.iter().filter(|a| matches!(a.as_expression(), Some(Expression::ObjectExpression(_)))).count();
        let mut items = Vec::new();
        for argument in &call.arguments {
            let Some(expression) = argument.as_expression() else {
                self.hold("spread-argument", "...", argument.span().start);
                return None;
            };
            match expression.get_inner_expression() {
                Expression::ObjectExpression(object) => items.push(self.hoist(object, name.filter(|_| objects == 1))?),
                other => items.push(self.item(other)?),
            }
        }
        Some(items)
    }

    fn item(&mut self, expression: &Expression) -> Option<String> {
        match expression.get_inner_expression() {
            Expression::ObjectExpression(object) => self.hoist(object, None),
            Expression::ArrayExpression(array) => {
                let mut items = Vec::new();
                for element in &array.elements {
                    match element.as_expression() {
                        Some(expression) => items.push(self.item(expression)?),
                        None => {
                            self.hold("spread", "...", element.span().start);
                            return None;
                        }
                    }
                }
                Some(format!("[{}]", items.join(", ")))
            }
            Expression::Identifier(identifier) => {
                if identifier.name.as_str() == "undefined" {
                    return Some("undefined".to_string());
                }
                match self.reference(identifier).and_then(|s| self.aliases.get(&s)) {
                    Some(alias) => Some(alias.clone()),
                    None => {
                        self.hold("unknown-style", identifier.name.to_string(), identifier.span.start);
                        None
                    }
                }
            }
            Expression::NullLiteral(_) => Some("null".to_string()),
            Expression::BooleanLiteral(literal) if !literal.value => Some("false".to_string()),
            Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
                let right = self.item(&logical.right)?;
                Some(format!("{} && {right}", self.source(logical.left.span())))
            }
            Expression::ConditionalExpression(conditional) => {
                let consequent = self.item(&conditional.consequent)?;
                let alternate = self.item(&conditional.alternate)?;
                Some(format!("{} ? {consequent} : {alternate}", self.source(conditional.test.span())))
            }
            Expression::CallExpression(call) if self.is_css(&call.callee) => {
                let items = self.arguments(call, None)?;
                Some(if items.len() == 1 { items.into_iter().next().unwrap() } else { format!("[{}]", items.join(", ")) })
            }
            Expression::TaggedTemplateExpression(tagged) if self.is_css(&tagged.tag) => {
                let items = self.template(tagged, None)?;
                Some(if items.len() == 1 { items.into_iter().next().unwrap() } else { format!("[{}]", items.join(", ")) })
            }
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                self.hold("theme-function", "css", expression.span().start);
                None
            }
            other => {
                self.hold("unknown-style", self.source(other.span()).to_string(), other.span().start);
                None
            }
        }
    }
}

impl<'a> Visit<'a> for Scan<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        let opening = &element.opening_element;
        if let JSXElementName::IdentifierReference(name) = &opening.name
            && let Some((tag, sx)) = self.reference(name).and_then(|s| self.components.get(&s)).cloned()
        {
            if !tag.is_empty() {
                self.styled_element(element, &tag, &sx);
            }
            for item in &opening.attributes {
                self.visit_jsx_attribute_item(item);
            }
            for child in &element.children {
                self.visit_jsx_child(child);
            }
            return;
        }
        walk::walk_jsx_element(self, element);
    }

    fn visit_jsx_opening_element(&mut self, opening: &JSXOpeningElement<'a>) {
        let mut css = None;
        let mut beside = None;
        let mut spread = false;
        for (index, item) in opening.attributes.iter().enumerate() {
            match item {
                JSXAttributeItem::SpreadAttribute(_) => spread = true,
                JSXAttributeItem::Attribute(attribute) => {
                    if let JSXAttributeName::Identifier(name) = &attribute.name {
                        let name = name.name.as_str();
                        if name == "css" {
                            css = Some((index, attribute));
                        } else if name == "className" || name == self.style_prop {
                            beside = Some(name.to_string());
                        }
                    }
                }
            }
        }
        let Some((index, attribute)) = css else {
            return walk::walk_jsx_opening_element(self, opening);
        };
        let at = attribute.span.start;
        let intrinsic = matches!(&opening.name, JSXElementName::Identifier(identifier)
            if identifier.name.starts_with(|c: char| c.is_ascii_lowercase()));
        let expression = match &attribute.value {
            Some(JSXAttributeValue::ExpressionContainer(container)) => container.expression.as_expression(),
            _ => None,
        };
        if !intrinsic {
            self.hold("component-css", self.source(opening.name.span()).to_string(), at);
        } else if spread {
            self.hold("spread-props", self.source(opening.name.span()).to_string(), at);
        } else if let Some(name) = beside {
            self.hold("css-beside-attribute", name, at);
        } else if let Some(expression) = expression {
            if let Some(value) = self.item(expression) {
                self.edits.push((attribute.span.start, attribute.span.end, format!("{}={{{value}}}", self.style_prop)));
            }
        } else {
            self.hold("unknown-style", "css", at);
        }
        self.visit_jsx_element_name(&opening.name);
        for (i, item) in opening.attributes.iter().enumerate() {
            if i != index {
                self.visit_jsx_attribute_item(item);
            }
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.handled.contains(&call.span.start) {
            return;
        }
        if self.is_css(&call.callee) {
            return self.hold("css-not-top-level", "css", call.span.start);
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if self.handled.contains(&tagged.span.start) {
            return;
        }
        if self.is_css(&tagged.tag) {
            return self.hold("css-not-top-level", "css``", tagged.span.start);
        }
        walk::walk_tagged_template_expression(self, tagged);
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(symbol) = self.reference(identifier) else { return };
        if self.jsx.contains(&symbol) {
            self.hold("jsx-call", identifier.name.to_string(), identifier.span.start);
        } else if self.aliases.contains_key(&symbol) || self.components.contains_key(&symbol) {
            self.hold("style-used-elsewhere", identifier.name.to_string(), identifier.span.start);
        } else if self.css.contains(&symbol) || self.styled.contains(&symbol) || self.keyframes.contains(&symbol) {
            self.hold("unsupported-use", identifier.name.to_string(), identifier.span.start);
        }
    }
}

fn pragma<'t>(comment: &'t str, tag: &str) -> Option<&'t str> {
    let at = comment.find(&format!("{tag} ")).or_else(|| comment.find(&format!("{tag}\t")))?;
    comment[at + tag.len()..].split_whitespace().next().map(|value| value.trim_end_matches("*/"))
}

fn through_newline(text: &str, span: Span) -> (u32, u32) {
    let end = if text[span.end as usize..].starts_with('\n') { span.end + 1 } else { span.end };
    (span.start, end)
}

pub fn scan_file(file: &str, text: &str, style_prop: &str, exports: &dyn Fn(&str, &str) -> Option<Shape>) -> Outcome {
    let mut out = Outcome::default();
    if !text.contains("emotion") && !text.contains("css=") {
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
        css: FxHashSet::default(),
        styled: FxHashSet::default(),
        keyframes: FxHashSet::default(),
        jsx: FxHashSet::default(),
        animations: Vec::new(),
        reads: RefCell::default(),
        components: FxHashMap::default(),
        aliases: FxHashMap::default(),
        handled: FxHashSet::default(),
        taken: scoping.symbol_ids().map(|s| scoping.symbol_name(s).to_string()).collect(),
        params: None,
        kinds: {
            let inits = const_inits(program);
            scoping
                .symbol_ids()
                .filter(|&s| scoping.symbol_scope_id(s) == scoping.root_scope_id())
                .filter_map(|s| {
                    let name = scoping.symbol_name(s);
                    Some((s, constant(name, &inits, &mut Vec::new())?))
                })
                .collect()
        },
        imported: FxHashMap::default(),
        exports,
        styles: Vec::new(),
        edits: Vec::new(),
        holds: Vec::new(),
    };

    let mut insert_at = program.directives.last().map_or(0, |d| d.span.end);
    let mut imports: Vec<Span> = Vec::new();
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
        for specifier in declaration.specifiers.iter().flatten() {
            let (local, imported) = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => (&named.local, named.imported.name().to_string()),
                ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => (&default.local, "default".to_string()),
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => continue,
            };
            if let Some(symbol) = local.symbol_id.get() {
                scan.imported.insert(symbol, (source.to_string(), imported));
            }
        }
        if source.starts_with("@plumeria/") {
            scan.hold("plumeria-import", source, declaration.span.start);
        } else if source == STYLED {
            imports.push(declaration.span);
            for specifier in declaration.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                        scan.styled.extend(default.local.symbol_id.get())
                    }
                    _ => scan.hold("unsupported-api", source, specifier.span().start),
                }
            }
        } else if source.starts_with("@emotion/") && source != PACKAGE {
            scan.hold("unsupported-import", source, declaration.span.start);
        } else if source == PACKAGE {
            imports.push(declaration.span);
            for specifier in declaration.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(named) => match named.imported.name().as_str() {
                        "css" => scan.css.extend(named.local.symbol_id.get()),
                        "jsx" => scan.jsx.extend(named.local.symbol_id.get()),
                        "keyframes" => scan.keyframes.extend(named.local.symbol_id.get()),
                        other => scan.hold("unsupported-api", other, named.span.start),
                    },
                    _ => scan.hold("namespace-import", source, specifier.span().start),
                }
            }
        }
    }

    for comment in &program.comments {
        let body = &text[comment.span.start as usize..comment.span.end as usize];
        let foreign = pragma(body, "@jsxImportSource").is_some_and(|source| source != PACKAGE)
            || pragma(body, "@jsx").is_some_and(|factory| factory != "jsx" || scan.jsx.is_empty());
        if foreign {
            return Outcome::default();
        }
    }
    let mut removals: Vec<Span> = Vec::new();
    for statement in &program.body {
        let (declaration, exported) = match statement {
            Statement::VariableDeclaration(declaration) => (declaration, false),
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(declaration) => (declaration, true),
                _ => continue,
            },
            _ => continue,
        };
        for declarator in &declaration.declarations {
            let Some(init) = declarator.init.as_ref().map(|e| e.get_inner_expression()) else { continue };
            let keyframes = match init {
                Expression::TaggedTemplateExpression(tagged) => scan.is_keyframes(&tagged.tag),
                Expression::CallExpression(call) => scan.is_keyframes(&call.callee),
                _ => false,
            };
            if !keyframes {
                continue;
            }
            scan.handled.insert(init.span().start);
            if let Some(text) = scan.frames(init) {
                scan.animations.push((init.span().start, init.span().end, text));
                if let BindingPattern::BindingIdentifier(identifier) = &declarator.id
                    && declaration.kind == VariableDeclarationKind::Const
                {
                    scan.kinds.extend(identifier.symbol_id.get().map(|s| (s, Shape::Frames)));
                }
            }
        }
        let calls: Vec<_> = declaration
            .declarations
            .iter()
            .filter_map(|d| match d.init.as_ref().map(|e| e.get_inner_expression()) {
                Some(init @ Expression::CallExpression(call)) if scan.is_css(&call.callee) => Some((d, init)),
                Some(init @ Expression::TaggedTemplateExpression(tagged)) if scan.is_css(&tagged.tag) => Some((d, init)),
                Some(init @ Expression::TaggedTemplateExpression(tagged)) if scan.styled_tag(&tagged.tag).is_some() => {
                    Some((d, init))
                }
                Some(init @ Expression::CallExpression(call)) if scan.styled_tag(&call.callee).is_some() => Some((d, init)),
                _ => None,
            })
            .collect();
        if calls.is_empty() {
            continue;
        }
        scan.handled.extend(calls.iter().map(|(_, init)| init.span().start));
        if exported {
            scan.hold("exported-style", "css", statement.span().start);
            continue;
        }
        if calls.len() != declaration.declarations.len() {
            scan.hold("mixed-declaration", "css", statement.span().start);
            continue;
        }
        for (declarator, init) in calls {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                scan.hold("destructured-style", "css", declarator.span.start);
                continue;
            };
            let name = Some(identifier.name.as_str());
            let tag = match init {
                Expression::TaggedTemplateExpression(tagged) => scan.styled_tag(&tagged.tag),
                Expression::CallExpression(call) => scan.styled_tag(&call.callee),
                _ => None,
            };
            let tag = match tag {
                Some(Err(kind)) => {
                    scan.hold(kind, identifier.name.as_str(), declarator.span.start);
                    if let Some(symbol) = identifier.symbol_id.get() {
                        scan.components.insert(symbol, (String::new(), String::new()));
                    }
                    continue;
                }
                Some(Ok(tag)) => Some(tag),
                None => None,
            };
            let items = match init {
                Expression::TaggedTemplateExpression(tagged) => scan.template(tagged, name),
                Expression::CallExpression(call) => scan.arguments(call, name),
                _ => None,
            };
            let alias = match items {
                Some(items) if items.len() == 1 => items.into_iter().next().unwrap(),
                Some(items) => format!("[{}]", items.join(", ")),
                None => String::new(),
            };
            let Some(symbol) = identifier.symbol_id.get() else { continue };
            match tag {
                Some(tag) => {
                    scan.components.insert(symbol, (tag, alias));
                }
                None => {
                    scan.aliases.insert(symbol, alias);
                }
            }
        }
        removals.push(statement.span());
    }

    scan.visit_program(program);
    if scan.styles.is_empty() && scan.edits.is_empty() && scan.holds.is_empty() && imports.is_empty() {
        return out;
    }
    let taken: Vec<&str> = ["css", "styles"]
        .into_iter()
        .filter(|name| {
            scoping.symbol_ids().any(|s| {
                scoping.symbol_name(s) == *name && !scan.css.contains(&s) && !scan.styled.contains(&s)
            })
        })
        .collect();
    for name in taken {
        scan.hold("binding-taken", name, 0);
    }
    let statement_of = |at: u32| program.body.iter().find(|s| s.span().start <= at && at < s.span().end);
    let after = scan
        .reads
        .borrow()
        .iter()
        .filter_map(|&symbol| statement_of(scoping.symbol_span(symbol).start))
        .filter(|s| !matches!(s, Statement::ImportDeclaration(_) | Statement::FunctionDeclaration(_)))
        .map(|s| s.span().end)
        .max();
    let first = removals.iter().map(|s| s.start).chain(scan.edits.iter().map(|e| e.0)).min();
    let mut anchor = first.and_then(statement_of).map(|s| s.span());
    let mut place_after = None;
    if let Some(after) = after
        && anchor.is_some_and(|a| a.start < after)
    {
        let early = scan.edits.iter().filter_map(|e| statement_of(e.0)).find(|s| s.span().start < after);
        match early {
            Some(statement) => scan.hold("hoist-order", "styles", statement.span().start),
            None => {
                anchor = None;
                place_after = Some(after);
            }
        }
    }
    out.depends = scan
        .reads
        .borrow()
        .iter()
        .filter_map(|symbol| scan.imported.get(symbol))
        .filter(|(source, name)| exports(source, name) == Some(Shape::Frames))
        .cloned()
        .collect();
    out.holds = scan.holds;
    if !out.holds.is_empty() {
        return out;
    }

    let mut create = String::from("const styles = css.create({\n");
    for (key, body) in &scan.styles {
        create.push_str(&format!("  {key}: {body},\n"));
    }
    create.push_str("});");
    let header = "import * as css from '@plumeria/core';";
    let uses = !scan.styles.is_empty() || !scan.animations.is_empty();
    let mut edits = Vec::new();
    for (index, span) in imports.iter().enumerate() {
        if index == 0 && uses {
            edits.push((span.start, span.end, header.to_string()));
        } else {
            let (start, end) = through_newline(text, *span);
            edits.push((start, end, String::new()));
        }
    }
    if imports.is_empty() && uses {
        if insert_at == 0 {
            edits.push((0, 0, format!("{header}\n\n")));
        } else {
            edits.push((insert_at, insert_at, format!("\n{header}")));
        }
    }
    edits.extend(scan.edits);
    edits.extend(scan.animations);
    for comment in &program.comments {
        let body = &text[comment.span.start as usize..comment.span.end as usize];
        if body.contains("@jsxImportSource @emotion/react") || body.contains("@jsx jsx") || body.contains("@jsxRuntime classic") {
            let (start, end) = through_newline(text, comment.span);
            edits.push((start, end, String::new()));
        }
    }
    let mut last = 0;
    for span in &removals {
        let (start, end) = through_newline(text, *span);
        if Some(*span) == anchor {
            edits.push((start, end, format!("{create}\n")));
        } else {
            let blank = start > last && text[..start as usize].ends_with("\n\n");
            edits.push((if blank { start - 1 } else { start }, end, String::new()));
        }
        last = end;
    }
    if let Some(anchor) = anchor.filter(|a| !removals.contains(a) && !scan.styles.is_empty()) {
        edits.push((anchor.start, anchor.start, format!("{create}\n\n")));
    }
    if let Some(after) = place_after.filter(|_| !scan.styles.is_empty()) {
        edits.push((after, after, format!("\n{create}")));
    }
    edits.sort_by_key(|(start, end, _)| (*start, *end));
    out.rewritten = Some(apply(text, &edits));
    out
}

fn configs() -> Vec<String> {
    let Ok(read) = fs::read_dir(".") else { return Vec::new() };
    let mut names: Vec<String> = read
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|name| {
            name == ".babelrc"
                || name.starts_with(".babelrc.")
                || name.starts_with("babel.config.")
                || (name.starts_with("tsconfig") && name.ends_with(".json"))
                || (name.starts_with("next.config.") || name.starts_with("vite.config."))
        })
        .filter(|name| fs::read_to_string(name).is_ok_and(|text| text.contains("@emotion/")))
        .collect();
    names.sort();
    names
}

pub fn plan(sources: &[(String, String)], paths: Option<&Paths>, style_prop: &str) -> Vec<Outcome> {
    let modules: FxHashMap<String, Module> =
        sources.iter().map(|(file, text)| (file.clone(), module(file, text))).collect();
    let index: FxHashMap<&str, usize> = sources.iter().enumerate().map(|(i, (file, _))| (file.as_str(), i)).collect();
    let mut outcomes: Vec<Outcome> = sources
        .iter()
        .map(|(file, text)| {
            let exports = |specifier: &str, name: &str| resolve_kind(&modules, paths, file, specifier, name);
            scan_file(file, text, style_prop, &exports)
        })
        .collect();
    loop {
        let mut fresh = false;
        for i in 0..outcomes.len() {
            if outcomes[i].rewritten.is_none() {
                continue;
            }
            let blocked = outcomes[i].depends.iter().find_map(|(specifier, name)| {
                let (site, _) = resolve_site(&modules, paths, &sources[i].0, specifier, name)?;
                outcomes[index[site.as_str()]].rewritten.is_none().then_some(site)
            });
            if let Some(site) = blocked {
                outcomes[i].rewritten = None;
                outcomes[i].holds.push(Hold { kind: "linked-to-held", detail: site, at: 0 });
                fresh = true;
            }
        }
        if !fresh {
            return outcomes;
        }
    }
}

pub fn run(options: &Options) -> ExitCode {
    let mut project = Vec::new();
    walk_files("", &mut project);
    let sources: Vec<(String, String)> = project
        .iter()
        .filter(|p| SOURCES.contains(&extension(p)))
        .filter_map(|p| Some((p.clone(), fs::read_to_string(p).ok()?)))
        .collect();
    let configs = configs();
    if configs.is_empty() && !sources.iter().any(|(_, text)| text.contains(PACKAGE) || text.contains(STYLED)) {
        println!("No {PACKAGE} or {STYLED} import found.");
        return ExitCode::SUCCESS;
    }

    let paths = Paths::load(|path| fs::read_to_string(path).ok());
    let mut converted = Vec::new();
    let mut held = Vec::new();
    for (i, outcome) in plan(&sources, paths.as_ref(), &options.style_prop).into_iter().enumerate() {
        let (file, text) = &sources[i];
        if let Some(rewritten) = outcome.rewritten {
            converted.push((file, rewritten));
        } else if !outcome.holds.is_empty() {
            held.push((file, text, outcome.holds));
        }
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
    if !configs.is_empty() {
        println!("\nThese configs still name @emotion. Remove the jsxImportSource and the Emotion Babel plugin once nothing is left:");
        for config in &configs {
            println!("  {config}");
        }
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
