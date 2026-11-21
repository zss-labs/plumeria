use std::collections::BTreeMap;

use indexmap::IndexMap;
use oxc_ast::ast::*;
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxBuildHasher, FxHashMap, FxHashSet};

use super::context::StaticStack;
use super::{Replacement, StyleKind, TResult, Transformer, is_static_arg_value};
use crate::engine::hash::hash_str;
use crate::engine::{apply_css_value, camel_to_kebab_case};
use crate::eval::functions::{
    DerivedPiece, StyleFunction, is_defined_argument, resolve_dynamic_style,
};
use crate::eval::{Env, argument_expr};
use crate::js::json::quote;
use crate::js::number::{number_to_string, parse_js_number};
use crate::js::{Object, Value, deep_merge};
use crate::project::TableEntry;
use crate::style::escalation::{StyleSource, get_state_weights};
use crate::style::records::{Weights, class_string};
use crate::syntax::expr::{E, K, Prop, root_identifier, unwrap};

#[derive(Clone, Debug)]
pub struct DynamicVar {
    pub css_var: String,
    pub value_expr: String,
    pub test: Option<String>,
    pub order: Option<i64>,
}

pub fn fold_dynamic_vars(vars: &[DynamicVar]) -> Vec<String> {
    let mut sorted: Vec<&DynamicVar> = vars.iter().collect();
    sorted.sort_by_key(|entry| entry.order.unwrap_or(0));
    let mut grouped: IndexMap<&str, Vec<&DynamicVar>, FxBuildHasher> = IndexMap::default();
    for entry in sorted {
        grouped
            .entry(entry.css_var.as_str())
            .or_default()
            .push(entry);
    }
    grouped
        .into_iter()
        .map(|(css_var, entries)| {
            let mut value = "undefined".to_string();
            for entry in entries {
                value = match &entry.test {
                    Some(test) => format!("(({test}) ? {} : {value})", entry.value_expr),
                    None => entry.value_expr.clone(),
                };
            }
            format!("\"{css_var}\": {value}")
        })
        .collect()
}

pub fn spread_style_message(source: &str) -> String {
    format!(
        "[plumeria] Spread elements in a style array are not supported: \"...{source}\". List each style explicitly."
    )
}

fn prop_default_message(source: &str) -> String {
    format!(
        "[plumeria] A style prop default must be a defined style: \"{source}\". Apply a conditional or dynamic style where the element is styled."
    )
}

fn is_plain_read(source: &str) -> bool {
    let chars: Vec<char> = source.chars().collect();
    let mut code: Vec<char> = Vec::with_capacity(chars.len());
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        if (c == '\'' || c == '"')
            && let Some(end) = chars[index + 1..]
                .iter()
                .position(|&next| next == c || next == '\\' || next == '\n')
            && chars[index + 1 + end] == c
        {
            code.extend(['"', '"']);
            index += end + 2;
            continue;
        }
        code.push(c);
        index += 1;
    }

    let word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    if !code
        .iter()
        .all(|&c| word(c) || c.is_whitespace() || "$.()!=<>&|?:\"-".contains(c))
    {
        return false;
    }
    let mut previous: Option<char> = None;
    for (index, &c) in code.iter().enumerate() {
        if c == '(' && previous.is_some_and(|p| word(p) || p == '$' || p == ')') {
            return false;
        }
        if c == '.'
            && !(index > 0
                && code[index - 1].is_ascii_digit()
                && code.get(index + 1).is_some_and(char::is_ascii_digit))
        {
            return false;
        }
        if c == '-' && code.get(index + 1) == Some(&'-') {
            return false;
        }
        if !c.is_whitespace() {
            previous = Some(c);
        }
    }
    let text: String = code.iter().collect();
    if text.split(|c: char| !word(c)).any(|token| {
        matches!(
            token,
            "new" | "await" | "yield" | "delete" | "void" | "import"
        )
    }) {
        return false;
    }
    let mut index = 0;
    while index < code.len() {
        let c = code[index];
        if (c == '=' || c == '!') && code.get(index + 1) == Some(&'=') {
            index += if code.get(index + 2) == Some(&'=') {
                3
            } else {
                2
            };
            continue;
        }
        if (c == '<' || c == '>') && code.get(index + 1) == Some(&'=') {
            index += 2;
            continue;
        }
        if c == '=' {
            return false;
        }
        index += 1;
    }
    true
}

const PARAM: &str = "__plumeria";

fn param_at(text: &str, start: usize) -> Option<(usize, usize)> {
    let digits = text[start + PARAM.len()..]
        .bytes()
        .take_while(u8::is_ascii_digit)
        .count();
    if digits == 0 {
        return None;
    }
    let end = start + PARAM.len() + digits;
    text[start + PARAM.len()..end]
        .parse()
        .ok()
        .map(|index| (index, end))
}

fn param_uses(text: &str) -> Vec<usize> {
    text.match_indices(PARAM)
        .filter_map(|(start, _)| param_at(text, start).map(|(index, _)| index))
        .collect()
}

fn inline_params(text: &str, bound: &[String]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for (start, _) in text.match_indices(PARAM) {
        if start < last {
            continue;
        }
        if let Some((index, end)) = param_at(text, start)
            && let Some(source) = bound.get(index)
        {
            out.push_str(&text[last..start]);
            out.push_str(source);
            last = end;
        }
    }
    out.push_str(&text[last..]);
    out
}

fn lookup_table(entries: &[(String, String)]) -> String {
    let body: Vec<String> = entries
        .iter()
        .map(|(key, value)| {
            let key = if key == "__proto__" {
                "[\"__proto__\"]".to_string()
            } else {
                quote(key)
            };
            format!("{key}:{value}")
        })
        .collect();
    format!("{{__proto__:null,{}}}", body.join(","))
}

fn leaf_paths(style: &Object, prefix: &mut Vec<String>, out: &mut Vec<Vec<String>>) {
    for (key, value) in style.iter() {
        prefix.push(key.to_string());
        match value {
            Value::Obj(inner) => leaf_paths(inner, prefix, out),
            _ => out.push(prefix.clone()),
        }
        prefix.pop();
    }
}

fn pick_path(target: &mut Object, source: &Object, path: &[String]) {
    let Some((key, rest)) = path.split_first() else {
        return;
    };
    let Some(value) = source.get(key) else {
        return;
    };
    if rest.is_empty() {
        target.insert(key.clone(), value.clone());
        return;
    }
    let Value::Obj(inner_source) = value else {
        return;
    };
    let mut inner = target
        .get(key)
        .and_then(Value::as_obj)
        .cloned()
        .unwrap_or_default();
    pick_path(&mut inner, inner_source, rest);
    target.insert(key.clone(), Value::obj(inner));
}

#[derive(Clone)]
struct Conditional {
    test: Span,
    test_string: Option<String>,
    test_lhs: Option<String>,
    truthy: Object,
    falsy: Object,
    group_id: Option<u32>,
    value_name: Option<String>,
    order: i64,
}

pub struct Built {
    pub class_parts: Vec<String>,
    pub is_optimizable: bool,
    pub base_style: Object,
    pub dynamic_vars: Vec<DynamicVar>,
    pub prop_var_spreads: Vec<String>,
}

struct Decision {
    key_expr: String,
    options: Vec<(String, Object)>,
    leaves: usize,
    has_group: bool,
}

#[derive(Clone)]
struct Dimension {
    kind: DimKind,
    options: Vec<(String, Object)>,
    test_expr: String,
}

#[derive(Clone, Copy, PartialEq)]
enum DimKind {
    Std,
    Var,
    Const,
}

struct PropPossibility {
    key: String,
    style: Object,
    has_vars: bool,
}

pub(super) struct Builder {
    conditionals: Vec<Conditional>,
    dynamic_vars: Vec<DynamicVar>,
    prop_var_spreads: Vec<String>,
    group_id_counter: u32,
    source_order: i64,
    base_chunks: Vec<(i64, Object)>,
    base_style: Object,
    is_style_prop: bool,
}

impl<'t, 'p, 'b, 'a> Transformer<'t, 'p, 'b, 'a> {
    pub fn resolve_style_object(&self, expr: E<'b, 'a>) -> TResult<Option<Object>> {
        let expr = self.resolve_local_style_alias(unwrap(expr));
        if !self.visibility().expr(expr) {
            return Ok(None);
        }
        match expr.kind() {
            K::Array(array) => {
                let mut merged = Object::new();
                for element in &array.elements {
                    match element {
                        ArrayExpressionElement::Elision(_) => continue,
                        ArrayExpressionElement::SpreadElement(spread) => {
                            return Err(self.fail(
                                spread_style_message(&self.source_of(E::new(&spread.argument))),
                                Some(spread.argument.span()),
                            ));
                        }
                        other => {
                            let Some(style) =
                                self.resolve_style_object(E::new(other.to_expression()))?
                            else {
                                return Ok(None);
                            };
                            merged = deep_merge(&merged, &style);
                        }
                    }
                }
                Ok(Some(merged))
            }
            K::Object(object) => Err(self.fail(
                "[plumeria] Inline style objects are not accepted.".to_string(),
                Some(object.span),
            )),
            K::Member(_) => {
                let Some(var_name) = expr.object().and_then(|object| object.ident_name()) else {
                    return Ok(None);
                };
                let prop_name = match expr.prop() {
                    Some(Prop::Name(name)) => name.to_string(),
                    Some(Prop::Computed(key)) => match key.kind() {
                        K::Str(value) => match value.value.as_str() {
                            Some(value) => value.to_string(),
                            None => return Ok(None),
                        },
                        _ => return Ok(None),
                    },
                    _ => return Ok(None),
                };
                if let Some(info) = self.local_create_styles.get(var_name)
                    && let Some(Value::Obj(style)) = info.obj.get(&prop_name)
                {
                    return Ok(Some((**style).clone()));
                }
                if let Some(hash) = self.merged_create_hash(var_name)
                    && let Some(Value::Obj(object)) = self.create_object(&hash)
                    && let Some(Value::Obj(style)) = object.get(&prop_name)
                {
                    return Ok(Some((**style).clone()));
                }
                Ok(None)
            }
            K::Ident(ident) => {
                let var_name = ident.name.as_str();
                let unique_key = format!("{}-{var_name}", self.resource);
                let hash = self
                    .tables
                    .create_hash
                    .get(&unique_key)
                    .filter(|h| !h.is_empty())
                    .cloned()
                    .or_else(|| self.merged_create_hash(var_name));
                if let Some(hash) = hash
                    && let Some(Value::Obj(object)) = self.create_object(&hash)
                {
                    return Ok(Some((*object).clone()));
                }
                if let Some(info) = self.local_create_styles.get(var_name) {
                    return Ok(Some(info.obj.clone()));
                }
                Ok(None)
            }
            _ => Ok(None),
        }
    }

    pub fn merged_create_hash(&self, name: &str) -> Option<String> {
        self.merged_create
            .get(name)
            .or_else(|| self.tables.create_hash.get(name))
            .filter(|h| !h.is_empty())
            .cloned()
    }

    pub fn is_style_function_call(&self, expr: E<'b, 'a>) -> bool {
        let Some(call) = expr.call() else {
            return false;
        };
        let callee = E::new(&call.callee);
        if !callee.is_member() {
            return false;
        }
        let (Some(object), Some(Prop::Name(property))) = (
            callee.object().and_then(|object| object.ident_name()),
            callee.prop(),
        ) else {
            return false;
        };
        self.style_functions_for(object, property)
    }

    fn function_for(&self, object: &str, property: &str) -> Option<&StyleFunction<'b, 'a>> {
        self.local_create_styles
            .get(object)
            .and_then(|style| style.functions.as_ref())
            .and_then(|functions| functions.get(property))
            .or_else(|| {
                self.create_function_imports
                    .get(object)
                    .and_then(|functions| functions.get(property))
            })
    }

    pub fn carries_style_reference(&self, expression: E<'b, 'a>) -> TResult<bool> {
        let node = unwrap(expression);
        if let K::Array(array) = node.kind() {
            for element in &array.elements {
                let inner = match element {
                    ArrayExpressionElement::Elision(_) => continue,
                    ArrayExpressionElement::SpreadElement(spread) => E::new(&spread.argument),
                    other => E::new(other.to_expression()),
                };
                if self.carries_style_reference(inner)? {
                    return Ok(true);
                }
            }
            return Ok(false);
        }
        if self.is_style_function_call(node) {
            return Ok(true);
        }
        if let K::Object(_) = node.kind() {
            return Ok(false);
        }
        Ok(self.resolve_style_object(node)?.is_some())
    }

    pub fn assert_no_style_array_spread(&self, expression: E<'b, 'a>) -> TResult<()> {
        let node = unwrap(expression);
        let K::Array(array) = node.kind() else {
            return Ok(());
        };
        let spread = array.elements.iter().find_map(|element| match element {
            ArrayExpressionElement::SpreadElement(spread) => Some(spread),
            _ => None,
        });
        let Some(spread) = spread else { return Ok(()) };
        if self.carries_style_reference(node)? {
            return Err(self.fail(
                spread_style_message(&self.source_of(E::new(&spread.argument))),
                Some(spread.argument.span()),
            ));
        }
        Ok(())
    }

    fn resolve_object_arg(&self, object: &ObjectExpression) -> TResult<Object> {
        let filtered = object.properties.iter().filter(|prop| match prop {
            ObjectPropertyKind::ObjectProperty(p) if p.shorthand => true,
            ObjectPropertyKind::ObjectProperty(p) => {
                !p.computed
                    && !p.method
                    && p.kind == PropertyKind::Init
                    && is_static_arg_value(E::new(&p.value))
            }
            _ => false,
        });
        self.with_evaluator(None, |evaluator| evaluator.properties(filtered))
    }

    pub fn resolve_dynamic_call(
        &self,
        expr: E<'b, 'a>,
        force_runtime: bool,
    ) -> TResult<Option<(Object, Vec<DynamicVar>)>> {
        let Some(call) = expr.call() else {
            return Ok(None);
        };
        let callee = E::new(&call.callee);
        if !callee.is_member() {
            return Ok(None);
        }
        let Some(object_expr) = callee.object() else {
            return Ok(None);
        };
        let Some(object_name) = object_expr.ident_name() else {
            return Ok(None);
        };
        let Some(Prop::Name(property)) = callee.prop() else {
            return Ok(None);
        };
        if !self.visibility().expr(object_expr) {
            return Ok(None);
        }
        let Some(func) = self.function_for(object_name, property) else {
            return Ok(None);
        };
        if call
            .arguments
            .iter()
            .any(|argument| matches!(argument, Argument::SpreadElement(_)))
        {
            return Ok(None);
        }

        let mut temp = self.merged_static.clone();
        let mut provided: FxHashSet<String> = FxHashSet::default();
        let mut runtime: Vec<(String, E<'b, 'a>)> = Vec::new();

        if let Some(named) = &func.named {
            let first = call.arguments.first().map(argument_expr);
            if call.arguments.len() > 1 || first.is_some_and(|arg| arg.object_expr().is_none()) {
                return Err(self.fail(
                    format!(
                        "[plumeria] {} takes one object argument, because {property} destructures its parameter.",
                        self.source_of(expr)
                    ),
                    Some(expr.span()),
                ));
            }
            let mut given: FxHashMap<String, E<'b, 'a>> = FxHashMap::default();
            if let Some(object) = first.and_then(|arg| arg.object_expr()) {
                for prop in &object.properties {
                    let ObjectPropertyKind::ObjectProperty(p) = prop else {
                        continue;
                    };
                    if p.shorthand {
                        if let Expression::Identifier(ident) = &p.value {
                            given.insert(ident.name.to_string(), E::new(&p.value));
                        }
                        continue;
                    }
                    if p.method || p.kind != PropertyKind::Init || p.computed {
                        continue;
                    }
                    let key = match &p.key {
                        PropertyKey::StaticIdentifier(ident) => ident.name.to_string(),
                        PropertyKey::StringLiteral(value) => match value.value.as_str() {
                            Some(value) => value.to_string(),
                            None => continue,
                        },
                        _ => continue,
                    };
                    given.insert(key, E::new(&p.value));
                }
            }
            let arg_obj = match first.and_then(|arg| arg.object_expr()) {
                Some(object) => self.resolve_object_arg(object)?,
                None => Object::new(),
            };
            for param in named {
                let Some(source) = given.get(&param.key).copied() else {
                    if func.defaults.contains_key(&param.local) {
                        continue;
                    }
                    return Err(self.fail(
                        format!(
                            "[plumeria] {} leaves \"{}\" unset, and a dynamic style function has no value to fall back on.",
                            self.source_of(expr),
                            param.key
                        ),
                        Some(expr.span()),
                    ));
                };
                if !force_runtime
                    && is_static_arg_value(source)
                    && let Some(value) = arg_obj.get(&param.key)
                {
                    temp.insert(param.local.clone(), value.clone());
                    provided.insert(param.local.clone());
                    continue;
                }
                runtime.push((param.local.clone(), source));
            }
        } else if call.arguments.len() == 1
            && argument_expr(&call.arguments[0]).object_expr().is_some()
        {
            if force_runtime {
                return Ok(None);
            }
            let object = argument_expr(&call.arguments[0]).object_expr().unwrap();
            let arg_obj = self.resolve_object_arg(object)?;
            for param in &func.params {
                if let Some(value) = arg_obj.get(param) {
                    temp.insert(param.clone(), value.clone());
                    provided.insert(param.clone());
                }
            }
        } else {
            for (index, argument) in call.arguments.iter().enumerate() {
                if let Some(param) = func.params.get(index) {
                    runtime.push((param.clone(), argument_expr(argument)));
                }
            }
        }

        let runtime_params: Vec<String> = runtime.iter().map(|(param, _)| param.clone()).collect();
        let definite: Vec<String> = runtime
            .iter()
            .filter(|(_, source)| is_defined_argument(*source))
            .map(|(param, _)| param.clone())
            .collect();
        let empty = crate::transform::overlay::Map::<Value>::default();
        let statics = StaticStack {
            own: &temp,
            base: &empty,
        };
        let resolved = self.with_evaluator(None, |evaluator| {
            let tables = Env {
                statics: &crate::eval::NOTHING,
                ..evaluator.env
            };
            resolve_dynamic_style(
                func,
                &runtime_params,
                &statics,
                tables,
                Some(&provided),
                &definite,
            )
        })?;

        let mut sources: Vec<(String, String)> = runtime
            .iter()
            .map(|(param, source)| (param.clone(), self.source_of(*source)))
            .collect();
        for entry in &resolved.derived {
            let mut rendered = String::new();
            for piece in &entry.pieces {
                match piece {
                    DerivedPiece::Text(text) => rendered.push_str(text),
                    DerivedPiece::Param(param, fallback) => {
                        let argument = sources
                            .iter()
                            .find(|(name, _)| name == param)
                            .map(|(_, source)| source.as_str())
                            .unwrap_or("undefined");
                        match fallback {
                            Some(fallback) => rendered.push_str(&format!(
                                "(({argument}) === undefined ? {fallback} : ({argument}))"
                            )),
                            None => rendered.push_str(&format!("({argument})")),
                        }
                    }
                }
            }
            sources.push((entry.name.clone(), rendered));
        }

        let mut vars = Vec::new();
        for (param, arg_source) in &sources {
            let Some(groups) = resolved.var_groups.get(param) else {
                continue;
            };
            if groups.is_empty() {
                continue;
            }
            let maybe_number = parse_js_number(arg_source);
            for group in groups {
                let kebab_prop = camel_to_kebab_case(&group.prop);
                let is_number_literal = maybe_number
                    .is_some_and(|n| !n.is_nan() && arg_source.trim() == number_to_string(n));
                let is_string_literal = arg_source.len() >= 2
                    && ((arg_source.starts_with('"') && arg_source.ends_with('"'))
                        || (arg_source.starts_with('\'') && arg_source.ends_with('\'')));
                let unit = &group.unit;
                let value_expr = if group.written {
                    if is_number_literal {
                        quote(&format!(
                            "{}{unit}",
                            number_to_string(maybe_number.unwrap())
                        ))
                    } else if is_string_literal {
                        quote(&format!("{}{unit}", &arg_source[1..arg_source.len() - 1]))
                    } else {
                        format!("(({arg_source}) + '{unit}')")
                    }
                } else if is_number_literal {
                    quote(&apply_css_value(
                        &Value::Num(maybe_number.unwrap()),
                        &kebab_prop,
                    ))
                } else if is_string_literal {
                    quote(&apply_css_value(
                        &Value::str(&arg_source[1..arg_source.len() - 1]),
                        &kebab_prop,
                    ))
                } else if !unit.is_empty() {
                    format!(
                        "(typeof ({arg_source}) === 'number' ? ({arg_source}) + '{unit}' : ({arg_source}))"
                    )
                } else {
                    arg_source.clone()
                };
                vars.push(DynamicVar {
                    css_var: group.css_var.clone(),
                    value_expr,
                    test: None,
                    order: None,
                });
            }
        }
        Ok(Some((resolved.style, vars)))
    }

    fn assert_resolvable(&mut self, node: E<'b, 'a>) -> TResult<()> {
        if node.is_undefined_ident() {
            return Ok(());
        }
        if !matches!(
            node.kind(),
            K::Member(_) | K::Ident(_) | K::Call(_) | K::Arrow | K::Function
        ) {
            return Ok(());
        }
        let root = root_identifier(node);
        let is_style = root.is_some_and(|root| {
            self.visibility().expr(node)
                && ((self
                    .local_create_styles
                    .get(root)
                    .is_some_and(|style| style.kind != StyleKind::Constant))
                    || self.merged_create_hash(root).is_some()
                    || self.merged_create.contains_key(root))
        });
        if is_style {
            return Ok(());
        }
        let member = root.and_then(|root| namespace_member(node, root));
        let local_imports = self.local_imports.clone();
        if let Some((file, message)) =
            self.project
                .resolve_origin_error(member.as_deref(), root, &local_imports)
        {
            return Err(self.fail(
                format!(
                    "[plumeria] {message} ({})",
                    crate::fs::path::basename(&file)
                ),
                None,
            ));
        }
        Err(self.fail(
            format!(
                "[plumeria] Dynamic or unresolvable style object \"{}\" is not supported.",
                self.source_of(node)
            ),
            Some(node.span()),
        ))
    }

    fn process_class(&mut self, style: &Object, weights: &Weights) -> String {
        class_string(&self.process_style_records(style, Some(weights)))
    }

    pub fn build_class_parts(
        &mut self,
        args: Vec<(E<'b, 'a>, Option<i64>)>,
        dynamic_class_parts: Vec<String>,
        existing_class: String,
        is_style_prop: bool,
    ) -> TResult<Built> {
        let args: Vec<(E<'b, 'a>, Option<i64>)> = args
            .into_iter()
            .map(|(expr, order)| (self.resolve_local_style_alias(expr), order))
            .collect();
        let mut builder = Builder {
            conditionals: Vec::new(),
            dynamic_vars: Vec::new(),
            prop_var_spreads: Vec::new(),
            group_id_counter: 0,
            source_order: 0,
            base_chunks: Vec::new(),
            base_style: Object::new(),
            is_style_prop,
        };
        let mut is_optimizable = true;

        for (expr, order) in &args {
            let expr = *expr;
            if expr.is_no_op_style() {
                continue;
            }
            if self.push_prop_possibilities(&mut builder, expr, &[])? {
                continue;
            }
            if let (K::Member(_), Some(Prop::Computed(dyn_expr))) = (expr.kind(), expr.prop())
                && !matches!(dyn_expr.kind(), K::Str(_))
                && let Some(var_name) = expr.object().and_then(|object| object.ident_name())
            {
                let style_obj = if self.visibility().expr(expr) {
                    self.resolve_create_object(var_name)
                } else {
                    None
                };
                if let Some(style_obj) = style_obj {
                    let dyn_source = self.source_of(dyn_expr);
                    builder.group_id_counter += 1;
                    let group_id = builder.group_id_counter;
                    let current_order = builder.source_order;
                    builder.source_order += 1;
                    for (option_name, style) in style_obj.iter() {
                        builder.conditionals.push(Conditional {
                            test: dyn_expr.span(),
                            test_string: Some(format!("{dyn_source} === '{option_name}'")),
                            test_lhs: Some(dyn_source.clone()),
                            truthy: style.as_obj().cloned().unwrap_or_default(),
                            falsy: Object::new(),
                            group_id: Some(group_id),
                            value_name: Some(option_name.to_string()),
                            order: current_order,
                        });
                    }
                    continue;
                }
            }

            let decision = self.resolve_decision(expr)?;
            if let Some(decision) = decision
                && (decision.has_group || decision.leaves > 2)
            {
                builder.group_id_counter += 1;
                let group_id = builder.group_id_counter;
                let current_order = builder.source_order;
                builder.source_order += 1;
                for (value, style) in decision.options {
                    builder.conditionals.push(Conditional {
                        test: expr.span(),
                        test_string: Some(format!("{} === '{value}'", decision.key_expr)),
                        test_lhs: Some(decision.key_expr.clone()),
                        truthy: style,
                        falsy: Object::new(),
                        group_id: Some(group_id),
                        value_name: Some(value),
                        order: current_order,
                    });
                }
                continue;
            }

            if self.collect_conditions(&mut builder, expr, &[], *order)? {
                continue;
            }
            self.assert_resolvable(expr)?;
            is_optimizable = false;
            break;
        }

        let Builder {
            mut conditionals,
            dynamic_vars,
            prop_var_spreads,
            base_chunks,
            base_style,
            ..
        } = builder;

        if !is_optimizable || (args.is_empty() && base_style.is_empty()) {
            return Ok(Built {
                class_parts: dynamic_class_parts,
                is_optimizable,
                base_style,
                dynamic_vars,
                prop_var_spreads,
            });
        }

        let mut sources: Vec<StyleSource> = base_chunks
            .iter()
            .map(|(order, style)| StyleSource {
                order: *order,
                style,
            })
            .collect();
        for c in &conditionals {
            sources.push(StyleSource {
                order: c.order,
                style: &c.truthy,
            });
            sources.push(StyleSource {
                order: c.order,
                style: &c.falsy,
            });
        }
        let state_weights = get_state_weights(&sources);

        let test_sources: Vec<Option<String>> = conditionals
            .iter()
            .map(|c| {
                if c.group_id.is_none() {
                    Some(c.test_string.clone().unwrap_or_else(|| self.text(c.test)))
                } else {
                    c.test_lhs.clone()
                }
            })
            .collect();
        let mut bound: Vec<String> = Vec::new();
        let mut skippable: FxHashSet<String> = FxHashSet::default();
        if test_sources.iter().all(Option::is_some)
            && test_sources
                .iter()
                .any(|source| !is_plain_read(source.as_deref().unwrap_or_default()))
        {
            let mut bound_groups: FxHashMap<u32, String> = FxHashMap::default();
            for (c, source) in conditionals.iter_mut().zip(test_sources) {
                let name = c
                    .group_id
                    .and_then(|group| bound_groups.get(&group).cloned());
                let param = name
                    .clone()
                    .unwrap_or_else(|| format!("__plumeria{}", bound.len()));
                if name.is_none() {
                    bound.push(source.unwrap_or_default());
                }
                match c.group_id {
                    None => c.test_string = Some(param),
                    Some(group) => {
                        c.test_lhs = Some(param.clone());
                        bound_groups.insert(group, param);
                    }
                }
            }
        }

        let mut participation: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();
        let mut register = |style: &Object, source_id: String| {
            for key in style.keys() {
                participation
                    .entry(key.to_string())
                    .or_default()
                    .insert(source_id.clone());
            }
        };
        register(&base_style, "base".to_string());
        for (index, c) in conditionals
            .iter()
            .filter(|c| c.group_id.is_none())
            .enumerate()
        {
            register(&c.truthy, format!("std_{index}"));
            register(&c.falsy, format!("std_{index}"));
        }
        let mut variant_groups: BTreeMap<u32, Vec<&Conditional>> = BTreeMap::new();
        for c in &conditionals {
            if let Some(group_id) = c.group_id {
                variant_groups.entry(group_id).or_default().push(c);
            }
        }
        for (group_id, options) in &variant_groups {
            for option in options {
                register(&option.truthy, format!("var_{group_id}"));
            }
        }
        let conflicting: FxHashSet<String> = participation
            .into_iter()
            .filter(|(_, sources)| sources.len() > 1)
            .map(|(key, _)| key)
            .collect();

        let mut base_independent = Object::new();
        let mut base_conflict = Object::new();
        for (key, value) in base_style.iter() {
            if conflicting.contains(key) {
                base_conflict.insert(key, value.clone());
            } else {
                base_independent.insert(key, value.clone());
            }
        }

        let mut independent: Vec<Conditional> = Vec::new();
        let mut conflict: Vec<Conditional> = Vec::new();
        for c in &conditionals {
            let (mut truthy_indep, mut truthy_conf, mut falsy_indep, mut falsy_conf) =
                (Object::new(), Object::new(), Object::new(), Object::new());
            let (mut has_indep, mut has_conf) = (false, false);
            for (key, value) in c.truthy.iter() {
                if conflicting.contains(key) {
                    truthy_conf.insert(key, value.clone());
                    has_conf = true;
                } else {
                    truthy_indep.insert(key, value.clone());
                    has_indep = true;
                }
            }
            for (key, value) in c.falsy.iter() {
                if conflicting.contains(key) {
                    falsy_conf.insert(key, value.clone());
                    has_conf = true;
                } else {
                    falsy_indep.insert(key, value.clone());
                    has_indep = true;
                }
            }
            if has_indep {
                independent.push(Conditional {
                    truthy: truthy_indep,
                    falsy: falsy_indep,
                    ..c.clone()
                });
            }
            if has_conf {
                conflict.push(Conditional {
                    truthy: truthy_conf,
                    falsy: falsy_conf,
                    ..c.clone()
                });
            }
        }

        let mut class_parts: Vec<String> = Vec::new();
        if !existing_class.is_empty() {
            class_parts.push(existing_class);
        }
        let bound_from = class_parts.len();
        if !base_independent.is_empty() {
            let class_name = self.process_class(&base_independent, &state_weights);
            if !class_name.is_empty() {
                class_parts.push(quote(&class_name));
            }
        }
        for c in independent.iter().filter(|c| c.group_id.is_none()) {
            let truthy = if c.truthy.is_empty() {
                "\"\"".to_string()
            } else {
                quote(&self.process_class(&c.truthy, &state_weights))
            };
            let falsy = if c.falsy.is_empty() {
                "\"\"".to_string()
            } else {
                quote(&self.process_class(&c.falsy, &state_weights))
            };
            let test = c.test_string.clone().unwrap_or_else(|| self.text(c.test));
            class_parts.push(format!("({test} ? {truthy} : {falsy})"));
        }
        let mut indep_groups: BTreeMap<u32, Vec<&Conditional>> = BTreeMap::new();
        for c in &independent {
            if let Some(group_id) = c.group_id {
                indep_groups.entry(group_id).or_default().push(c);
            }
        }
        for options in indep_groups.values() {
            let common = options[0]
                .test_lhs
                .clone()
                .or_else(|| options[0].test_string.clone())
                .unwrap_or_else(|| self.text(options[0].test));
            let mut lookup = Object::new();
            for option in options {
                if let Some(value_name) = &option.value_name {
                    let class_name = self.process_class(&option.truthy, &state_weights);
                    if !class_name.is_empty() {
                        lookup.insert(value_name.clone(), Value::Str(class_name));
                    }
                }
            }
            if !lookup.is_empty() {
                let entries: Vec<(String, String)> = lookup
                    .iter()
                    .map(|(k, v)| (k.to_string(), quote(&v.to_js_string())))
                    .collect();
                class_parts.push(format!("({}[{common}] || \"\")", lookup_table(&entries)));
            }
        }

        if !base_conflict.is_empty() || !conflict.is_empty() {
            let mut ordered: Vec<(i64, Dimension)> = Vec::new();
            for (order, style) in &base_chunks {
                let mut conflicting_style = Object::new();
                for (key, value) in style.iter() {
                    if conflicting.contains(key) {
                        conflicting_style.insert(key, value.clone());
                    }
                }
                if conflicting_style.is_empty() {
                    continue;
                }
                ordered.push((
                    *order,
                    Dimension {
                        kind: DimKind::Const,
                        options: vec![(String::new(), conflicting_style)],
                        test_expr: String::new(),
                    },
                ));
            }
            for c in conflict.iter().filter(|c| c.group_id.is_none()) {
                ordered.push((
                    c.order,
                    Dimension {
                        kind: DimKind::Std,
                        test_expr: c.test_string.clone().unwrap_or_else(|| self.text(c.test)),
                        options: vec![
                            ("0".to_string(), c.falsy.clone()),
                            ("1".to_string(), c.truthy.clone()),
                        ],
                    },
                ));
            }
            let mut conflict_groups: BTreeMap<u32, Vec<Conditional>> = BTreeMap::new();
            for c in &conflict {
                if let Some(group_id) = c.group_id {
                    conflict_groups.entry(group_id).or_default().push(c.clone());
                }
            }
            for (group_id, options) in conflict_groups.iter_mut() {
                let mut present: FxHashSet<Option<String>> =
                    options.iter().map(|c| c.value_name.clone()).collect();
                for c in &conditionals {
                    if c.group_id != Some(*group_id) || present.contains(&c.value_name) {
                        continue;
                    }
                    present.insert(c.value_name.clone());
                    options.push(Conditional {
                        truthy: Object::new(),
                        falsy: Object::new(),
                        ..c.clone()
                    });
                }
            }
            for options in conflict_groups.values() {
                let first = &options[0];
                ordered.push((
                    first.order,
                    Dimension {
                        kind: DimKind::Var,
                        test_expr: first
                            .test_lhs
                            .clone()
                            .or_else(|| first.test_string.clone())
                            .unwrap_or_else(|| self.text(first.test)),
                        options: options
                            .iter()
                            .map(|option| {
                                (
                                    option.value_name.clone().unwrap_or_default(),
                                    option.truthy.clone(),
                                )
                            })
                            .collect(),
                    },
                ));
            }
            ordered.sort_by_key(|(order, _)| *order);
            let dimensions: Vec<Dimension> = ordered
                .into_iter()
                .map(|(_, dimension)| dimension)
                .collect();

            let mut leaves: IndexMap<Vec<String>, Vec<(usize, usize)>, FxBuildHasher> =
                IndexMap::default();
            for (d, dimension) in dimensions.iter().enumerate() {
                for (o, (_, style)) in dimension.options.iter().enumerate() {
                    let mut paths = Vec::new();
                    leaf_paths(style, &mut Vec::new(), &mut paths);
                    for path in paths {
                        leaves.entry(path).or_default().push((d, o));
                    }
                }
            }
            let mut chains: IndexMap<Vec<(usize, usize)>, Vec<Vec<String>>, FxBuildHasher> =
                IndexMap::default();
            for (path, setters) in leaves {
                chains.entry(setters).or_default().push(path);
            }

            for (setters, paths) in &chains {
                let mut classes: Vec<(usize, Vec<(usize, String)>)> = Vec::new();
                for &(d, o) in setters {
                    let mut picked = Object::new();
                    for path in paths {
                        pick_path(&mut picked, &dimensions[d].options[o].1, path);
                    }
                    let class_name = quote(&self.process_class(&picked, &state_weights));
                    match classes.last_mut() {
                        Some((last, by_option)) if *last == d => by_option.push((o, class_name)),
                        _ => classes.push((d, vec![(o, class_name)])),
                    }
                }

                let mut expr = "\"\"".to_string();
                let mut tests: Vec<String> = Vec::new();
                for (d, by_option) in &classes {
                    let dimension = &dimensions[*d];
                    let class_of = |option: usize| {
                        by_option
                            .iter()
                            .find(|(o, _)| *o == option)
                            .map(|(_, class_name)| class_name.clone())
                    };
                    match dimension.kind {
                        DimKind::Const => {
                            if let Some(class_name) = class_of(0) {
                                expr = class_name;
                                tests.clear();
                            }
                        }
                        DimKind::Std => {
                            let truthy = class_of(1).unwrap_or_else(|| expr.clone());
                            let falsy = class_of(0).unwrap_or_else(|| expr.clone());
                            if truthy == falsy {
                                expr = truthy;
                            } else {
                                expr = format!("({} ? {truthy} : {falsy})", dimension.test_expr);
                                tests.push(dimension.test_expr.clone());
                            }
                        }
                        DimKind::Var => {
                            tests.push(dimension.test_expr.clone());
                            let entries: Vec<(String, String)> = by_option
                                .iter()
                                .map(|(o, class_name)| {
                                    (dimension.options[*o].0.clone(), class_name.clone())
                                })
                                .collect();
                            expr = format!(
                                "({}[{}] ?? {expr})",
                                lookup_table(&entries),
                                dimension.test_expr
                            );
                        }
                    }
                }
                tests.pop();
                skippable.extend(tests);
                if expr != "\"\"" {
                    class_parts.push(expr);
                }
            }
        }

        if !bound.is_empty() {
            let parts = class_parts.split_off(bound_from);
            let params: Vec<String> = (0..bound.len())
                .map(|index| format!("__plumeria{index}"))
                .collect();
            let body = if parts.is_empty() {
                "\"\"".to_string()
            } else {
                parts.join(" + \" \" + ")
            };
            let uses = param_uses(&body);
            let inline = uses.len() == bound.len()
                && uses.iter().enumerate().all(|(index, use_)| *use_ == index)
                && uses
                    .iter()
                    .all(|use_| !skippable.contains(&format!("__plumeria{use_}")));
            if inline {
                class_parts.extend(parts.iter().map(|part| inline_params(part, &bound)));
            } else {
                class_parts.push(format!(
                    "(({}) => {body})({})",
                    params.join(", "),
                    bound.join(", ")
                ));
            }
        }

        class_parts.extend(dynamic_class_parts);
        Ok(Built {
            class_parts,
            is_optimizable,
            base_style,
            dynamic_vars,
            prop_var_spreads,
        })
    }

    pub fn resolve_create_object(&self, var_name: &str) -> Option<Object> {
        if let Some(local) = self.local_create_styles.get(var_name)
            && local.kind == StyleKind::Create
        {
            return Some(local.obj.clone());
        }
        let unique_key = format!("{}-{var_name}", self.resource);
        let hash = self
            .tables
            .create_hash
            .get(&unique_key)
            .filter(|h| !h.is_empty())
            .cloned()
            .or_else(|| self.merged_create_hash(var_name))?;
        match self.create_object(&hash)? {
            Value::Obj(object) => Some((*object).clone()),
            _ => None,
        }
    }

    fn resolve_bracket_group(&self, node: E<'b, 'a>) -> Option<(E<'b, 'a>, Object)> {
        if !node.is_member() {
            return None;
        }
        let object = node.object()?;
        let var_name = object.ident_name()?;
        let Some(Prop::Computed(key_expr)) = node.prop() else {
            return None;
        };
        if let K::Str(_) = key_expr.kind() {
            return None;
        }
        if !self.visibility().expr(object) {
            return None;
        }
        let obj = self.resolve_create_object(var_name)?;
        Some((key_expr, obj))
    }

    fn build_decision(
        &self,
        node: E<'b, 'a>,
        prefix: &str,
        off: &str,
        counter: &mut usize,
        scoped: bool,
    ) -> TResult<Option<Decision>> {
        match node.kind() {
            K::Paren(paren) => {
                return self.build_decision(
                    E::new(&paren.expression),
                    prefix,
                    off,
                    counter,
                    scoped,
                );
            }
            K::Conditional(cond) => {
                let Some(a) =
                    self.build_decision(E::new(&cond.consequent), prefix, off, counter, scoped)?
                else {
                    return Ok(None);
                };
                let Some(b) =
                    self.build_decision(E::new(&cond.alternate), prefix, off, counter, scoped)?
                else {
                    return Ok(None);
                };
                let mut options = a.options;
                options.extend(b.options);
                return Ok(Some(Decision {
                    key_expr: format!(
                        "(({}) ? {} : {})",
                        self.text(cond.test.span()),
                        a.key_expr,
                        b.key_expr
                    ),
                    options,
                    leaves: a.leaves + b.leaves,
                    has_group: a.has_group || b.has_group,
                }));
            }
            K::Binary(left, op, right) if op.is_and() => {
                let Some(r) = self.build_decision(right, prefix, off, counter, scoped)? else {
                    return Ok(None);
                };
                return Ok(Some(Decision {
                    key_expr: format!(
                        "(({}) ? {} : {})",
                        self.source_of(left),
                        r.key_expr,
                        quote(off)
                    ),
                    options: r.options,
                    leaves: r.leaves + 1,
                    has_group: r.has_group,
                }));
            }
            _ => {}
        }
        if let Some((key_expr, obj)) = self.resolve_bracket_group(node) {
            let tag = if scoped {
                let tag = format!("{}:", *counter);
                *counter += 1;
                tag
            } else {
                String::new()
            };
            let key_source = self.source_of(key_expr);
            let options = obj
                .iter()
                .map(|(value, style)| {
                    (
                        format!("{tag}{value}"),
                        style.as_obj().cloned().unwrap_or_default(),
                    )
                })
                .collect();
            return Ok(Some(Decision {
                key_expr: if tag.is_empty() {
                    key_source
                } else {
                    format!("({} + {key_source})", quote(&tag))
                },
                options,
                leaves: 1,
                has_group: true,
            }));
        }
        let Some(style) = self.resolve_style_object(node)? else {
            return Ok(None);
        };
        let value = format!("{prefix}{}", *counter);
        *counter += 1;
        Ok(Some(Decision {
            key_expr: quote(&value),
            options: vec![(value, style)],
            leaves: 1,
            has_group: false,
        }))
    }

    fn collect_group_keys(
        &self,
        node: E<'b, 'a>,
        acc: &mut IndexMap<String, Vec<Value>, FxBuildHasher>,
    ) {
        match node.kind() {
            K::Paren(paren) => self.collect_group_keys(E::new(&paren.expression), acc),
            K::Conditional(cond) => {
                self.collect_group_keys(E::new(&cond.consequent), acc);
                self.collect_group_keys(E::new(&cond.alternate), acc);
            }
            K::Binary(_, op, right) if op.is_and() => self.collect_group_keys(right, acc),
            _ => {
                if let Some((_, obj)) = self.resolve_bracket_group(node) {
                    for (key, style) in obj.iter() {
                        let styles = acc.entry(key.to_string()).or_default();
                        if !styles
                            .iter()
                            .any(|existing| same_reference(existing, style))
                        {
                            styles.push(style.clone());
                        }
                    }
                }
            }
        }
    }

    fn resolve_decision(&self, node: E<'b, 'a>) -> TResult<Option<Decision>> {
        let mut group_keys: IndexMap<String, Vec<Value>, FxBuildHasher> = IndexMap::default();
        self.collect_group_keys(node, &mut group_keys);
        let mut prefix = "#".to_string();
        while group_keys.keys().any(|key| key.starts_with(&prefix)) {
            prefix.push('#');
        }
        let scoped = group_keys.values().any(|styles| styles.len() > 1);
        let off = if !scoped && group_keys.contains_key("") {
            format!("{prefix}off")
        } else {
            String::new()
        };
        let mut counter = 0;
        self.build_decision(node, &prefix, &off, &mut counter, scoped)
    }

    fn collect_conditions(
        &mut self,
        builder: &mut Builder,
        node: E<'b, 'a>,
        tests: &[String],
        arg_order: Option<i64>,
    ) -> TResult<bool> {
        let node = self.resolve_local_style_alias(unwrap(node));
        if node.is_no_op_style() {
            return Ok(true);
        }
        if let K::Array(array) = node.kind() {
            for element in &array.elements {
                let inner = match element {
                    ArrayExpressionElement::Elision(_) => continue,
                    ArrayExpressionElement::SpreadElement(spread) => {
                        return Err(self.fail(
                            spread_style_message(&self.source_of(E::new(&spread.argument))),
                            Some(spread.argument.span()),
                        ));
                    }
                    other => E::new(other.to_expression()),
                };
                if !self.collect_conditions(builder, inner, tests, arg_order)? {
                    return Ok(false);
                }
            }
            return Ok(true);
        }
        let mut branch_style = self.resolve_style_object(node)?;
        if branch_style.is_none()
            && let Some((style, vars)) = self.resolve_dynamic_call(node, false)?
        {
            if !builder.is_style_prop {
                return Err(self.fail(
                    format!(
                        "[plumeria] css.use({}) does not support dynamic function keys.",
                        self.source_of(node)
                    ),
                    Some(node.span()),
                ));
            }
            branch_style = Some(style);
            for var in vars {
                builder.dynamic_vars.push(DynamicVar {
                    test: if tests.is_empty() {
                        None
                    } else {
                        Some(tests.join(" && "))
                    },
                    order: arg_order,
                    ..var
                });
            }
        }
        if let Some(style) = branch_style {
            if tests.is_empty() {
                builder.base_style = deep_merge(&builder.base_style, &style);
                builder.base_chunks.push((builder.source_order, style));
            } else {
                builder.conditionals.push(Conditional {
                    test: node.span(),
                    test_string: Some(tests.join(" && ")),
                    test_lhs: None,
                    truthy: style,
                    falsy: Object::new(),
                    group_id: None,
                    value_name: None,
                    order: builder.source_order,
                });
            }
            builder.source_order += 1;
            return Ok(true);
        }
        match node.kind() {
            K::Conditional(cond) => {
                let test_source = self.text(cond.test.span());
                if tests.is_empty() {
                    let true_style = self.resolve_style_object(E::new(&cond.consequent))?;
                    let false_style = self.resolve_style_object(E::new(&cond.alternate))?;
                    if let (Some(true_style), Some(false_style)) = (true_style, false_style) {
                        builder.conditionals.push(Conditional {
                            test: node.span(),
                            test_string: Some(test_source),
                            test_lhs: None,
                            truthy: true_style,
                            falsy: false_style,
                            group_id: None,
                            value_name: None,
                            order: builder.source_order,
                        });
                        builder.source_order += 1;
                        return Ok(true);
                    }
                }
                let mut consequent_tests = tests.to_vec();
                consequent_tests.push(format!("({test_source})"));
                let consequent = self.collect_conditions(
                    builder,
                    E::new(&cond.consequent),
                    &consequent_tests,
                    arg_order,
                )?;
                let mut alternate_tests = tests.to_vec();
                alternate_tests.push(format!("!({test_source})"));
                let alternate = self.collect_conditions(
                    builder,
                    E::new(&cond.alternate),
                    &alternate_tests,
                    arg_order,
                )?;
                return Ok(consequent && alternate);
            }
            K::Binary(left, op, right) if op.is_and() => {
                let mut next = tests.to_vec();
                next.push(format!("({})", self.source_of(left)));
                return self.collect_conditions(builder, right, &next, arg_order);
            }
            K::Paren(paren) => {
                return self.collect_conditions(
                    builder,
                    E::new(&paren.expression),
                    tests,
                    arg_order,
                );
            }
            _ => {}
        }
        if self.push_prop_possibilities(builder, node, tests)? {
            return Ok(true);
        }
        self.assert_resolvable(node)?;
        Ok(false)
    }

    fn push_prop_possibilities(
        &mut self,
        builder: &mut Builder,
        expr: E<'b, 'a>,
        gates: &[String],
    ) -> TResult<bool> {
        let is_param_member = match expr.kind() {
            K::Member(_) => {
                let object = expr.object().and_then(|object| object.ident_name());
                object.is_some_and(|object| self.component_param_names.contains(object))
                    && matches!(expr.prop(), Some(Prop::Name(_)))
            }
            _ => false,
        };
        if !expr.is_ident() && !is_param_member {
            return Ok(false);
        }
        let param_object = if is_param_member {
            expr.object().and_then(|object| object.ident_name())
        } else {
            None
        };
        let is_props_member = param_object.is_some_and(|object| {
            !self.local_create_styles.contains_key(object)
                && self.merged_create_hash(object).is_none()
                && !self.merged_create.contains_key(object)
        });
        let var_name: String = match expr.ident_name() {
            Some(name) => name.to_string(),
            None => match expr.prop() {
                Some(Prop::Name(name)) => name.to_string(),
                _ => return Ok(false),
            },
        };
        let source = if expr.is_ident() {
            var_name.clone()
        } else {
            self.source_of(expr)
        };
        let owner = self.owner_component_of(expr.start());
        let prop_name = if expr.is_ident() {
            owner
                .as_ref()
                .and_then(|owner| self.prop_aliases.get(owner))
                .and_then(|aliases| aliases.get(&var_name))
                .cloned()
                .unwrap_or_else(|| var_name.clone())
        } else {
            var_name.clone()
        };
        if let Some(owner) = &owner {
            self.applied_style_props
                .insert(format!("{owner}:{prop_name}"));
        }

        let mut possibilities: Option<Vec<PropPossibility>> = owner.as_ref().and_then(|owner| {
            self.tables
                .component_props
                .get(&format!("{}-{owner}", self.resource))
                .and_then(|props| props.get(&prop_name))
                .map(|entries| entries.iter().map(to_possibility).collect())
        });
        if possibilities.is_none() {
            let prefix = format!("{}-", self.resource);
            let mut candidates = Vec::new();
            for (key, props) in &self.tables.component_props {
                if !key.starts_with(&prefix) {
                    continue;
                }
                if let Some(entries) = props.get(&prop_name) {
                    candidates.extend(entries.iter().map(to_possibility));
                }
            }
            if !candidates.is_empty() {
                possibilities = Some(candidates);
            }
        }

        let fallback = owner
            .as_ref()
            .and_then(|owner| self.prop_defaults.get(owner))
            .and_then(|defaults| defaults.get(&prop_name))
            .copied();
        if let Some(fallback) = fallback {
            let fallback_e = E::new(fallback);
            if !unwrap(fallback_e).is_no_op_style() {
                let Some(style) = self.resolve_style_object(fallback_e)? else {
                    return Err(self.fail(
                        prop_default_message(&self.source_of(fallback_e)),
                        Some(fallback.span()),
                    ));
                };
                let atoms = crate::style::records::atom_map(&style);
                let key = hash_str(&crate::style::records::atom_class_string(&atoms));
                let mut list = possibilities.unwrap_or_default();
                list.push(PropPossibility {
                    key: key.clone(),
                    style,
                    has_vars: false,
                });
                possibilities = Some(list);
                let span = fallback.span();
                self.replacements
                    .retain(|r| !(r.start >= span.start && r.end <= span.end));
                self.excluded_ranges.push((span.start, span.end));
                self.replacements.push(Replacement {
                    start: span.start,
                    end: span.end,
                    content: quote(&key),
                });
            }
        }

        let possibilities = match possibilities {
            Some(list) if !list.is_empty() => list,
            _ => {
                let declared = owner
                    .as_ref()
                    .and_then(|owner| self.declared_props.get(owner))
                    .is_some_and(|declared| declared.contains(&prop_name));
                return Ok(is_props_member || declared);
            }
        };

        let carries_vars = possibilities.iter().any(|entry| entry.has_vars);
        if carries_vars && !builder.is_style_prop {
            return Err(self.fail(
                format!(
                    "[plumeria] \"{var_name}\" carries a dynamic function key, and css.use() returns only a class name. Apply it to {} on the element instead.",
                    self.env.style_prop
                ),
                Some(expr.span()),
            ));
        }
        let gate = if gates.is_empty() {
            String::new()
        } else {
            format!("({}) && ", gates.join(" && "))
        };
        if carries_vars {
            let spread = format!("...({gate}{source} && {source}.vars)");
            if !builder.prop_var_spreads.contains(&spread) {
                builder.prop_var_spreads.push(spread);
            }
        }
        let token = if carries_vars {
            format!("(({source} && {source}.key) || {source})")
        } else {
            source.clone()
        };
        let test_lhs = if gates.is_empty() {
            token
        } else {
            format!("(({}) ? {token} : \"\")", gates.join(" && "))
        };
        builder.group_id_counter += 1;
        let group_id = builder.group_id_counter;
        let current_order = builder.source_order;
        builder.source_order += 1;

        let mut seen: FxHashSet<String> = FxHashSet::default();
        let push_option = |builder: &mut Builder, value_name: String, style: Object| {
            builder.conditionals.push(Conditional {
                test: expr.span(),
                test_string: Some(format!("{test_lhs} === {}", quote(&value_name))),
                test_lhs: Some(test_lhs.clone()),
                truthy: style,
                falsy: Object::new(),
                group_id: Some(group_id),
                value_name: Some(value_name),
                order: current_order,
            });
        };
        for entry in possibilities {
            if !seen.insert(entry.key.clone()) {
                continue;
            }
            push_option(builder, entry.key, entry.style);
        }
        if !gates.is_empty() {
            push_option(builder, String::new(), Object::new());
        }
        Ok(true)
    }

    pub fn jsx_attribute(&mut self, node: &'b JSXAttribute<'a>) -> TResult<()> {
        let JSXAttributeName::Identifier(name) = &node.name else {
            return Ok(());
        };
        let attr_name = name.name.to_string();
        let owner = self.jsx_owner.get(&node.span.start).cloned();
        let comp_key = owner.as_ref().and_then(|(key, _)| key.clone());
        let style_prop = self.env.style_prop.clone();
        let receives_style_prop = comp_key
            .as_ref()
            .and_then(|key| self.tables.style_receiver.get(key))
            .is_some_and(|props| props.contains(&attr_name));
        let mut relayed = false;
        let container_expr = match &node.value {
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                container.expression.as_expression()
            }
            _ => None,
        };

        if attr_name != style_prop || receives_style_prop {
            if let Some(comp_key) = &comp_key {
                if let Some(expr) = container_expr {
                    self.assert_no_style_array_spread(E::new(expr))?;
                }
                let list: Option<Vec<TableEntry>> = self
                    .tables
                    .component_props
                    .get(comp_key)
                    .and_then(|props| props.get(&attr_name))
                    .cloned();
                if let (Some(list), Some(expr)) = (list, container_expr) {
                    relayed = self.relay_prop(expr, &list)?;
                }
            }
            if attr_name != style_prop || relayed {
                return Ok(());
            }
        }

        let Some(JSXAttributeValue::ExpressionContainer(container)) = &node.value else {
            return Ok(());
        };
        let Some(expr) = container.expression.as_expression() else {
            let span = container.expression.span();
            return Err(self.fail(
                format!(
                    "[plumeria] Dynamic or unresolvable style object \"{}\" is not supported.",
                    self.text(span)
                ),
                Some(span),
            ));
        };
        let args: Vec<(E<'b, 'a>, Option<i64>)> = match expr {
            Expression::ArrayExpression(array) => {
                let mut args = Vec::new();
                for element in &array.elements {
                    match element {
                        ArrayExpressionElement::Elision(_) => continue,
                        ArrayExpressionElement::SpreadElement(spread) => {
                            return Err(self.fail(
                                spread_style_message(&self.source_of(E::new(&spread.argument))),
                                Some(spread.argument.span()),
                            ));
                        }
                        other => args.push((E::new(other.to_expression()), None)),
                    }
                }
                args
            }
            other => vec![(E::new(other), None)],
        };
        let attributes = owner.as_ref().map(|(_, attributes)| *attributes);
        if !receives_style_prop {
            return self.apply_style_attribute(node, E::new(expr), args, attributes);
        }
        let applied = std::mem::take(&mut self.applied_style_props);
        let result = self.apply_style_attribute(node, E::new(expr), args, attributes);
        let referenced = std::mem::replace(&mut self.applied_style_props, applied);
        result?;
        let received = referenced.iter().find_map(|key| {
            let (owner, prop_name) = key.split_once(':')?;
            self.tables
                .component_props
                .get(&format!("{}-{owner}", self.resource))
                .is_some_and(|props| props.contains_key(prop_name))
                .then_some(prop_name)
        });
        if let Some(prop_name) = received {
            return Err(self.fail(
                format!(
                    "[plumeria] \"{prop_name}\" is a style received through a prop and cannot be passed on to a component that declares {style_prop}. Apply it on an element this component renders."
                ),
                Some(node.span),
            ));
        }
        self.applied_style_props.extend(referenced);
        Ok(())
    }

    fn apply_style_attribute(
        &mut self,
        node: &'b JSXAttribute<'a>,
        expr: E<'b, 'a>,
        args: Vec<(E<'b, 'a>, Option<i64>)>,
        attributes: Option<&'b oxc_allocator::Vec<'a, JSXAttributeItem<'a>>>,
    ) -> TResult<()> {
        let class_prop = self.env.class_prop.clone();
        let mut existing_style_parts: Vec<String> = Vec::new();
        let mut existing_class = String::new();
        let mut existing_style = String::new();
        let empty: &[JSXAttributeItem] = &[];
        let items: &[JSXAttributeItem] = attributes.map(|a| a.as_slice()).unwrap_or(empty);

        let class_attr = items.iter().find_map(|item| match item {
            JSXAttributeItem::Attribute(attr) => match &attr.name {
                JSXAttributeName::Identifier(ident) if ident.name.as_str() == class_prop => {
                    Some(attr)
                }
                _ => None,
            },
            _ => None,
        });
        if let Some(class_attr) = class_attr {
            self.replacements.push(Replacement {
                start: class_attr.span.start,
                end: class_attr.span.end,
                content: String::new(),
            });
            match &class_attr.value {
                Some(JSXAttributeValue::StringLiteral(value)) => {
                    existing_class = quote(value.value.as_str().unwrap_or_default())
                }
                Some(JSXAttributeValue::ExpressionContainer(container)) => {
                    let span = container.expression.span();
                    let token = self.defer_range(span.start, span.end);
                    existing_class = format!("({token})");
                }
                _ => {}
            }
        }

        let style_attr = items.iter().find_map(|item| match item {
            JSXAttributeItem::Attribute(attr) => match &attr.name {
                JSXAttributeName::Identifier(ident) if ident.name.as_str() == "style" => Some(attr),
                _ => None,
            },
            _ => None,
        });
        if let Some(style_attr) = style_attr {
            self.replacements.push(Replacement {
                start: style_attr.span.start,
                end: style_attr.span.end,
                content: String::new(),
            });
            if let Some(JSXAttributeValue::ExpressionContainer(container)) = &style_attr.value {
                match container.expression.as_expression() {
                    Some(Expression::ObjectExpression(object)) => {
                        for property in &object.properties {
                            let span = match property {
                                ObjectPropertyKind::ObjectProperty(p) => p.span,
                                ObjectPropertyKind::SpreadProperty(spread) => spread.span,
                            };
                            existing_style_parts.push(self.defer_range(span.start, span.end));
                        }
                    }
                    _ => {
                        let span = container.expression.span();
                        let token = self.defer_range(span.start, span.end);
                        existing_style = format!("...({token})");
                    }
                }
            }
        }

        let arg_count = args.len();
        let built = self.build_class_parts(args, Vec::new(), existing_class.clone(), true)?;
        if !built.is_optimizable {
            return Err(self.fail(
                format!(
                    "[plumeria] Dynamic or unresolvable style object \"{}\" is not supported.",
                    self.source_of(expr)
                ),
                Some(expr.span()),
            ));
        }
        let mut style_parts = existing_style_parts;
        style_parts.extend(fold_dynamic_vars(&built.dynamic_vars));
        style_parts.extend(built.prop_var_spreads.clone());
        let style_attr_text = if !style_parts.is_empty() || !existing_style.is_empty() {
            let mut all = Vec::new();
            if !existing_style.is_empty() {
                all.push(existing_style);
            }
            all.extend(style_parts);
            format!(" style={{{{ {} }}}}", all.join(", "))
        } else {
            String::new()
        };

        if arg_count > 0 || !built.base_style.is_empty() {
            let replacement = if built.class_parts.is_empty() {
                "\"\"".to_string()
            } else {
                built.class_parts.join(" + \" \" + ")
            };
            let value = if built.class_parts.len() <= 1
                && replacement.starts_with('"')
                && !replacement.contains(['\\', '&'])
            {
                replacement
            } else {
                format!("{{{replacement}}}")
            };
            self.replacements.push(Replacement {
                start: node.span.start,
                end: node.span.end,
                content: format!("{class_prop}={value}{style_attr_text}"),
            });
        } else {
            let kept = if existing_class.is_empty() {
                String::new()
            } else {
                format!("{class_prop}={{{existing_class}}}")
            };
            self.replacements.push(Replacement {
                start: node.span.start,
                end: node.span.end,
                content: format!("{kept}{style_attr_text}"),
            });
        }
        Ok(())
    }

    fn relay_prop(&mut self, expr: &'b Expression<'a>, list: &[TableEntry]) -> TResult<bool> {
        let mut index: FxHashMap<u32, Vec<TableEntry>> = FxHashMap::default();
        for entry in list {
            if entry.file != self.resource {
                continue;
            }
            index
                .entry(entry.span_start)
                .or_default()
                .push(entry.clone());
        }
        let mut relayed = false;
        let mut candidates: Vec<E<'b, 'a>> = Vec::new();
        collect_relay_candidates(E::new(expr), &mut candidates);
        for sub in candidates {
            if self.replace_with_key(sub, &index)? {
                relayed = true;
                self.excluded_ranges
                    .push((sub.span().start, sub.span().end));
            }
        }
        Ok(relayed)
    }

    fn carrier_for(
        &self,
        sub: E<'b, 'a>,
        calls: Option<&Vec<(u32, u32)>>,
    ) -> TResult<Option<String>> {
        let mut vars: Vec<DynamicVar> = Vec::new();
        let mut roots: Vec<E<'b, 'a>> = Vec::new();
        match calls {
            Some(calls) => {
                for (start, end) in calls {
                    if let Some(found) = find_expression(sub, *start, *end) {
                        roots.push(found);
                    }
                }
            }
            None => roots.push(sub),
        }
        let mut unresolved = false;
        for root in roots {
            let mut found: Vec<E<'b, 'a>> = Vec::new();
            collect_calls(root, &mut found);
            for call in found {
                if !self.is_style_function_call(call) {
                    continue;
                }
                match self.resolve_dynamic_call(call, true)? {
                    Some((_, resolved)) => vars.extend(resolved),
                    None => unresolved = true,
                }
            }
        }
        if unresolved {
            return Ok(None);
        }
        Ok(Some(format!(
            "{{ {} }}",
            fold_dynamic_vars(&vars).join(", ")
        )))
    }

    fn replace_with_key(
        &mut self,
        sub: E<'b, 'a>,
        index: &FxHashMap<u32, Vec<TableEntry>>,
    ) -> TResult<bool> {
        let Some(entries) = index.get(&sub.start()) else {
            return Ok(false);
        };
        let mut content = "\"\"".to_string();
        for entry in entries.iter().rev() {
            let mut value = quote(&entry.key);
            if entry.has_vars {
                let Some(carrier) = self.carrier_for(sub, entry.dynamic_calls.as_ref())? else {
                    return Ok(false);
                };
                value = format!("{{ key: {value}, vars: {carrier} }}");
            }
            let condition = entry
                .conditions
                .as_ref()
                .map(|conditions| {
                    conditions
                        .iter()
                        .map(|condition| {
                            let text = self.text(Span::new(condition.test.0, condition.test.1));
                            format!("{}({text})", if condition.truthy { "" } else { "!" })
                        })
                        .collect::<Vec<_>>()
                        .join(" && ")
                })
                .unwrap_or_default();
            content = if condition.is_empty() {
                value
            } else {
                format!("(({condition}) ? {value} : {content})")
            };
        }
        let span = sub.span();
        self.replacements.push(Replacement {
            start: span.start,
            end: span.end,
            content,
        });
        Ok(true)
    }
}

fn same_reference(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Obj(x), Value::Obj(y)) => std::sync::Arc::ptr_eq(x, y),
        _ => a == b,
    }
}

fn to_possibility(entry: &TableEntry) -> PropPossibility {
    PropPossibility {
        key: entry.key.clone(),
        style: entry.style.clone(),
        has_vars: entry.has_vars,
    }
}

fn namespace_member(node: E, root_name: &str) -> Option<String> {
    let node = unwrap(node);
    match node.kind() {
        K::Call(call) => match &call.callee {
            Expression::Super(_) => None,
            callee => namespace_member(E::new(callee), root_name),
        },
        K::Member(member) => {
            let object = unwrap(node.member_object(member));
            if object.ident_name() == Some(root_name) {
                return match node.prop() {
                    Some(Prop::Name(name)) => Some(name.to_string()),
                    _ => None,
                };
            }
            namespace_member(object, root_name)
        }
        _ => None,
    }
}

fn collect_relay_candidates<'b, 'a>(e: E<'b, 'a>, out: &mut Vec<E<'b, 'a>>) {
    use oxc_ast_visit::{Visit, walk};
    struct Collect<'b, 'a> {
        out: Vec<E<'b, 'a>>,
    }
    impl<'b, 'a> Visit<'a> for Collect<'b, 'a> {
        fn visit_expression(&mut self, it: &Expression<'a>) {
            if matches!(
                it,
                Expression::StaticMemberExpression(_)
                    | Expression::ComputedMemberExpression(_)
                    | Expression::PrivateFieldExpression(_)
                    | Expression::ArrayExpression(_)
                    | Expression::CallExpression(_)
            ) {
                self.out.push(E::new(super::context::extend(it)));
            }
            walk::walk_expression(self, it);
        }
        fn visit_chain_element(&mut self, it: &ChainElement<'a>) {
            match it {
                ChainElement::CallExpression(call) => {
                    self.out.push(E::from_call(super::context::extend(&**call)))
                }
                ChainElement::StaticMemberExpression(m) => {
                    self.out
                        .push(E::from_member(crate::syntax::expr::Member::Static(
                            super::context::extend(&**m),
                        )))
                }
                ChainElement::ComputedMemberExpression(m) => {
                    self.out
                        .push(E::from_member(crate::syntax::expr::Member::Computed(
                            super::context::extend(&**m),
                        )))
                }
                ChainElement::PrivateFieldExpression(m) => {
                    self.out
                        .push(E::from_member(crate::syntax::expr::Member::Private(
                            super::context::extend(&**m),
                        )))
                }
                _ => {}
            }
            walk::walk_chain_element(self, it);
        }
    }
    let mut collect = Collect { out: Vec::new() };
    if let Some(expr) = e.expr() {
        collect.visit_expression(expr);
    }
    out.extend(collect.out);
}

fn collect_calls<'b, 'a>(e: E<'b, 'a>, out: &mut Vec<E<'b, 'a>>) {
    use oxc_ast_visit::{Visit, walk};
    struct Collect<'b, 'a> {
        out: Vec<E<'b, 'a>>,
    }
    impl<'b, 'a> Visit<'a> for Collect<'b, 'a> {
        fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
            self.out.push(E::from_call(super::context::extend(it)));
            walk::walk_call_expression(self, it);
        }
    }
    let mut collect = Collect { out: Vec::new() };
    if let Some(expr) = e.expr() {
        collect.visit_expression(expr);
    } else {
        match e.kind() {
            K::Call(call) => collect.visit_call_expression(call),
            K::Member(crate::syntax::expr::Member::Static(m)) => {
                collect.visit_static_member_expression(m)
            }
            K::Member(crate::syntax::expr::Member::Computed(m)) => {
                collect.visit_computed_member_expression(m)
            }
            K::Member(crate::syntax::expr::Member::Private(m)) => {
                collect.visit_private_field_expression(m)
            }
            _ => {}
        }
    }
    out.extend(collect.out);
}

fn find_expression<'b, 'a>(root: E<'b, 'a>, start: u32, end: u32) -> Option<E<'b, 'a>> {
    use oxc_ast_visit::{Visit, walk};
    struct Find<'b, 'a> {
        start: u32,
        end: u32,
        found: Option<E<'b, 'a>>,
    }
    impl<'b, 'a> Visit<'a> for Find<'b, 'a> {
        fn visit_expression(&mut self, it: &Expression<'a>) {
            if self.found.is_some() {
                return;
            }
            let span = it.span();
            if span.start == self.start && span.end == self.end {
                self.found = Some(E::new(super::context::extend(it)));
                return;
            }
            walk::walk_expression(self, it);
        }
    }
    let span = root.span();
    if span.start == start && span.end == end {
        return Some(root);
    }
    let mut find = Find {
        start,
        end,
        found: None,
    };
    match root.kind() {
        K::Call(call) => find.visit_call_expression(call),
        K::Array(array) => find.visit_array_expression(array),
        K::Member(crate::syntax::expr::Member::Static(m)) => find.visit_static_member_expression(m),
        K::Member(crate::syntax::expr::Member::Computed(m)) => {
            find.visit_computed_member_expression(m)
        }
        _ => {
            if let Some(expr) = root.expr() {
                find.visit_expression(expr);
            }
        }
    }
    find.found
}
