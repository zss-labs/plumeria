use std::sync::{Mutex, OnceLock, RwLock};

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_span::{GetSpan, Span};
use oxc_syntax::symbol::SymbolId;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::eval::consts::top_level_variable_declarations;
use crate::fs::path::{dirname, relative};
use crate::fs::resolver::Resolver;
use crate::js::json::quote;
use crate::syntax::module::{CORE, SpecKind, import_specs, module_export_name};
use crate::syntax::parse::parse_file_program;

pub const REACT: &str = "@plumeria/react";
const PREFIX: &str = "__styled";

type R<T> = Result<T, String>;

fn style_prop_cell() -> &'static RwLock<String> {
    static CELL: OnceLock<RwLock<String>> = OnceLock::new();
    CELL.get_or_init(|| RwLock::new("sx".to_string()))
}

pub fn set_style_prop(style_prop: &str) {
    if style_prop.is_empty() {
        return;
    }
    let mut cell = style_prop_cell().write().unwrap();
    if *cell != style_prop {
        *cell = style_prop.to_string();
    }
}

pub fn style_prop() -> String {
    style_prop_cell().read().unwrap().clone()
}

fn resolve_import(import_path: &str, importer: &str) -> Option<String> {
    static RESOLVER: OnceLock<Mutex<Resolver>> = OnceLock::new();
    RESOLVER
        .get_or_init(|| Mutex::new(Resolver::default()))
        .lock()
        .unwrap()
        .resolve_import_path(import_path, importer)
}

fn error(message: impl AsRef<str>) -> String {
    format!("[plumeria] {}", message.as_ref())
}

fn text(source: &str, span: Span) -> &str {
    &source[span.start as usize..span.end as usize]
}

fn unparen<'b, 'a>(mut expr: &'b Expression<'a>) -> &'b Expression<'a> {
    while let Expression::ParenthesizedExpression(paren) = expr {
        expr = &paren.expression;
    }
    expr
}

struct Dyn {
    path: Vec<String>,
    leaf: String,
    function: String,
    reads: Vec<String>,
}

struct Rule {
    statics: Vec<String>,
    dyns: Vec<Dyn>,
}

enum Target {
    Tag(String),
    Local(String),
    Import { source: String, name: String },
}

struct Def {
    name: String,
    statement_start: u32,
    init: Span,
    target: Target,
    rule: Rule,
}

#[derive(Clone)]
struct Layer {
    binding: String,
    has_base: bool,
    fns: Vec<Vec<String>>,
}

#[derive(Clone)]
struct Chain {
    tag: String,
    layers: Vec<Layer>,
}

struct Scope<'s> {
    scoping: &'s Scoping,
    definitions: FxHashSet<SymbolId>,
}

impl Scope<'_> {
    fn symbol_of(&self, ident: &IdentifierReference) -> Option<SymbolId> {
        let reference = ident.reference_id.get()?;
        self.scoping.get_reference(reference).symbol_id()
    }
}

struct ParamUses<'p> {
    param: Option<SymbolId>,
    scope: &'p Scope<'p>,
    bare: usize,
    members: Vec<String>,
    branches: bool,
    definition: Option<String>,
}

impl ParamUses<'_> {
    fn is_param(&self, ident: &IdentifierReference) -> bool {
        self.param.is_some() && self.scope.symbol_of(ident) == self.param
    }
}

impl<'a> Visit<'a> for ParamUses<'_> {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if self.is_param(it) {
            self.bare += 1;
        } else if self.definition.is_none()
            && self
                .scope
                .symbol_of(it)
                .is_some_and(|symbol| self.scope.definitions.contains(&symbol))
        {
            self.definition = Some(it.name.to_string());
        }
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if let Expression::Identifier(object) = unparen(&it.object)
            && self.is_param(object)
        {
            let name = it.property.name.to_string();
            if !self.members.contains(&name) {
                self.members.push(name);
            }
            return;
        }
        walk::walk_static_member_expression(self, it);
    }

    fn visit_conditional_expression(&mut self, it: &ConditionalExpression<'a>) {
        self.branches = true;
        walk::walk_conditional_expression(self, it);
    }

    fn visit_logical_expression(&mut self, it: &LogicalExpression<'a>) {
        self.branches = true;
        walk::walk_logical_expression(self, it);
    }

    fn visit_ts_type_annotation(&mut self, _it: &TSTypeAnnotation<'a>) {}
}

fn dynamic_reads(function: &Expression, label: &str, scope: &Scope) -> R<Vec<String>> {
    let Expression::ArrowFunctionExpression(arrow) = function else {
        return Err(error(format!(
            "\"{label}\" must be an arrow function with an expression body, as in (props) => props.value."
        )));
    };
    let body = match arrow.get_expression() {
        Some(body) => body,
        _ => {
            return Err(error(format!(
                "\"{label}\" must be an arrow function with an expression body, as in (props) => props.value."
            )));
        }
    };
    if arrow.params.items.len() != 1 || arrow.params.rest.is_some() {
        return Err(error(format!(
            "\"{label}\" must take exactly one parameter, the component props."
        )));
    }
    let (param, mut reads) = match &arrow.params.items[0].pattern {
        BindingPattern::BindingIdentifier(ident) => (Some(ident), Vec::new()),
        BindingPattern::ObjectPattern(pattern) => {
            if pattern.rest.is_some() {
                return Err(error(format!(
                    "\"{label}\" cannot use a rest element in its parameter. Name each prop it reads."
                )));
            }
            let mut names = Vec::new();
            for property in &pattern.properties {
                let PropertyKey::StaticIdentifier(key) = &property.key else {
                    return Err(error(format!(
                        "\"{label}\" must destructure props by name."
                    )));
                };
                if !matches!(property.value, BindingPattern::BindingIdentifier(_)) {
                    return Err(error(format!(
                        "\"{label}\" cannot use a default value or a nested pattern in its parameter."
                    )));
                }
                names.push(key.name.to_string());
            }
            (None, names)
        }
        _ => {
            return Err(error(format!(
                "\"{label}\" must take the props as one name or as a destructured object."
            )));
        }
    };
    let mut uses = ParamUses {
        param: param.and_then(|ident| ident.symbol_id.get()),
        scope,
        bare: 0,
        members: Vec::new(),
        branches: false,
        definition: None,
    };
    uses.visit_expression(body);
    if let Some(name) = uses.definition {
        return Err(error(format!(
            "\"{label}\" reads the Plumeria definition \"{name}\", which has no value at runtime. Read it in a static value of the rule instead."
        )));
    }
    if uses.branches {
        return Err(error(format!(
            "\"{label}\" branches its value. A value that may or may not override cannot be resolved at build time; split the variants into separate styled components."
        )));
    }
    if let Some(param) = param {
        if uses.bare > 0 {
            return Err(error(format!(
                "\"{label}\" must read props by name, as in {}.value.",
                param.name
            )));
        }
        reads = uses.members;
    }
    Ok(reads)
}

fn key_text(source: &str, property: &ObjectProperty) -> String {
    let key = text(source, property.key.span());
    if property.computed {
        format!("[{key}]")
    } else {
        key.to_string()
    }
}

fn split_rule(
    source: &str,
    object: &ObjectExpression,
    path: &[String],
    scope: &Scope,
    rule: &mut Rule,
    statics: &mut Vec<String>,
) -> R<()> {
    for property in &object.properties {
        let property = match property {
            ObjectPropertyKind::SpreadProperty(spread) => {
                statics.push(text(source, spread.span).to_string());
                continue;
            }
            ObjectPropertyKind::ObjectProperty(property) => property,
        };
        if property.method || property.kind != PropertyKind::Init {
            return Err(error("A styled rule cannot hold methods or accessors."));
        }
        let key = key_text(source, property);
        let selector = property.computed
            || key
                .trim_start_matches(['\'', '"'])
                .starts_with([':', '[', '@']);
        match unparen(&property.value) {
            value
            @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) => {
                let label = path
                    .iter()
                    .chain(std::iter::once(&key))
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" ");
                let reads = dynamic_reads(value, &label, scope)?;
                rule.dyns.push(Dyn {
                    path: path.to_vec(),
                    leaf: key,
                    function: text(source, value.span()).to_string(),
                    reads,
                });
            }
            Expression::ObjectExpression(inner) if selector => {
                let mut nested = Vec::new();
                let mut inner_path = path.to_vec();
                inner_path.push(key.clone());
                split_rule(source, inner, &inner_path, scope, rule, &mut nested)?;
                if !nested.is_empty() {
                    statics.push(format!("{key}: {{ {} }}", nested.join(", ")));
                }
            }
            _ => statics.push(text(source, property.span).to_string()),
        }
    }
    Ok(())
}

fn styled_target(
    callee: &Expression,
    styled: &FxHashSet<String>,
    imports: &FxHashMap<String, (String, String)>,
    source: &str,
) -> R<Option<Target>> {
    match unparen(callee) {
        Expression::StaticMemberExpression(member) => match unparen(&member.object) {
            Expression::Identifier(object) if styled.contains(object.name.as_str()) => {
                Ok(Some(Target::Tag(member.property.name.to_string())))
            }
            _ => Ok(None),
        },
        Expression::CallExpression(call) => {
            let Expression::Identifier(ident) = unparen(&call.callee) else {
                return Ok(None);
            };
            if !styled.contains(ident.name.as_str()) {
                return Ok(None);
            }
            let argument = match call.arguments.as_slice() {
                [argument] => argument.as_expression(),
                _ => None,
            };
            let Some(Expression::Identifier(component)) = argument.map(unparen) else {
                let label = argument
                    .map(|argument| text(source, argument.span()).to_string())
                    .unwrap_or_default();
                return Err(error(format!(
                    "styled({label}) must name a styled component directly. A component chosen at runtime cannot be resolved at build time."
                )));
            };
            let name = component.name.to_string();
            Ok(Some(match imports.get(&name) {
                Some((source, imported)) => Target::Import {
                    source: source.clone(),
                    name: imported.clone(),
                },
                None => Target::Local(name),
            }))
        }
        _ => Ok(None),
    }
}

fn definitions(program: &Program) -> FxHashSet<SymbolId> {
    let mut namespaces = FxHashSet::default();
    let mut named = FxHashSet::default();
    for statement in &program.body {
        let Statement::ImportDeclaration(decl) = statement else {
            continue;
        };
        if decl.source.value.as_str() != Some(CORE) {
            continue;
        }
        for spec in import_specs(decl) {
            match spec.kind {
                SpecKind::Named => named.insert(spec.local.to_string()),
                SpecKind::Default | SpecKind::Namespace => {
                    namespaces.insert(spec.local.to_string())
                }
            };
        }
    }
    let mut names = FxHashSet::default();
    for declaration in top_level_variable_declarations(program) {
        for declarator in &declaration.declarations {
            let Some(Expression::CallExpression(call)) = declarator.init.as_ref().map(unparen)
            else {
                continue;
            };
            let core = match unparen(&call.callee) {
                Expression::StaticMemberExpression(member) => matches!(
                    unparen(&member.object),
                    Expression::Identifier(object) if namespaces.contains(object.name.as_str())
                ),
                Expression::Identifier(ident) => named.contains(ident.name.as_str()),
                _ => false,
            };
            if core
                && let BindingPattern::BindingIdentifier(ident) = &declarator.id
                && let Some(symbol) = ident.symbol_id.get()
            {
                names.insert(symbol);
            }
        }
    }
    names
}

#[derive(Default)]
struct Names {
    found: FxHashSet<String>,
}

impl Names {
    fn record(&mut self, name: &str) {
        if name.starts_with(PREFIX) {
            self.found.insert(name.to_string());
        }
    }
}

impl<'a> Visit<'a> for Names {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        self.record(it.name.as_str());
    }

    fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
        self.record(it.name.as_str());
    }

    fn visit_module_export_name(&mut self, it: &ModuleExportName<'a>) {
        self.record(module_export_name(it));
    }
}

fn prefix_of(program: &Program) -> String {
    let mut names = Names::default();
    names.visit_program(program);
    (0..)
        .map(|index: usize| match index {
            0 => PREFIX.to_string(),
            _ => format!("{PREFIX}{index}"),
        })
        .find(|prefix| {
            let lead = format!("{prefix}_");
            !names.found.iter().any(|name| name.starts_with(&lead))
        })
        .unwrap()
}

fn property_key(name: &str) -> String {
    let mut chars = name.chars();
    let identifier = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
    if identifier {
        name.to_string()
    } else {
        quote(name)
    }
}

struct StyledRefs<'s> {
    scope: &'s Scope<'s>,
    symbols: FxHashSet<SymbolId>,
    count: usize,
}

impl<'a> Visit<'a> for StyledRefs<'_> {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if self
            .scope
            .symbol_of(it)
            .is_some_and(|symbol| self.symbols.contains(&symbol))
        {
            self.count += 1;
        }
    }

    fn visit_ts_type(&mut self, _it: &TSType<'a>) {}
}

fn styled_symbols(program: &Program, styled: &FxHashSet<String>) -> FxHashSet<SymbolId> {
    let mut symbols = FxHashSet::default();
    for statement in &program.body {
        let Statement::ImportDeclaration(decl) = statement else {
            continue;
        };
        if decl.source.value.as_str() != Some(REACT) {
            continue;
        }
        for specifier in decl.specifiers.iter().flatten() {
            if let ImportDeclarationSpecifier::ImportSpecifier(spec) = specifier
                && styled.contains(spec.local.name.as_str())
                && let Some(symbol) = spec.local.symbol_id.get()
            {
                symbols.insert(symbol);
            }
        }
    }
    symbols
}

struct Analysis {
    file: String,
    prefix: String,
    react_imports: Vec<Span>,
    defs: Vec<Def>,
    exports: Vec<(String, String)>,
}

impl Analysis {
    fn of(program: &Program, source: &str, file: &str) -> R<Option<Self>> {
        let mut styled = FxHashSet::default();
        let mut react_imports = Vec::new();
        let mut imports = FxHashMap::default();
        for statement in &program.body {
            let Statement::ImportDeclaration(decl) = statement else {
                continue;
            };
            let Some(from) = decl.source.value.as_str() else {
                continue;
            };
            if from == REACT {
                if decl.import_kind.is_type() {
                    continue;
                }
                let mut binds = false;
                for spec in import_specs(decl) {
                    if spec.type_only {
                        continue;
                    }
                    match spec.kind {
                        SpecKind::Named if spec.imported == "styled" => {
                            styled.insert(spec.local.to_string());
                            binds = true;
                        }
                        SpecKind::Named => {}
                        _ => {
                            return Err(error(format!(
                                "Import styled from \"{REACT}\" by name, as in import {{ styled }} from \"{REACT}\"."
                            )));
                        }
                    }
                }
                if binds {
                    react_imports.push(decl.span);
                }
                continue;
            }
            for spec in import_specs(decl) {
                if spec.kind != SpecKind::Namespace && !spec.type_only {
                    imports.insert(
                        spec.local.to_string(),
                        (from.to_string(), spec.imported.clone()),
                    );
                }
            }
        }
        if styled.is_empty() {
            return Ok(None);
        }
        let semantic = SemanticBuilder::new().build(program).semantic;
        let scope = Scope {
            scoping: semantic.scoping(),
            definitions: definitions(program),
        };

        let mut defs = Vec::new();
        let mut exports = Vec::new();
        for statement in &program.body {
            let (declaration, exported) = match statement {
                Statement::VariableDeclaration(declaration) => (&**declaration, false),
                Statement::ExportDeclaration(export) => match &export.declaration {
                    Declaration::VariableDeclaration(declaration) => (&**declaration, true),
                    _ => continue,
                },
                Statement::ExportNamedDeclaration(export) => {
                    for spec in &export.specifiers {
                        exports.push((
                            module_export_name(&spec.local).to_string(),
                            module_export_name(&spec.exported).to_string(),
                        ));
                    }
                    continue;
                }
                Statement::ExportDefaultDeclaration(export) => {
                    match export.declaration.as_expression().map(unparen) {
                        Some(Expression::Identifier(ident)) => {
                            exports.push((ident.name.to_string(), "default".to_string()));
                        }
                        Some(Expression::CallExpression(call))
                            if styled_target(&call.callee, &styled, &imports, source)?
                                .is_some() =>
                        {
                            return Err(error(
                                "A default export of styled needs a name. Declare it as const Button = styled.button({...}), then export default Button.",
                            ));
                        }
                        _ => {}
                    }
                    continue;
                }
                _ => continue,
            };
            for declarator in &declaration.declarations {
                let Some(Expression::CallExpression(call)) = declarator.init.as_ref().map(unparen)
                else {
                    continue;
                };
                let Some(target) = styled_target(&call.callee, &styled, &imports, source)? else {
                    continue;
                };
                let BindingPattern::BindingIdentifier(ident) = &declarator.id else {
                    return Err(error(
                        "A styled component must be bound to one name, as in const Button = styled.button({...}).",
                    ));
                };
                if declaration.kind != VariableDeclarationKind::Const {
                    return Err(error(format!(
                        "Declare \"{}\" with const. A styled component cannot be reassigned.",
                        ident.name
                    )));
                }
                let object = match call.arguments.as_slice() {
                    [argument] => argument.as_expression().map(unparen),
                    _ => None,
                };
                let Some(Expression::ObjectExpression(object)) = object else {
                    return Err(error(format!(
                        "\"{}\" must pass its rule as an object literal.",
                        ident.name
                    )));
                };
                let mut rule = Rule {
                    statics: Vec::new(),
                    dyns: Vec::new(),
                };
                let mut statics = Vec::new();
                split_rule(source, object, &[], &scope, &mut rule, &mut statics)?;
                rule.statics = statics;
                let name = ident.name.to_string();
                if exported {
                    exports.push((name.clone(), name.clone()));
                }
                defs.push(Def {
                    name,
                    statement_start: statement.span().start,
                    init: call.span,
                    target,
                    rule,
                });
            }
        }

        let mut refs = StyledRefs {
            scope: &scope,
            symbols: styled_symbols(program, &styled),
            count: 0,
        };
        refs.visit_program(program);
        if refs.count != defs.len() {
            return Err(error(
                "styled can only be called at the top level, as in const Button = styled.button({...}).",
            ));
        }

        let defined: FxHashSet<&str> = defs.iter().map(|def| def.name.as_str()).collect();
        exports.retain(|(local, _)| defined.contains(local.as_str()));
        Ok(Some(Self {
            file: file.to_string(),
            prefix: prefix_of(program),
            react_imports,
            defs,
            exports,
        }))
    }

    fn local_for_export(&self, exported: &str) -> Option<&str> {
        self.exports
            .iter()
            .find(|(_, name)| name == exported)
            .map(|(local, _)| local.as_str())
    }
}

#[derive(Default)]
struct Imports {
    by_source: Vec<(String, Vec<(String, String)>)>,
}

impl Imports {
    fn add(&mut self, source: &str, imported: String, local: String) {
        match self.by_source.iter_mut().find(|(from, _)| from == source) {
            Some((_, specs)) => specs.push((imported, local)),
            None => self
                .by_source
                .push((source.to_string(), vec![(imported, local)])),
        }
    }
}

fn encode_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || c == '_' {
            out.push(c);
        } else {
            out.push_str(&format!("${:x}$", c as u32));
        }
    }
    out
}

const MAX_STYLED_DEPTH: usize = 16;

fn too_deep() -> String {
    error(format!(
        "Styled inheritance exceeds {MAX_STYLED_DEPTH} levels (including the base component)."
    ))
}

fn layer_name(prefix: &str, component: &str, index: usize) -> String {
    format!("{prefix}_{}__{index}", encode_name(component))
}

struct Chains<'s> {
    analysis: &'s Analysis,
    memo: FxHashMap<String, Chain>,
    visiting: Vec<(String, String)>,
    imports: Option<&'s mut Imports>,
}

impl Chains<'_> {
    fn chain(&mut self, name: &str, depth: usize) -> R<Chain> {
        if depth > MAX_STYLED_DEPTH {
            return Err(too_deep());
        }
        if let Some(chain) = self.memo.get(name) {
            if depth - 1 + chain.layers.len() > MAX_STYLED_DEPTH {
                return Err(too_deep());
            }
            return Ok(chain.clone());
        }
        let key = (self.analysis.file.clone(), name.to_string());
        if self.visiting.contains(&key) {
            return Err(error(format!("\"{name}\" extends itself.")));
        }
        let Some(def) = self.analysis.defs.iter().find(|def| def.name == name) else {
            return Err(error(format!(
                "\"{name}\" is not a styled component. styled() accepts only components defined with styled."
            )));
        };
        self.visiting.push(key);
        let base = match &def.target {
            Target::Tag(tag) => Chain {
                tag: tag.clone(),
                layers: Vec::new(),
            },
            Target::Local(base) => self.chain(base, depth + 1)?,
            Target::Import {
                source,
                name: imported,
            } => {
                let foreign = foreign_chain(
                    source,
                    imported,
                    &self.analysis.file,
                    &mut self.visiting,
                    depth + 1,
                )?;
                let mut layers = Vec::new();
                for (index, layer) in foreign.chain.layers.iter().enumerate() {
                    let local = layer_name(&self.analysis.prefix, &def.name, index);
                    if let Some(imports) = self.imports.as_deref_mut() {
                        let exported = layer_name(&foreign.prefix, &foreign.exported, index);
                        imports.add(&foreign.specifier, exported.clone(), local.clone());
                        for function in 0..layer.fns.len() {
                            imports.add(
                                &foreign.specifier,
                                format!("{exported}${function}"),
                                format!("{local}${function}"),
                            );
                        }
                    }
                    layers.push(Layer {
                        binding: local,
                        ..layer.clone()
                    });
                }
                Chain {
                    tag: foreign.chain.tag,
                    layers,
                }
            }
        };
        self.visiting.pop();
        let mut chain = base;
        chain.layers.push(Layer {
            binding: layer_name(&self.analysis.prefix, &def.name, chain.layers.len()),
            has_base: !def.rule.statics.is_empty(),
            fns: def.rule.dyns.iter().map(|d| d.reads.clone()).collect(),
        });
        self.memo.insert(name.to_string(), chain.clone());
        Ok(chain)
    }
}

struct Foreign {
    chain: Chain,
    prefix: String,
    specifier: String,
    exported: String,
}

enum Resolved {
    Found {
        file: String,
        exported: String,
        local: String,
    },
    Missing,
    Unreadable {
        file: String,
        message: String,
    },
    Ambiguous,
}

fn resolve_export(file: &str, exported: &str, path: &mut Vec<(String, String)>) -> Resolved {
    let key = (file.to_string(), exported.to_string());
    if path.contains(&key) {
        return Resolved::Missing;
    }
    let unreadable = |message: String| Resolved::Unreadable {
        file: file.to_string(),
        message,
    };
    let text = match crate::fs::source::read_raw(file) {
        Ok(text) => text,
        Err(err) => return unreadable(err.to_string()),
    };
    let allocator = Allocator::default();
    let program = match parse_file_program(&allocator, &text, file) {
        Ok(program) => program,
        Err(message) => return unreadable(message),
    };
    path.push(key);
    let resolved = resolve_in(file, &program, exported, path);
    path.pop();
    resolved
}

fn pattern_names<'b>(pattern: &'b BindingPattern, names: &mut Vec<&'b str>) {
    match pattern {
        BindingPattern::BindingIdentifier(ident) => names.push(ident.name.as_str()),
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                pattern_names(&property.value, names);
            }
            if let Some(rest) = &object.rest {
                pattern_names(&rest.argument, names);
            }
        }
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                pattern_names(element, names);
            }
            if let Some(rest) = &array.rest {
                pattern_names(&rest.argument, names);
            }
        }
        BindingPattern::AssignmentPattern(assignment) => pattern_names(&assignment.left, names),
    }
}

fn declared_names<'b>(declaration: &'b Declaration) -> Vec<&'b str> {
    match declaration {
        Declaration::VariableDeclaration(declaration) => {
            let mut names = Vec::new();
            for declarator in &declaration.declarations {
                pattern_names(&declarator.id, &mut names);
            }
            names
        }
        Declaration::FunctionDeclaration(function) => {
            function.id.iter().map(|id| id.name.as_str()).collect()
        }
        Declaration::ClassDeclaration(class) => {
            class.id.iter().map(|id| id.name.as_str()).collect()
        }
        Declaration::TSEnumDeclaration(declaration) => vec![declaration.id.name.as_str()],
        Declaration::TSNamespaceDeclaration(declaration) => vec![declaration.id.name.as_str()],
        Declaration::TSImportEqualsDeclaration(declaration)
            if !declaration.import_kind.is_type() =>
        {
            vec![declaration.id.name.as_str()]
        }
        _ => Vec::new(),
    }
}

fn resolve_in(
    file: &str,
    program: &Program,
    exported: &str,
    path: &mut Vec<(String, String)>,
) -> Resolved {
    let found = |local: &str| Resolved::Found {
        file: file.to_string(),
        exported: exported.to_string(),
        local: local.to_string(),
    };
    let mut imports: FxHashMap<&str, (String, String)> = FxHashMap::default();
    let mut values: FxHashSet<&str> = FxHashSet::default();
    for statement in &program.body {
        match statement {
            Statement::ImportDeclaration(decl) if !decl.import_kind.is_type() => {
                let Some(from) = decl.source.value.as_str() else {
                    continue;
                };
                for spec in import_specs(decl) {
                    if spec.type_only {
                        continue;
                    }
                    values.insert(spec.local);
                    if spec.kind != SpecKind::Namespace {
                        imports.insert(spec.local, (from.to_string(), spec.imported.clone()));
                    }
                }
            }
            Statement::ExportDeclaration(export) => {
                values.extend(declared_names(&export.declaration));
            }
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    values.extend(function.id.iter().map(|id| id.name.as_str()));
                }
                ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                    values.extend(class.id.iter().map(|id| id.name.as_str()));
                }
                _ => {}
            },
            _ => {
                if let Some(declaration) = statement.as_declaration() {
                    values.extend(declared_names(declaration));
                }
            }
        }
    }
    let follow =
        |from: &str, name: &str, path: &mut Vec<(String, String)>| match resolve_import(from, file)
        {
            Some(next) => resolve_export(&next, name, path),
            None => Resolved::Missing,
        };
    let mut stars = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::ExportDeclaration(export) => {
                if declared_names(&export.declaration).contains(&exported) {
                    return found(exported);
                }
            }
            Statement::ExportDefaultDeclaration(export) if exported == "default" => {
                if let Some(Expression::Identifier(ident)) =
                    export.declaration.as_expression().map(unparen)
                    && let Some((from, imported)) = imports.get(ident.name.as_str())
                {
                    return follow(from, imported, path);
                }
                return found("default");
            }
            Statement::ExportNamedDeclaration(export) if !export.export_kind.is_type() => {
                for spec in &export.specifiers {
                    if spec.export_kind.is_type() || module_export_name(&spec.exported) != exported
                    {
                        continue;
                    }
                    let local = module_export_name(&spec.local);
                    if !values.contains(local) {
                        continue;
                    }
                    return match imports.get(local) {
                        Some((from, imported)) => follow(from, imported, path),
                        None => found(local),
                    };
                }
            }
            Statement::ExportFromDeclaration(export) if !export.export_kind.is_type() => {
                let Some(from) = export.source.value.as_str() else {
                    continue;
                };
                for spec in &export.specifiers {
                    if !spec.export_kind.is_type() && module_export_name(&spec.exported) == exported
                    {
                        return follow(from, module_export_name(&spec.local), path);
                    }
                }
            }
            Statement::ExportAllDeclaration(export) if !export.export_kind.is_type() => {
                let Some(from) = export.source.value.as_str() else {
                    continue;
                };
                match &export.exported {
                    Some(name) if module_export_name(name) == exported => {
                        return found(&format!("* as {from}"));
                    }
                    Some(_) => {}
                    None => stars.push(from),
                }
            }
            _ => {}
        }
    }
    if exported == "default" {
        return Resolved::Missing;
    }
    let mut bindings: Vec<(String, String, String)> = Vec::new();
    for from in stars {
        match follow(from, exported, path) {
            Resolved::Found {
                file,
                exported,
                local,
            } => {
                if !bindings
                    .iter()
                    .any(|(other, _, other_local)| *other == file && *other_local == local)
                {
                    bindings.push((file, exported, local));
                }
            }
            Resolved::Missing => {}
            other => return other,
        }
    }
    match bindings.len() {
        0 => Resolved::Missing,
        1 => {
            let (file, exported, local) = bindings.pop().unwrap();
            Resolved::Found {
                file,
                exported,
                local,
            }
        }
        _ => Resolved::Ambiguous,
    }
}

fn module_specifier(importer: &str, file: &str) -> String {
    let path = relative(&dirname(importer), file).replace('\\', "/");
    if path.starts_with("../") {
        path
    } else {
        format!("./{path}")
    }
}

fn foreign_chain(
    source: &str,
    exported: &str,
    importer: &str,
    visiting: &mut Vec<(String, String)>,
    depth: usize,
) -> R<Foreign> {
    let not_styled = || {
        error(format!(
            "\"{exported}\" from \"{source}\" is not a styled component. styled() accepts only components defined with styled."
        ))
    };
    let unreadable = |file: &str, message: &str| {
        error(format!(
            "Cannot read \"{file}\" while resolving \"{exported}\" from \"{source}\": {message}"
        ))
    };
    let file = resolve_import(source, importer).ok_or_else(not_styled)?;
    let (defining, exported_there) = match resolve_export(&file, exported, &mut Vec::new()) {
        Resolved::Found { file, exported, .. } => (file, exported),
        Resolved::Missing => return Err(not_styled()),
        Resolved::Unreadable { file, message } => {
            return Err(unreadable(&file, &message));
        }
        Resolved::Ambiguous => {
            return Err(error(format!(
                "\"{exported}\" from \"{source}\" is exported by more than one export * with different bindings, so it cannot be resolved. Re-export it by name."
            )));
        }
    };
    let text = crate::fs::source::read_raw(&defining)
        .map_err(|err| unreadable(&defining, &err.to_string()))?;
    let allocator = Allocator::default();
    let program = parse_file_program(&allocator, &text, &defining)
        .map_err(|message| unreadable(&defining, &message))?;
    let analysis = Analysis::of(&program, &text, &defining)?.ok_or_else(not_styled)?;
    let local = analysis
        .local_for_export(&exported_there)
        .ok_or_else(not_styled)?
        .to_string();
    let mut chains = Chains {
        analysis: &analysis,
        memo: FxHashMap::default(),
        visiting: std::mem::take(visiting),
        imports: None,
    };
    let result = chains.chain(&local, depth);
    *visiting = chains.visiting;
    let specifier = if defining == file {
        source.to_string()
    } else {
        module_specifier(importer, &defining)
    };
    Ok(Foreign {
        chain: result?,
        prefix: analysis.prefix,
        specifier,
        exported: exported_there,
    })
}

fn dyn_object(dynamic: &Dyn, prefix: &str) -> String {
    let value = format!("{prefix}_value");
    let mut inner = format!("{{ {}: {value} }}", dynamic.leaf);
    for key in dynamic.path.iter().rev() {
        inner = format!("{{ {key}: {inner} }}");
    }
    format!("({value}) => ({inner})")
}

fn create_text(def: &Def, binding: &str, prefix: &str) -> String {
    let mut entries = Vec::new();
    if !def.rule.statics.is_empty() {
        entries.push(format!("base: {{ {} }}", def.rule.statics.join(", ")));
    }
    for (index, dynamic) in def.rule.dyns.iter().enumerate() {
        entries.push(format!("d{index}: {}", dyn_object(dynamic, prefix)));
    }
    let mut out = format!(
        "const {binding} = {prefix}_css.create({{ {} }});\n",
        entries.join(", ")
    );
    for (index, dynamic) in def.rule.dyns.iter().enumerate() {
        out.push_str(&format!(
            "const {binding}${index} = {};\n",
            dynamic.function
        ));
    }
    out
}

fn component_text(chain: &Chain, style_prop: &str, prefix: &str) -> R<String> {
    let style = format!("{prefix}_sx");
    let rest = format!("{prefix}_props");
    let mut reads: Vec<String> = Vec::new();
    let local = |reads: &[String], name: &String| {
        let index = reads.iter().position(|read| read == name).unwrap();
        format!("{prefix}_prop{index}")
    };
    let mut styles = Vec::new();
    for layer in &chain.layers {
        if layer.has_base {
            styles.push(format!("{}.base", layer.binding));
        }
        for (index, names) in layer.fns.iter().enumerate() {
            for name in names {
                if name == style_prop {
                    return Err(error(format!(
                        "A styled rule cannot read the \"{name}\" prop."
                    )));
                }
                if !reads.contains(name) {
                    reads.push(name.clone());
                }
            }
            let argument = names
                .iter()
                .map(|name| format!("{name}: {}", local(&reads, name)))
                .collect::<Vec<_>>()
                .join(", ");
            styles.push(format!(
                "{binding}.d{index}({binding}${index}({{ {argument} }}))",
                binding = layer.binding,
            ));
        }
    }
    styles.push(style.clone());
    let mut params = vec![format!("{}: {style}", property_key(style_prop))];
    params.extend(
        reads
            .iter()
            .map(|name| format!("{name}: {}", local(&reads, name))),
    );
    params.push(format!("...{rest}"));
    Ok(format!(
        "({{ {} }}) => <{tag} {style_prop}={{[{}]}} {{...{rest}}} />",
        params.join(", "),
        styles.join(", "),
        tag = chain.tag,
    ))
}

pub fn styled_names(file: &str) -> Vec<String> {
    let Ok(source) = crate::fs::source::read_raw(file) else {
        return Vec::new();
    };
    if !source.contains(REACT) {
        return Vec::new();
    }
    let allocator = Allocator::default();
    let Ok(program) = parse_file_program(&allocator, &source, file) else {
        return Vec::new();
    };
    match Analysis::of(&program, &source, file) {
        Ok(Some(analysis)) => analysis.defs.into_iter().map(|def| def.name).collect(),
        _ => Vec::new(),
    }
}

pub fn desugar(source: &str, file: &str, style_prop: &str) -> R<Option<String>> {
    if !source.contains(REACT) {
        return Ok(None);
    }
    let allocator = Allocator::default();
    let program = parse_file_program(&allocator, source, file)?;
    let Some(analysis) = Analysis::of(&program, source, file)? else {
        return Ok(None);
    };
    if !analysis.defs.is_empty()
        && [".ts", ".mts", ".cts"]
            .iter()
            .any(|ext| file.ends_with(ext))
    {
        return Err(error(format!(
            "styled renders JSX, so it must be used in a .tsx or .jsx file. Rename {file}."
        )));
    }

    let mut imports = Imports::default();
    let mut chains_of = Vec::new();
    {
        let mut chains = Chains {
            analysis: &analysis,
            memo: FxHashMap::default(),
            visiting: Vec::new(),
            imports: Some(&mut imports),
        };
        for def in &analysis.defs {
            chains_of.push(chains.chain(&def.name, 1)?);
        }
    }

    let mut edits: Vec<(u32, u32, String)> = Vec::new();
    let prefix = &analysis.prefix;
    let mut header = format!("import * as {prefix}_css from '@plumeria/core';");
    for (from, specs) in &imports.by_source {
        let specs = specs
            .iter()
            .map(|(imported, local)| format!("{imported} as {local}"))
            .collect::<Vec<_>>()
            .join(", ");
        header.push_str(&format!("\nimport {{ {specs} }} from '{from}';"));
    }
    for (index, span) in analysis.react_imports.iter().enumerate() {
        let replacement = if index == 0 {
            header.clone()
        } else {
            String::new()
        };
        edits.push((span.start, span.end, replacement));
    }
    for (def, chain) in analysis.defs.iter().zip(&chains_of) {
        let own = chain.layers.last().unwrap();
        edits.push((
            def.statement_start,
            def.statement_start,
            create_text(def, &own.binding, prefix),
        ));
        edits.push((
            def.init.start,
            def.init.end,
            component_text(chain, style_prop, prefix)?,
        ));
    }

    let mut exports = Vec::new();
    for (local, exported) in &analysis.exports {
        let index = analysis
            .defs
            .iter()
            .position(|def| &def.name == local)
            .unwrap();
        for (layer_index, layer) in chains_of[index].layers.iter().enumerate() {
            let name = layer_name(prefix, exported, layer_index);
            exports.push(format!("{} as {name}", layer.binding));
            for function in 0..layer.fns.len() {
                exports.push(format!("{}${function} as {name}${function}", layer.binding));
            }
        }
    }

    edits.sort_by_key(|(start, end, _)| (*start, *end));
    let mut out = String::with_capacity(source.len() + 256);
    let mut cursor = 0usize;
    for (start, end, replacement) in edits {
        out.push_str(&source[cursor..start as usize]);
        out.push_str(&replacement);
        cursor = end as usize;
    }
    out.push_str(&source[cursor..]);
    if !exports.is_empty() {
        out.push_str(&format!("\nexport {{ {} }};\n", exports.join(", ")));
    }
    Ok(Some(out))
}

#[cfg(test)]
#[path = "styled_tests.rs"]
mod tests;
