use std::collections::BTreeMap;

use indexmap::IndexMap;
use oxc_ast::ast::*;
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxBuildHasher, FxHashMap, FxHashSet};

use super::context::StaticStack;
use super::hoist::PREFIX;
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
use crate::project::{Condition, TableEntry};
use crate::style::escalation::{StyleSource, get_state_weights};
use crate::style::records::{Weights, class_string};
use crate::syntax::expr::{E, K, Prop, root_identifier, unwrap};

#[derive(Clone, Debug)]
pub struct DynamicVar {
    pub css_var: String,
    pub value_expr: String,
    pub test: Option<String>,
    pub order: Option<i64>,
    pub call: Option<std::sync::Arc<CallBinding>>,
}

#[derive(Debug)]
pub struct CallBinding {
    pub params: Vec<String>,
    pub args: Vec<String>,
}

#[derive(Default)]
pub(super) struct ElementPlan {
    params: Vec<String>,
    vars: Vec<(String, bool)>,
    folds: Vec<String>,
    reads: FxHashMap<(u32, u32), String>,
    class_runtime: bool,
    style_runtime: bool,
    assign: bool,
    base: usize,
    objects: FxHashMap<String, String>,
    direct: Option<(u32, String)>,
}

impl ElementPlan {
    fn slot(&mut self, kind: &str) -> String {
        let name = format!("{PREFIX}{kind}{}", self.base + self.params.len());
        self.params.push(name.clone());
        name
    }

    fn item(&self, name: &str, value: String) -> String {
        if self.assign {
            format!("({name} = {value})")
        } else {
            value
        }
    }
}

fn runs_no_code(value: &str) -> bool {
    value.starts_with("(typeof (")
        || (value.len() >= 2 && value.starts_with('"') && value.ends_with('"'))
        || is_identifier(value)
}

fn join_attributes(attributes: Vec<String>) -> String {
    attributes
        .into_iter()
        .filter(|attribute| !attribute.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn static_class(part: &str) -> Option<&str> {
    let inner = part.strip_prefix('"')?.strip_suffix('"')?;
    (!inner.contains(['"', '\\'])).then_some(inner)
}

fn class_ternary(part: &str) -> Option<(&str, &str, &str)> {
    let body = part.strip_prefix('(')?.strip_suffix(')')?;
    let (left, falsy) = body.rsplit_once(" : ")?;
    let falsy = static_class(falsy)?;
    let (test, truthy) = left.rsplit_once(" ? ")?;
    let truthy = static_class(truthy)?;
    Some((test, truthy, falsy))
}

fn generated_test<'s>(test: &'s str, generated: &[String]) -> Option<(&'s str, bool)> {
    let (base, negated) = match test.strip_prefix('!') {
        Some(inner) => (inner, true),
        None => (test, false),
    };
    let name = base
        .strip_prefix('(')
        .and_then(|name| name.strip_suffix(')'))
        .unwrap_or(base);
    generated
        .iter()
        .any(|generated| generated == name)
        .then_some((name, negated))
}

fn complementary(first: &str, second: &str, generated: &[String]) -> bool {
    matches!(
        (generated_test(first, generated), generated_test(second, generated)),
        (Some((a, negated_a)), Some((b, negated_b))) if a == b && negated_a != negated_b
    )
}

pub fn join_class_parts(parts: &[String], generated: &[String]) -> String {
    if parts.is_empty() {
        return "\"\"".to_string();
    }
    let mut ternaries: Vec<(usize, &str, &str, &str)> = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        if static_class(part).is_some() {
            continue;
        }
        let Some((test, truthy, falsy)) = class_ternary(part) else {
            return parts.join(" + \" \" + ");
        };
        ternaries.push((index, test, truthy, falsy));
    }
    let keys: Vec<(&str, bool)> = if ternaries.len() == 1 {
        let (_, test, _, _) = ternaries[0];
        vec![generated_test(test, generated).unwrap_or((test, false))]
    } else {
        let keys: Option<Vec<(&str, bool)>> = ternaries
            .iter()
            .map(|(_, test, _, _)| generated_test(test, generated))
            .collect();
        match keys {
            Some(keys) if keys.windows(2).all(|pair| pair[0].0 == pair[1].0) => keys,
            _ => return parts.join(" + \" \" + "),
        }
    };
    let mut yes: Vec<&str> = Vec::new();
    let mut no: Vec<&str> = Vec::new();
    let mut pending = ternaries.iter().zip(&keys).peekable();
    for (index, part) in parts.iter().enumerate() {
        if let Some(((at, _, truthy, falsy), (_, negated))) = pending.peek()
            && *at == index
        {
            let (when_true, when_false) = if *negated {
                (*falsy, *truthy)
            } else {
                (*truthy, *falsy)
            };
            yes.extend((!when_true.is_empty()).then_some(when_true));
            no.extend((!when_false.is_empty()).then_some(when_false));
            pending.next();
        } else if let Some(class) = static_class(part)
            && !class.is_empty()
        {
            yes.push(class);
            no.push(class);
        }
    }
    match keys.first() {
        Some((test, _)) => format!(
            "({test} ? {} : {})",
            quote(&yes.join(" ")),
            quote(&no.join(" "))
        ),
        None => quote(&yes.join(" ")),
    }
}

fn generated_style(vars: &[(String, bool)]) -> String {
    let names: Vec<&str> = vars.iter().map(|(name, _)| name.as_str()).collect();
    let copy = || {
        let spread: Vec<String> = names.iter().map(|name| format!("...{name}")).collect();
        format!("{{ {} }}", spread.join(", "))
    };
    match vars {
        [] => "undefined".to_string(),
        [(only, true)] => only.clone(),
        [(only, false)] => format!("{only} || undefined"),
        _ if vars.iter().any(|(_, always)| *always) => copy(),
        _ => format!("({}) ? {} : undefined", names.join(" || "), copy()),
    }
}

fn mentions(text: &str, name: &str) -> bool {
    text.match_indices(name).any(|(at, _)| {
        let before = text[..at].chars().next_back();
        let after = text[at + name.len()..].chars().next();
        let word = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
        !word(before) && !word(after)
    })
}

fn assigned_call(call: &CallBinding, value: &str) -> String {
    let assignments: Vec<String> = call
        .params
        .iter()
        .zip(&call.args)
        .map(|(param, arg)| format!("{param} = {arg}"))
        .collect();
    format!("({}, {value})", assignments.join(", "))
}

type Invoke<'f> = &'f dyn Fn(&str, &str, &str) -> String;

fn vars_object(vars: &[DynamicVar], assign: bool, invoke: Invoke) -> Option<(String, bool, bool)> {
    let first = vars.first()?;
    let pairs: Vec<String> = vars
        .iter()
        .filter(|entry| !entry.css_var.is_empty())
        .map(|entry| format!("\"{}\": {}", entry.css_var, entry.value_expr))
        .collect();
    let Some(call) = &first.call else {
        return Some((format!("{{ {} }}", pairs.join(", ")), false, true));
    };
    if assign {
        let value = if pairs.is_empty() {
            "null".to_string()
        } else {
            format!("{{ {} }}", pairs.join(", "))
        };
        return Some((assigned_call(call, &value), true, !pairs.is_empty()));
    }
    let body = if pairs.is_empty() {
        "null".to_string()
    } else {
        format!("({{ {} }})", pairs.join(", "))
    };
    Some((
        invoke(&call.params.join(", "), &body, &call.args.join(", ")),
        true,
        !pairs.is_empty(),
    ))
}

pub fn fold_dynamic_vars(vars: &[DynamicVar], assign: bool, invoke: Invoke) -> Vec<String> {
    let mut sorted: Vec<&DynamicVar> = vars.iter().collect();
    sorted.sort_by_key(|entry| entry.order.unwrap_or(0));
    if sorted.iter().any(|entry| entry.call.is_some()) {
        let mut parts = Vec::new();
        let mut index = 0;
        while index < sorted.len() {
            let first = sorted[index];
            let mut end = index + 1;
            if let Some(call) = &first.call {
                while end < sorted.len()
                    && sorted[end]
                        .call
                        .as_ref()
                        .is_some_and(|other| std::sync::Arc::ptr_eq(call, other))
                {
                    end += 1;
                }
            }
            let pairs: Vec<String> = sorted[index..end]
                .iter()
                .filter(|entry| !entry.css_var.is_empty())
                .map(|entry| format!("\"{}\": {}", entry.css_var, entry.value_expr))
                .collect();
            let object = match &first.call {
                Some(call) if assign => {
                    assigned_call(call, &format!("{{ {} }}", pairs.join(", ")))
                }
                Some(call) => invoke(
                    &call.params.join(", "),
                    &format!("({{ {} }})", pairs.join(", ")),
                    &call.args.join(", "),
                ),
                None => format!("{{ {} }}", pairs.join(", ")),
            };
            parts.push(match &first.test {
                Some(test) => format!("...(({test}) ? {object} : null)"),
                None => format!("...{object}"),
            });
            index = end;
        }
        return parts;
    }
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

const PARAM: &str = PREFIX;

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

fn param_matches(text: &str) -> Vec<(usize, usize, usize)> {
    let bytes = text.as_bytes();
    let mut matches = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            quote @ (b'"' | b'\'' | b'`') => {
                at += 1;
                while at < bytes.len() && bytes[at] != quote {
                    at += if bytes[at] == b'\\' { 2 } else { 1 };
                }
                at += 1;
            }
            _ if bytes[at..].starts_with(PARAM.as_bytes())
                && !(at > 0 && {
                    let before = bytes[at - 1];
                    before.is_ascii_alphanumeric() || before == b'_' || before == b'$' || before >= 0x80
                }) =>
            {
                match param_at(text, at) {
                    Some((index, end)) => {
                        matches.push((at, index, end));
                        at = end;
                    }
                    None => at += PARAM.len(),
                }
            }
            _ => at += 1,
        }
    }
    matches
}

fn param_uses(text: &str) -> Vec<usize> {
    param_matches(text)
        .into_iter()
        .map(|(_, index, _)| index)
        .collect()
}

fn inline_params(text: &str, bound: &[String]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for (start, index, end) in param_matches(text) {
        if let Some(source) = bound.get(index) {
            out.push_str(&text[last..start]);
            out.push_str(source);
            last = end;
        }
    }
    out.push_str(&text[last..]);
    out
}

fn lookup_table(entries: &[(String, String)], closed: bool) -> String {
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
    let prototype = if closed { "" } else { "__proto__:null," };
    format!("{{{prototype}{}}}", body.join(","))
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
    can_skip_test: bool,
    test: Span,
    test_string: Option<String>,
    test_lhs: Option<String>,
    truthy: Object,
    falsy: Object,
    group_id: Option<u32>,
    value_name: Option<String>,
    order: i64,
    closed: bool,
}

pub struct Built {
    pub class_parts: Vec<String>,
    pub is_optimizable: bool,
    pub base_style: Object,
    pub dynamic_vars: Vec<DynamicVar>,
    pub prop_var_spreads: Vec<String>,
    pub stable_tests: Vec<String>,
}

impl Built {
    fn generated(&self, params: &[String]) -> Vec<String> {
        params.iter().chain(&self.stable_tests).cloned().collect()
    }
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
    closed: bool,
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
        let mut extra: Vec<E<'b, 'a>> = Vec::new();

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
                    let at = match prop {
                        ObjectPropertyKind::SpreadProperty(spread) => Some(spread.argument.span()),
                        ObjectPropertyKind::ObjectProperty(p) if p.computed => Some(p.key.span()),
                        _ => None,
                    };
                    if at.is_some() {
                        return Err(self.fail(
                            format!(
                                "[plumeria] {} cannot take a spread or a computed key, because {property} destructures its parameter. Write each key out.",
                                self.source_of(expr)
                            ),
                            at,
                        ));
                    }
                    let ObjectPropertyKind::ObjectProperty(p) = prop else {
                        continue;
                    };
                    if p.shorthand {
                        if let Expression::Identifier(ident) = &p.value
                            && let Some(earlier) =
                                given.insert(ident.name.to_string(), E::new(&p.value))
                        {
                            extra.push(earlier);
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
                    if let Some(earlier) = given.insert(key, E::new(&p.value)) {
                        extra.push(earlier);
                    }
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
            extra.extend(
                given
                    .iter()
                    .filter(|(key, _)| !named.iter().any(|param| &param.key == *key))
                    .map(|(_, source)| *source),
            );
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
                match func.params.get(index) {
                    Some(param) => runtime.push((param.clone(), argument_expr(argument))),
                    None => extra.push(argument_expr(argument)),
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

        let text_of = |source: E<'b, 'a>| self.source_of(source);
        let inline_argument = extra.is_empty() && resolved.derived.is_empty()
            && matches!(runtime.as_slice(), [(param, source)]
                if self.is_stable_read(*source) && resolved.var_groups.contains_key(param));
        let mut reads: Vec<(u32, Option<&String>, String)> = runtime
            .iter()
            .map(|(param, source)| (source.span().start, Some(param), text_of(*source)))
            .chain(
                extra
                    .iter()
                    .map(|source| (source.span().start, None, text_of(*source))),
            )
            .filter(|(_, _, text)| !inline_argument && !is_literal_source(text))
            .collect();
        reads.sort_by_key(|(start, _, _)| *start);
        let base = self.arg_base.get().unwrap_or(0);
        if let Some(base) = self.arg_base.get() {
            self.arg_base.set(Some(base + reads.len()));
        }
        let names: Vec<String> = (0..reads.len())
            .map(|index| format!("{PREFIX}a{}", base + index))
            .collect();
        let mut sources: Vec<(String, String)> = runtime
            .iter()
            .map(|(param, source)| {
                let read = reads.iter().position(|(_, read, _)| *read == Some(param));
                match read {
                    Some(index) => (param.clone(), names[index].clone()),
                    None => (param.clone(), text_of(*source)),
                }
            })
            .collect();
        let call_binding = (!reads.is_empty()).then(|| {
            std::sync::Arc::new(CallBinding {
                params: names.clone(),
                args: reads.iter().map(|(_, _, text)| text.clone()).collect(),
            })
        });
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
                            Some(fallback) => rendered.push_str(&self.read_once(argument, |value| {
                                format!("({value}) === undefined ? {fallback} : ({value})")
                            })),
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
                    self.read_once(arg_source, |value| {
                        format!("typeof ({value}) === 'number' ? ({value}) + '{unit}' : ({value})")
                    })
                } else {
                    arg_source.clone()
                };
                vars.push(DynamicVar {
                    css_var: group.css_var.clone(),
                    value_expr,
                    test: None,
                    order: None,
                    call: call_binding.clone(),
                });
            }
        }
        if vars.is_empty()
            && let Some(call) = call_binding
        {
            vars.push(DynamicVar {
                css_var: String::new(),
                value_expr: String::new(),
                test: None,
                order: None,
                call: Some(call),
            });
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
                    let dyn_source = self.read_text(dyn_expr.span());
                    builder.group_id_counter += 1;
                    let group_id = builder.group_id_counter;
                    let current_order = builder.source_order;
                    builder.source_order += 1;
                    for (option_name, style) in style_obj.iter() {
                        builder.conditionals.push(Conditional {
                            can_skip_test: self.can_skip_test(dyn_expr),
                            test: dyn_expr.span(),
                            test_string: Some(format!("{dyn_source} === '{option_name}'")),
                            test_lhs: Some(dyn_source.clone()),
                            truthy: style.as_obj().cloned().unwrap_or_default(),
                            falsy: Object::new(),
                            group_id: Some(group_id),
                            value_name: Some(option_name.to_string()),
                            order: current_order,
                            closed: false,
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
                let key_expr = self
                    .element_reads
                    .as_ref()
                    .and_then(|reads| reads.get(&(expr.span().start, expr.span().end)))
                    .cloned()
                    .unwrap_or(decision.key_expr);
                for (value, style) in decision.options {
                    builder.conditionals.push(Conditional {
                        can_skip_test: false,
                        test: expr.span(),
                        test_string: Some(format!("{key_expr} === '{value}'")),
                        test_lhs: Some(key_expr.clone()),
                        truthy: style,
                        falsy: Object::new(),
                        group_id: Some(group_id),
                        value_name: Some(value),
                        order: current_order,
                        closed: !decision.has_group,
                    });
                }
                continue;
            }

            if self.collect_conditions(&mut builder, expr, &[], true, *order)? {
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
                stable_tests: Vec::new(),
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

        let mut generated: Vec<String> = self
            .element_reads
            .iter()
            .flat_map(|reads| reads.values().cloned())
            .collect();
        let mut stable_tests: Vec<String> = Vec::new();
        for c in conditionals.iter().filter(|c| c.can_skip_test && c.group_id.is_none()) {
            let Some(test) = &c.test_string else { continue };
            let test = test.strip_prefix('!').unwrap_or(test);
            let name = test
                .strip_prefix('(')
                .and_then(|name| name.strip_suffix(')'))
                .unwrap_or(test);
            if oxc_syntax::identifier::is_identifier_name(name)
                && !generated.iter().any(|known| known == name)
            {
                generated.push(name.to_string());
                stable_tests.push(name.to_string());
            }
        }

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
                .zip(&conditionals)
                .any(|(source, c)| {
                    !c.can_skip_test
                        && source.as_deref().is_some_and(|s| generated_test(s, &generated).is_none())
                })
        {
            let mut bound_groups: FxHashMap<u32, String> = FxHashMap::default();
            for (c, source) in conditionals.iter_mut().zip(test_sources) {
                let name = c
                    .group_id
                    .and_then(|group| bound_groups.get(&group).cloned());
                let param = name
                    .clone()
                    .unwrap_or_else(|| format!("{PREFIX}{}", bound.len()));
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
                class_parts.push(format!(
                    "({}[{common}] || \"\")",
                    lookup_table(&entries, options[0].closed)
                ));
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
                        closed: true,
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
                        closed: true,
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
                        closed: first.closed,
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
                let mut last: Option<(String, String, String, String)> = None;
                for (d, by_option) in &classes {
                    let previous = last.take();
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
                            let complement = previous.filter(|(test, _, _, built)| {
                                *built == expr
                                    && complementary(test, &dimension.test_expr, &generated)
                            });
                            if let Some((test, yes, no, _)) = complement {
                                let when_true = if falsy == expr { yes } else { falsy };
                                let when_false = if truthy == expr { no } else { truthy };
                                if when_true == when_false {
                                    tests.pop();
                                    expr = when_true;
                                } else {
                                    expr = format!("({test} ? {when_true} : {when_false})");
                                    last = Some((test, when_true, when_false, expr.clone()));
                                }
                            } else if truthy == falsy {
                                expr = truthy;
                            } else {
                                expr = format!("({} ? {truthy} : {falsy})", dimension.test_expr);
                                tests.push(dimension.test_expr.clone());
                                last = Some((dimension.test_expr.clone(), truthy, falsy, expr.clone()));
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
                                lookup_table(&entries, dimension.closed),
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
                .map(|index| format!("{PREFIX}{index}"))
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
                    .all(|use_| !skippable.contains(&format!("{PREFIX}{use_}")));
            if inline {
                class_parts.extend(parts.iter().map(|part| inline_params(part, &bound)));
            } else if uses.is_empty() {
                class_parts.push(format!("({}, {body})", bound.join(", ")));
            } else if let Some(base) = self.arg_base.get() {
                self.arg_base.set(Some(base + bound.len()));
                let names: Vec<String> = (0..bound.len())
                    .map(|index| format!("{PREFIX}a{}", base + index))
                    .collect();
                let assignments: Vec<String> = names
                    .iter()
                    .zip(&bound)
                    .map(|(name, source)| format!("{name} = ({source})"))
                    .collect();
                class_parts.push(format!(
                    "({}, {})",
                    assignments.join(", "),
                    inline_params(&body, &names)
                ));
            } else {
                class_parts.push(self.invoke(&params.join(", "), &body, &bound.join(", ")));
            }
        }

        class_parts.extend(dynamic_class_parts);
        Ok(Built {
            class_parts,
            is_optimizable,
            base_style,
            dynamic_vars,
            prop_var_spreads,
            stable_tests,
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

    fn is_stable_read(&self, expr: E) -> bool {
        let K::Ident(id) = expr.kind() else { return false };
        let Some(symbol) = self.visibility().symbol_of(id) else { return false };
        let inside = |scope: &Span| scope.start <= id.span.start && id.span.end <= scope.end;
        if let Some(scope) = self
            .initialized_const_returns
            .get(&symbol)
            .or_else(|| self.parameter_bodies.get(&symbol))
        {
            return inside(scope);
        }
        self.module_consts.get(&symbol).is_some_and(inside)
            && !self.hoisted_functions.iter().any(inside)
    }

    fn can_skip_test(&self, expr: E) -> bool {
        use crate::syntax::expr::BinOp;
        use oxc_syntax::operator::BinaryOperator::{StrictEquality, StrictInequality};

        match unwrap(expr).kind() {
            K::Str(_) | K::Num(_) | K::Bool(_) | K::Null => true,
            K::Ident(_) => self.is_stable_read(unwrap(expr)),
            K::Binary(left, BinOp::Logical(_) | BinOp::Binary(StrictEquality | StrictInequality), right) => {
                self.can_skip_test(left) && self.can_skip_test(right)
            }
            K::Unary(unary) if unary.operator.is_not() => {
                self.can_skip_test(E::new(&unary.argument))
            }
            _ => false,
        }
    }

    fn class_reads_stable(&self, expr: E<'b, 'a>) -> bool {
        let node = self.resolve_local_style_alias(unwrap(expr));
        if node.is_no_op_style() || self.is_style_function_call(node) {
            return true;
        }
        match node.kind() {
            K::Array(array) => array.elements.iter().all(|element| match element {
                ArrayExpressionElement::Elision(_) => true,
                ArrayExpressionElement::SpreadElement(_) => false,
                other => self.class_reads_stable(E::new(other.to_expression())),
            }),
            K::Conditional(cond) => {
                self.can_skip_test(E::new(&cond.test))
                    && self.class_reads_stable(E::new(&cond.consequent))
                    && self.class_reads_stable(E::new(&cond.alternate))
            }
            K::Binary(left, op, right) if op.is_and() => {
                self.can_skip_test(left) && self.class_reads_stable(right)
            }
            _ => matches!(self.resolve_style_object(node), Ok(Some(_))),
        }
    }

    fn collect_conditions(
        &mut self,
        builder: &mut Builder,
        node: E<'b, 'a>,
        tests: &[String],
        can_skip: bool,
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
                if !self.collect_conditions(builder, inner, tests, can_skip, arg_order)? {
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
            for var in vars.into_iter().filter(|_| self.element_reads.is_none()) {
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
                    can_skip_test: can_skip,
                    test: node.span(),
                    test_string: Some(tests.join(" && ")),
                    test_lhs: None,
                    truthy: style,
                    falsy: Object::new(),
                    group_id: None,
                    value_name: None,
                    order: builder.source_order,
                    closed: false,
                });
            }
            builder.source_order += 1;
            return Ok(true);
        }
        match node.kind() {
            K::Conditional(cond) => {
                let can_skip = can_skip && self.can_skip_test(E::new(&cond.test));
                let test_source = self.read_text(cond.test.span());
                if tests.is_empty() {
                    let true_style = self.resolve_style_object(E::new(&cond.consequent))?;
                    let false_style = self.resolve_style_object(E::new(&cond.alternate))?;
                    if let (Some(true_style), Some(false_style)) = (true_style, false_style) {
                        builder.conditionals.push(Conditional {
                            can_skip_test: can_skip,
                            test: node.span(),
                            test_string: Some(test_source),
                            test_lhs: None,
                            truthy: true_style,
                            falsy: false_style,
                            group_id: None,
                            value_name: None,
                            order: builder.source_order,
                            closed: false,
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
                    can_skip,
                    arg_order,
                )?;
                let mut alternate_tests = tests.to_vec();
                alternate_tests.push(format!("!({test_source})"));
                let alternate = self.collect_conditions(
                    builder,
                    E::new(&cond.alternate),
                    &alternate_tests,
                    can_skip,
                    arg_order,
                )?;
                return Ok(consequent && alternate);
            }
            K::Binary(left, op, right) if op.is_and() => {
                let mut next = tests.to_vec();
                next.push(format!("({})", self.read_text(left.span())));
                let can_skip = can_skip && self.can_skip_test(left);
                return self.collect_conditions(builder, right, &next, can_skip, arg_order);
            }
            K::Paren(paren) => {
                return self.collect_conditions(
                    builder,
                    E::new(&paren.expression),
                    tests,
                    can_skip,
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
                can_skip_test: false,
                test: expr.span(),
                test_string: Some(format!("{test_lhs} === {}", quote(&value_name))),
                test_lhs: Some(test_lhs.clone()),
                truthy: style,
                falsy: Object::new(),
                group_id: Some(group_id),
                value_name: Some(value_name),
                order: current_order,
                closed: false,
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
        if !receives_style_prop {
            return self.apply_style_attribute(node, E::new(expr), args);
        }
        let applied = std::mem::take(&mut self.applied_style_props);
        let result = self.apply_style_attribute(node, E::new(expr), args);
        let referenced = std::mem::replace(&mut self.applied_style_props, applied);
        result?;
        let received = referenced.iter().find_map(|key| {
            let (owner, prop_name) = key.split_once(':')?;
            let owner_key = format!("{}-{owner}", self.resource);
            let passed = self
                .tables
                .component_props
                .get(&owner_key)
                .is_some_and(|props| props.contains_key(prop_name));
            let declared = self
                .tables
                .style_receiver
                .get(&owner_key)
                .is_some_and(|props| props.iter().any(|prop| prop == prop_name));
            (passed || declared).then_some(prop_name)
        });
        if let Some(prop_name) = received {
            let target = comp_key
                .as_deref()
                .and_then(|key| key.rsplit_once('-'))
                .map_or("the component", |(_, name)| name);
            return Err(self.fail(
                format!(
                    "[plumeria] \"{prop_name}\" is a style received through a prop, so it cannot be passed on to <{target}>, which takes {style_prop} too. Pass the style to <{target} {style_prop}={{...}} /> where it is chosen, or apply it to an element this component renders."
                ),
                Some(node.span),
            ));
        }
        self.applied_style_props.extend(referenced);
        Ok(())
    }

    fn read_text(&self, span: oxc_span::Span) -> String {
        self.element_reads
            .as_ref()
            .and_then(|reads| reads.get(&(span.start, span.end)))
            .cloned()
            .unwrap_or_else(|| self.text(span))
    }

    fn plan_top_element(
        &mut self,
        expr: E<'b, 'a>,
        plan: &mut ElementPlan,
    ) -> TResult<Option<Vec<String>>> {
        let expr = self.resolve_local_style_alias(expr);
        if let (K::Member(_), Some(Prop::Computed(dyn_expr))) = (expr.kind(), expr.prop())
            && !matches!(dyn_expr.kind(), K::Str(_))
            && let Some(var_name) = expr.object().and_then(|object| object.ident_name())
            && self.visibility().expr(expr)
            && self.resolve_create_object(var_name).is_some()
        {
            let name = plan.slot("t");
            plan.reads
                .insert((dyn_expr.span().start, dyn_expr.span().end), name.clone());
            plan.class_runtime = true;
            let read = format!("({})", self.source_of(dyn_expr));
            return Ok(Some(vec![plan.item(&name, read)]));
        }
        if let Some(decision) = self.resolve_decision(expr)?
            && (decision.has_group || decision.leaves > 2)
        {
            let name = plan.slot("t");
            plan.reads
                .insert((expr.span().start, expr.span().end), name.clone());
            plan.class_runtime = true;
            let read = format!("({})", decision.key_expr);
            return Ok(Some(vec![plan.item(&name, read)]));
        }
        self.plan_element(expr, false, plan)
    }

    fn plan_element(
        &mut self,
        node: E<'b, 'a>,
        guarded: bool,
        plan: &mut ElementPlan,
    ) -> TResult<Option<Vec<String>>> {
        let node = self.resolve_local_style_alias(unwrap(node));
        if node.is_no_op_style() {
            return Ok(Some(Vec::new()));
        }
        if node.is_ident() {
            return Ok(None);
        }
        if let K::Array(array) = node.kind() {
            let mut items = Vec::new();
            for element in &array.elements {
                let inner = match element {
                    ArrayExpressionElement::Elision(_) => continue,
                    ArrayExpressionElement::SpreadElement(_) => return Ok(None),
                    other => E::new(other.to_expression()),
                };
                let Some(more) = self.plan_element(inner, guarded, plan)? else {
                    return Ok(None);
                };
                items.extend(more);
            }
            return Ok(Some(items));
        }
        if let K::Member(_) = node.kind()
            && let Some(object) = node.object().and_then(|object| object.ident_name())
            && self.component_param_names.contains(object)
        {
            return Ok(None);
        }
        if self.resolve_style_object(node)?.is_some() {
            return Ok(Some(Vec::new()));
        }
        if let Some((_, vars)) = self.resolve_dynamic_call(node, false)? {
            let Some((object, runtime, always)) = vars_object(&vars, plan.assign, &|p, b, a| self.invoke(p, b, a)) else {
                return Ok(Some(Vec::new()));
            };
            let name = plan.slot("v");
            if plan.assign && always {
                plan.objects.insert(name.clone(), object.clone());
            }
            plan.vars.push((name.clone(), always && !guarded));
            plan.style_runtime |= runtime || guarded;
            return Ok(Some(vec![plan.item(&name, object)]));
        }
        let (test, consequent, alternate) = match node.kind() {
            K::Conditional(cond) => (
                E::new(&cond.test),
                E::new(&cond.consequent),
                Some(E::new(&cond.alternate)),
            ),
            K::Binary(left, op, right) if op.is_and() => (left, right, None),
            _ => return Ok(None),
        };
        self.plan_guard(test, consequent, alternate, plan, |this, node, plan| {
            this.plan_element(node, true, plan)
        })
    }

    fn plan_receiver(
        &mut self,
        node: E<'b, 'a>,
        plan: &mut ElementPlan,
    ) -> TResult<Option<Vec<String>>> {
        let node = unwrap(node);
        if node.is_no_op_style() {
            return Ok(Some(Vec::new()));
        }
        match node.kind() {
            K::Array(array) => {
                let mut items = Vec::new();
                for element in &array.elements {
                    let inner = match element {
                        ArrayExpressionElement::Elision(_) => continue,
                        ArrayExpressionElement::SpreadElement(_) => return Ok(None),
                        other => E::new(other.to_expression()),
                    };
                    let Some(more) = self.plan_receiver(inner, plan)? else {
                        return Ok(None);
                    };
                    items.extend(more);
                }
                return Ok(Some(items));
            }
            K::Conditional(cond) => {
                if let Expression::BooleanLiteral(literal) = &cond.test {
                    let taken = if literal.value {
                        &cond.consequent
                    } else {
                        &cond.alternate
                    };
                    return self.plan_receiver(E::new(taken), plan);
                }
                return self.plan_guard(
                    E::new(&cond.test),
                    E::new(&cond.consequent),
                    Some(E::new(&cond.alternate)),
                    plan,
                    Self::plan_receiver,
                );
            }
            K::Binary(left, op, right) if op.is_and() => {
                if let K::Bool(value) = left.kind() {
                    return if value {
                        self.plan_receiver(right, plan)
                    } else {
                        Ok(Some(Vec::new()))
                    };
                }
                return self.plan_guard(left, right, None, plan, Self::plan_receiver);
            }
            _ => {}
        }
        if let (K::Member(_), Some(Prop::Computed(key))) = (node.kind(), node.prop()) {
            if matches!(unwrap(key).kind(), K::Str(_) | K::Num(_)) {
                return Ok(Some(Vec::new()));
            }
            let name = plan.slot("t");
            plan.reads
                .insert((key.span().start, key.span().end), name.clone());
            let read = format!("({})", self.source_of(key));
            return Ok(Some(vec![plan.item(&name, read)]));
        }
        if self.is_style_function_call(node) {
            let Some((_, vars)) = self.resolve_dynamic_call(node, true)? else {
                return Ok(None);
            };
            if vars.is_empty() {
                return Ok(Some(Vec::new()));
            }
            let name = plan.slot("v");
            plan.reads
                .insert((node.span().start, node.span().end), name.clone());
            plan.vars.push((name.clone(), true));
            if plan.assign {
                let (object, _, _) = vars_object(&vars, true, &|p, b, a| self.invoke(p, b, a)).unwrap_or_default();
                if let K::Call(call) = node.kind()
                    && call.arguments.iter().all(|argument| {
                        argument.as_expression().is_some_and(|expr| self.can_skip_test(E::new(expr)))
                    })
                    && object.starts_with("{ ")
                    && !object.contains(PREFIX)
                    && vars
                        .iter()
                        .filter(|var| !var.css_var.is_empty())
                        .all(|var| runs_no_code(&var.value_expr))
                {
                    plan.objects.insert(name.clone(), object.clone());
                }
                plan.folds.push(object.clone());
                return Ok(Some(vec![plan.item(&name, object)]));
            }
            let fold = fold_dynamic_vars(&vars, false, &|p, b, a| self.invoke(p, b, a)).join(", ");
            plan.folds.push(fold.clone());
            return Ok(Some(vec![format!("{{ {fold} }}")]));
        }
        Ok(Some(Vec::new()))
    }

    #[allow(clippy::type_complexity)]
    fn plan_guard(
        &mut self,
        test_expr: E<'b, 'a>,
        consequent: E<'b, 'a>,
        alternate: Option<E<'b, 'a>>,
        plan: &mut ElementPlan,
        recurse: fn(&mut Self, E<'b, 'a>, &mut ElementPlan) -> TResult<Option<Vec<String>>>,
    ) -> TResult<Option<Vec<String>>> {
        let test = test_expr.span();
        let name = (!plan.assign || !self.can_skip_test(test_expr)).then(|| {
            let name = plan.slot("t");
            plan.reads.insert((test.start, test.end), name.clone());
            name
        });
        plan.class_runtime = true;
        let start = plan.params.len();
        let Some(yes) = recurse(self, consequent, plan)? else {
            return Ok(None);
        };
        let middle = plan.params.len();
        let no = match alternate {
            Some(alternate) => match recurse(self, alternate, plan)? {
                Some(no) => no,
                None => return Ok(None),
            },
            None => Vec::new(),
        };
        let end = plan.params.len();
        if end == start {
            let Some(name) = &name else {
                return Ok(Some(Vec::new()));
            };
            let read = format!("({})", self.text(test));
            return Ok(Some(vec![plan.item(name, read)]));
        }
        if plan.assign {
            let reset = |params: &[String]| -> Vec<String> {
                params.iter().map(|param| format!("{param} = null")).collect()
            };
            let truthy: Vec<String> = yes
                .into_iter()
                .chain(reset(&plan.params[middle..end]))
                .collect();
            let falsy: Vec<String> = reset(&plan.params[start..middle])
                .into_iter()
                .chain(no)
                .collect();
            let group = |steps: Vec<String>| {
                if steps.is_empty() {
                    "null".to_string()
                } else {
                    steps.join(", ")
                }
            };
            let read = match &name {
                Some(name) => format!("({name} = ({}))", self.text(test)),
                None => format!("({})", self.text(test)),
            };
            if name.is_none()
                && middle == start + 1
                && end == middle + 1
                && let (Some(when_true), Some(when_false)) = (
                    plan.objects.get(&plan.params[start]),
                    plan.objects.get(&plan.params[middle]),
                )
                && truthy.len() == 2
                && falsy.len() == 2
                && truthy[0] == plan.item(&plan.params[start], when_true.clone())
                && falsy[1] == plan.item(&plan.params[middle], when_false.clone())
            {
                plan.direct = Some((test.start, format!("{read} ? {when_true} : {when_false}")));
            } else if name.is_none()
                && middle == start + 1
                && end == middle
                && let Some(when_true) = plan.objects.get(&plan.params[start])
                && truthy.len() == 1
                && truthy[0] == plan.item(&plan.params[start], when_true.clone())
            {
                plan.direct = Some((test.start, format!("{read} ? {when_true} : undefined")));
            }
            return Ok(Some(vec![format!(
                "({read} ? ({}) : ({}))",
                group(truthy),
                group(falsy)
            )]));
        }
        let nulls = |count: usize| std::iter::repeat_n("null".to_string(), count);
        let truthy: Vec<String> = std::iter::once("true".to_string())
            .chain(yes)
            .chain(nulls(end - middle))
            .collect();
        let falsy: Vec<String> = std::iter::once("false".to_string())
            .chain(nulls(middle - start))
            .chain(no)
            .collect();
        Ok(Some(vec![format!(
            "...(({}) ? [{}] : [{}])",
            self.text(test),
            truthy.join(", "),
            falsy.join(", ")
        )]))
    }

    fn apply_style_attribute(
        &mut self,
        node: &'b JSXAttribute<'a>,
        expr: E<'b, 'a>,
        args: Vec<(E<'b, 'a>, Option<i64>)>,
    ) -> TResult<()> {
        let class_prop = self.env.class_prop.clone();
        self.removable_attrs.insert((node.span.start, node.span.end));
        let site = self
            .site_stack
            .last()
            .copied()
            .flatten()
            .filter(|site| self.decl_sites.contains_key(site));
        let base = site.and_then(|site| self.temp_next.get(&site).copied()).unwrap_or(0);
        self.arg_base.set(site.map(|_| base));
        let mut plan = ElementPlan {
            assign: site.is_some(),
            base,
            ..ElementPlan::default()
        };
        let mut plans: Vec<(Vec<String>, Vec<String>)> = Vec::new();
        for (expr, _) in &args {
            let start = plan.params.len();
            match self.plan_top_element(*expr, &mut plan)? {
                Some(items) => plans.push((plan.params[start..].to_vec(), items)),
                None => {
                    plans.clear();
                    plan = ElementPlan::default();
                    break;
                }
            }
        }
        let planned = plans.len() == args.len();
        let wraps = plan.class_runtime && plan.style_runtime;
        if let Some(site) = site.filter(|_| planned && plan.assign && plan.style_runtime) {
            return self.assign_element(node, args, plan, plans, site);
        }
        self.arg_base.set(None);
        let mut plan = if plan.assign {
            ElementPlan::default()
        } else {
            plan
        };
        if planned && wraps {
            let mut entries: Vec<((u32, usize), String, String)> = Vec::new();
            for (index, (params, items)) in plans.iter().enumerate() {
                if params.is_empty() {
                    continue;
                }
                let (param, arg) =
                    if params.len() == 1 && items.len() == 1 && !items[0].starts_with("...") {
                        (params[0].clone(), items[0].clone())
                    } else {
                        (
                            format!("[{}]", params.join(", ")),
                            format!("[{}]", items.join(", ")),
                        )
                    };
                entries.push(((node.span.start, index + 1), param, arg));
            }

            self.element_reads = Some(std::mem::take(&mut plan.reads));
            let built = self.build_class_parts(args, Vec::new(), String::new(), true);
            self.element_reads = None;
            let built = built?;
            let class_value = join_class_parts(&built.class_parts, &built.generated(&plan.params));
            let style_value = generated_style(&plan.vars);
            let sides: Option<Vec<bool>> = entries
                .iter()
                .map(|(_, param, _)| {
                    let class = mentions(&class_value, param);
                    let style = mentions(&style_value, param);
                    (!param.starts_with('[') && class != style).then_some(class)
                })
                .collect();
            if let Some(sides) = sides
                && sides.windows(2).all(|pair| pair[0] || !pair[1])
            {
                let side = |want: bool, value: &str| {
                    let picked: Vec<&(_, String, String)> = entries
                        .iter()
                        .zip(&sides)
                        .filter(|(_, side)| **side == want)
                        .map(|(entry, _)| entry)
                        .collect();
                    if picked.is_empty() {
                        return value.to_string();
                    }
                    let params: Vec<&str> = picked.iter().map(|(_, p, _)| p.as_str()).collect();
                    let args: Vec<&str> = picked.iter().map(|(_, _, a)| a.as_str()).collect();
                    if let ([param], [arg]) = (params.as_slice(), args.as_slice())
                        && *param == value
                    {
                        return arg.to_string();
                    }
                    if let ([param], [arg]) = (params.as_slice(), args.as_slice())
                        && let Some(rest) = value.strip_prefix(&format!("({param} ? "))
                        && !rest.contains(param)
                    {
                        return format!("({arg} ? {rest}");
                    }
                    self.invoke(&params.join(", "), value, &args.join(", "))
                };
                let class_text = side(true, &class_value);
                let style_text = side(false, &style_value);
                let class_attr = if static_class(&class_text).is_some() && !class_text.contains('&')
                {
                    class_text
                } else {
                    format!("{{{class_text}}}")
                };
                let has_style = style_text != "undefined";
                let mut attributes =
                    vec![self.written_attribute(node, &class_prop, &class_attr, true, !has_style)];
                if has_style {
                    attributes.push(self.written_attribute(
                        node,
                        "style",
                        &format!("{{{style_text}}}"),
                        false,
                        true,
                    ));
                }
                let content = join_attributes(attributes);
                self.replacements.push(Replacement {
                    start: node.span.start,
                    end: node.span.end,
                    content,
                });
                return Ok(());
            }
            let params: Vec<&str> = entries.iter().map(|(_, param, _)| param.as_str()).collect();
            let values: Vec<&str> = entries.iter().map(|(_, _, arg)| arg.as_str()).collect();
            self.replacements.push(Replacement {
                start: node.span.start,
                end: node.span.end,
                content: format!(
                    "{{...{}}}",
                    self.invoke(
                        &params.join(", "),
                        &format!("({{ {}: {class_value}, style: {style_value} }})", quote(&class_prop)),
                        &values.join(", ")
                    )
                ),
            });
            return Ok(());
        }

        let arg_count = args.len();
        let base = site
            .and_then(|site| self.temp_next.get(&site).copied())
            .unwrap_or(0);
        self.arg_base.set(site.map(|_| base));
        let built = self.build_class_parts(args, Vec::new(), String::new(), true);
        let folded = built
            .as_ref()
            .ok()
            .map(|built| fold_dynamic_vars(&built.dynamic_vars, site.is_some(), &|p, b, a| self.invoke(p, b, a)));
        if let (Some(site), Some(end)) = (site, self.arg_base.get())
            && end > base
        {
            self.temp_next.insert(site, end);
            let declared = self.site_temps.entry(site).or_default();
            for index in base..end {
                declared.push(format!("{PREFIX}a{index}"));
            }
        }
        self.arg_base.set(None);
        let built = built?;
        if !built.is_optimizable {
            return Err(self.fail(
                format!(
                    "[plumeria] Dynamic or unresolvable style object \"{}\" is not supported.",
                    self.source_of(expr)
                ),
                Some(expr.span()),
            ));
        }
        let mut style_parts = folded.unwrap_or_default();
        style_parts.extend(built.prop_var_spreads.clone());
        let style_value = match style_parts.as_slice() {
            [] => None,
            [only] if built.prop_var_spreads.is_empty() && only.starts_with("...") => {
                Some(format!("{{{}}}", &only[3..]))
            }
            _ => Some(format!("{{{{ {} }}}}", style_parts.join(", "))),
        };

        let mut attributes = Vec::new();
        let has_class = arg_count > 0 || !built.base_style.is_empty();
        if has_class {
            let replacement = join_class_parts(&built.class_parts, &built.stable_tests);
            let value = if static_class(&replacement).is_some() && !replacement.contains('&') {
                replacement
            } else {
                format!("{{{replacement}}}")
            };
            let last = style_value.is_none();
            attributes.push(self.written_attribute(node, &class_prop, &value, true, last));
        }
        if let Some(value) = style_value {
            attributes.push(self.written_attribute(node, "style", &value, !has_class, true));
        }
        let content = join_attributes(attributes);
        self.replacements.push(Replacement {
            start: node.span.start,
            end: node.span.end,
            content,
        });
        Ok(())
    }

    fn written_attribute(
        &mut self,
        node: &JSXAttribute<'a>,
        name: &str,
        value: &str,
        first: bool,
        last: bool,
    ) -> String {
        let expr = value
            .strip_prefix('{')
            .and_then(|rest| rest.strip_suffix('}'))
            .unwrap_or(value);
        let Some(attributes) = self.jsx_owner.get(&node.span.start).map(|(_, attributes)| *attributes) else {
            return format!("{name}={value}");
        };
        let named = |item: &'b JSXAttributeItem<'a>| match item {
            JSXAttributeItem::Attribute(attr)
                if attr.span != node.span
                    && matches!(&attr.name, JSXAttributeName::Identifier(id) if id.name == name) =>
            {
                Some(&**attr)
            }
            _ => None,
        };
        let same: Vec<&JSXAttribute> = attributes.iter().filter_map(named).collect();
        if same.is_empty() {
            return format!("{name}={value}");
        }
        let at = attributes.iter().position(|item| item.span() == node.span);
        let previous = at.and_then(|at| at.checked_sub(1)).and_then(|at| attributes.get(at)).and_then(named);
        let next = at.and_then(|at| attributes.get(at + 1)).and_then(named);
        if last && next.is_some() && static_class(expr).is_some() {
            return String::new();
        }
        if first
            && let [only] = same.as_slice()
            && previous.is_some_and(|attr| attr.span == only.span)
            && self.pure_attribute(only)
        {
            self.removable_attrs.insert((only.span.start, only.span.end));
            self.replacements.push(Replacement {
                start: only.span.start,
                end: only.span.end,
                content: String::new(),
            });
            return format!("{name}={value}");
        }
        format!("{{...{{ {}: {expr} }}}}", quote(name))
    }

    fn pure_attribute(&self, attr: &JSXAttribute<'a>) -> bool {
        let Some(value) = &attr.value else { return true };
        let JSXAttributeValue::ExpressionContainer(container) = value else {
            return matches!(value, JSXAttributeValue::StringLiteral(_));
        };
        let Some(expr) = container.expression.as_expression() else {
            return true;
        };
        if let Expression::ObjectExpression(object) = expr {
            return object.properties.iter().all(|property| {
                matches!(property, ObjectPropertyKind::ObjectProperty(property)
                    if property.kind == PropertyKind::Init
                        && !property.computed
                        && !property.method
                        && !property.shorthand
                        && self.can_skip_test(E::new(&property.value)))
            });
        }
        self.can_skip_test(E::new(expr))
    }

    fn assign_element(
        &mut self,
        node: &'b JSXAttribute<'a>,
        args: Vec<(E<'b, 'a>, Option<i64>)>,
        mut plan: ElementPlan,
        plans: Vec<(Vec<String>, Vec<String>)>,
        site: u32,
    ) -> TResult<()> {
        let class_prop = self.env.class_prop.clone();
        let base = plan.base;
        let arg_end = self.arg_base.get().unwrap_or(base);
        self.arg_base.set(None);
        let mut temps: Vec<String> = plan.params.clone();
        temps.extend((base..arg_end).map(|index| format!("{PREFIX}a{index}")));
        let steps: Vec<String> = plans.into_iter().flat_map(|(_, items)| items).collect();
        let direct = match args.as_slice() {
            [(expr, _)] => match unwrap(*expr).kind() {
                K::Conditional(cond) => plan
                    .direct
                    .take()
                    .filter(|(at, _)| *at == cond.test.span().start)
                    .map(|(_, style)| style),
                K::Binary(left, op, _) if op.is_and() => plan
                    .direct
                    .take()
                    .filter(|(at, _)| *at == left.span().start)
                    .map(|(_, style)| style),
                _ => None,
            },
            _ => None,
        };
        let exprs: Vec<E<'b, 'a>> = args.iter().map(|(expr, _)| *expr).collect();

        self.element_reads = Some(std::mem::take(&mut plan.reads));
        let built = self.build_class_parts(args, Vec::new(), String::new(), true);
        self.element_reads = None;
        let built = built?;
        let class_value = join_class_parts(&built.class_parts, &built.generated(&plan.params));
        let vars: Vec<&str> = plan.vars.iter().map(|(name, _)| name.as_str()).collect();
        let style_value = (!vars.is_empty()).then(|| generated_style(&plan.vars));
        let sequence = |steps: &[String], value: &str| {
            if steps.is_empty() {
                value.to_string()
            } else {
                format!("({}, {value})", steps.join(", "))
            }
        };
        let class_static = static_class(&class_value).is_some();
        let class_reads_only = style_value.is_some()
            && !class_static
            && !plan.params.iter().any(|param| mentions(&class_value, param))
            && exprs.iter().all(|expr| self.class_reads_stable(*expr));
        let direct =
            direct.filter(|_| (class_static && !class_value.contains('&')) || class_reads_only);
        let (class_steps, style_steps) = if style_value.is_some() && (class_static || class_reads_only) {
            (Vec::new(), steps)
        } else {
            (steps, Vec::new())
        };
        let class_text = if class_steps.is_empty() && class_static && !class_value.contains('&') {
            class_value
        } else {
            format!("{{{}}}", sequence(&class_steps, &class_value))
        };
        let style_text = style_value.map(|style| {
            if let Some(direct) = &direct {
                temps.retain(|temp| !plan.params.contains(temp));
                return direct.clone();
            }
            let alone = match (style_steps.as_slice(), vars.as_slice()) {
                ([step], [only]) if style == *only => step
                    .strip_prefix(&format!("({only} = "))
                    .and_then(|rest| rest.strip_suffix(')'))
                    .map(|value| (only.to_string(), value.to_string())),
                _ => None,
            };
            match alone {
                Some((only, value)) => {
                    temps.retain(|temp| *temp != only);
                    value
                }
                None => sequence(&style_steps, &style),
            }
        });
        let last = style_text.is_none();
        let mut attributes = vec![self.written_attribute(node, &class_prop, &class_text, true, last)];
        if let Some(style) = style_text {
            attributes.push(self.written_attribute(node, "style", &format!("{{{style}}}"), false, true));
        }
        let content = join_attributes(attributes);
        self.replacements.push(Replacement {
            start: node.span.start,
            end: node.span.end,
            content,
        });
        self.temp_next.insert(site, arg_end.max(base + plan.params.len()).max(base + 1));
        if temps.is_empty() {
            return Ok(());
        }
        let declared = self.site_temps.entry(site).or_default();
        for temp in temps {
            if !declared.contains(&temp) {
                declared.push(temp);
            }
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

    fn replace_with_key(
        &mut self,
        sub: E<'b, 'a>,
        index: &FxHashMap<u32, Vec<TableEntry>>,
    ) -> TResult<bool> {
        let Some(entries) = index.get(&sub.start()) else {
            return Ok(false);
        };
        let site = self
            .site_stack
            .last()
            .copied()
            .flatten()
            .filter(|site| self.decl_sites.contains_key(site));
        let base = site
            .and_then(|site| self.temp_next.get(&site).copied())
            .unwrap_or(0);
        self.arg_base.set(site.map(|_| base));
        let mut plan = ElementPlan {
            assign: site.is_some(),
            base,
            ..ElementPlan::default()
        };
        let planned = self.plan_receiver(sub, &mut plan);
        let arg_end = self.arg_base.get().unwrap_or(base);
        self.arg_base.set(None);
        let Some(items) = planned? else {
            return Ok(false);
        };
        let mut rows: Vec<Row> = Vec::new();
        for entry in entries {
            if entry.has_vars
                && entry
                    .dynamic_calls
                    .as_ref()
                    .is_some_and(|calls| calls.iter().any(|call| !plan.reads.contains_key(call)))
            {
                return Ok(false);
            }
            rows.push(Row {
                conditions: entry.conditions.clone().unwrap_or_default(),
                key: entry.key.clone(),
                fixed: !entry.has_vars,
                calls: entry.dynamic_calls.clone(),
            });
        }
        let calls: Vec<String> = plan.vars.iter().map(|(name, _)| name.clone()).collect();
        let mut names = 0;
        let mut keys: Vec<String> = Vec::new();
        let inline: FxHashMap<String, String> = (site.is_some()
            && plan.assign
            && !items.is_empty()
            && items.len() == plan.params.len())
        .then(|| {
            plan.params
                .iter()
                .map(|param| {
                    let inner = plan.objects.get(param)?.strip_prefix("{ ")?.strip_suffix(" }")?;
                    Some((param.clone(), inner.to_string()))
                })
                .collect::<Option<FxHashMap<_, _>>>()
        })
        .flatten()
        .unwrap_or_default();
        let body = self
            .decide(&rows, &plan.reads, &calls, &inline, &mut names, &mut keys, plan.assign)
            .0;
        if let Some(site) = site
            && plan.assign
        {
            let content = if let [row] = rows.as_slice()
                && row.conditions.is_empty()
                && !row.fixed
                && items.len() == 1
                && let [fold] = plan.folds.as_slice()
            {
                format!("{{ key: {}, vars: {fold} }}", quote(&row.key))
            } else if items.is_empty() {
                body
            } else if !inline.is_empty() {
                body
            } else {
                format!("({}, {body})", items.join(", "))
            };
            let mut temps: Vec<String> = plan.params.clone();
            if content.starts_with("{ key: ") || plan.params.iter().all(|param| !mentions(&content, param)) {
                temps.clear();
            }
            temps.extend((base..arg_end).map(|index| format!("{PREFIX}a{index}")));
            temps.extend(keys);
            if !temps.is_empty() {
                self.temp_next
                    .insert(site, arg_end.max(base + plan.params.len()).max(base + 1));
                let declared = self.site_temps.entry(site).or_default();
                for temp in temps {
                    if !declared.contains(&temp) {
                        declared.push(temp);
                    }
                }
            }
            let span = sub.span();
            self.replacements.push(Replacement {
                start: span.start,
                end: span.end,
                content,
            });
            return Ok(true);
        }
        let content = if plan.params.is_empty() {
            body
        } else if let [row] = rows.as_slice()
            && row.conditions.is_empty()
        {
            let key = quote(&row.key);
            let folds = plan.folds.join(", ");
            if row.fixed {
                format!("({{ {folds} }}, {key})")
            } else {
                format!("{{ key: {key}, vars: {{ {folds} }} }}")
            }
        } else {
            format!(
                "(({}) => ({body}))({})",
                plan.params.join(", "),
                items.join(", ")
            )
        };
        let span = sub.span();
        self.replacements.push(Replacement {
            start: span.start,
            end: span.end,
            content,
        });
        Ok(true)
    }

    fn decide(
        &self,
        rows: &[Row],
        reads: &FxHashMap<(u32, u32), String>,
        calls: &[String],
        inline: &FxHashMap<String, String>,
        names: &mut usize,
        keys: &mut Vec<String>,
        assign: bool,
    ) -> (String, bool) {
        let Some(first) = rows.first() else {
            return ("\"\"".to_string(), true);
        };
        let Some(condition) = first.conditions.first() else {
            let key = quote(&first.key);
            if first.fixed {
                return (key, true);
            }
            let carry = |name: &String| {
                inline
                    .get(name)
                    .cloned()
                    .unwrap_or_else(|| format!("...{name}"))
            };
            let carried: Vec<String> = match &first.calls {
                Some(spans) => spans.iter().filter_map(|span| reads.get(span)).map(carry).collect(),
                None => calls.iter().map(carry).collect(),
            };
            return (
                format!("{{ key: {key}, vars: {{ {} }} }}", carried.join(", ")),
                false,
            );
        };
        let test = condition.test;
        let branch = |keep: &dyn Fn(&Condition) -> bool| -> Vec<Row> {
            rows.iter()
                .filter_map(|row| {
                    let Some(position) = row.conditions.iter().position(|c| c.test == test) else {
                        return Some(row.clone());
                    };
                    keep(&row.conditions[position]).then(|| {
                        let mut conditions = row.conditions.clone();
                        conditions.remove(position);
                        Row {
                            conditions,
                            ..row.clone()
                        }
                    })
                })
                .collect()
        };
        let text = reads
            .get(&test)
            .cloned()
            .unwrap_or_else(|| self.text(Span::new(test.0, test.1)).to_string());
        let Some(keyed) = &condition.keyed else {
            let (truthy, _) =
                self.decide(&branch(&|c| c.truthy), reads, calls, inline, names, keys, assign);
            let (falsy, _) =
                self.decide(&branch(&|c| !c.truthy), reads, calls, inline, names, keys, assign);
            return (format!("(({text}) ? {truthy} : {falsy})"), false);
        };
        let mut branches: Vec<(String, bool)> = Vec::new();
        for option in (0..keyed.options.len()).map(Some).chain([None]) {
            let rows = branch(&|c| c.keyed.as_ref().is_some_and(|k| k.option == option));
            branches.push(self.decide(&rows, reads, calls, inline, names, keys, assign));
        }
        let (fallback, _) = branches.pop().unwrap();
        if branches.iter().all(|(_, fixed)| *fixed) {
            let pairs: Vec<String> = keyed
                .options
                .iter()
                .zip(&branches)
                .map(|(option, (value, _))| format!("{}:{value}", quote(option)))
                .collect();
            return (
                format!(
                    "({{__proto__:null,{}}}[{text}] ?? {fallback})",
                    pairs.join(",")
                ),
                false,
            );
        }
        let name = self.fresh(names);
        let pairs: Vec<String> = keyed
            .options
            .iter()
            .enumerate()
            .map(|(index, option)| format!("{}:{index}", quote(option)))
            .collect();
        let mut body = fallback;
        for (index, (value, _)) in branches.iter().enumerate().rev() {
            body = format!("({name} === {index} ? {value} : {body})");
        }
        if assign {
            keys.push(name.clone());
            return (
                format!(
                    "({name} = {{__proto__:null,{}}}[{text}], {body})",
                    pairs.join(",")
                ),
                false,
            );
        }
        (
            format!(
                "(({name}) => {body})({{__proto__:null,{}}}[{text}])",
                pairs.join(",")
            ),
            false,
        )
    }

    fn read_once(&self, source: &str, body: impl Fn(&str) -> String) -> String {
        if is_identifier(source) {
            return format!("({})", body(source));
        }
        if let Some(base) = self.arg_base.get() {
            self.arg_base.set(Some(base + 1));
            let temp = format!("{PREFIX}a{base}");
            return format!("({temp} = ({source}), {})", body(&temp));
        }
        let value = format!("{PREFIX}a");
        self.invoke(&value, &body(&value), source)
    }

    fn fresh(&self, names: &mut usize) -> String {
        let mut name = format!("{PREFIX}k{}", *names);
        *names += 1;
        while self.source.contains(&name) {
            name.push('_');
        }
        name
    }
}

fn is_identifier(source: &str) -> bool {
    let mut chars = source.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

fn is_literal_source(source: &str) -> bool {
    let trimmed = source.trim();
    parse_js_number(trimmed).is_some_and(|n| !n.is_nan())
        || ['"', '\''].iter().any(|quote| {
            trimmed.len() >= 2
                && trimmed.starts_with(*quote)
                && trimmed.ends_with(*quote)
                && !trimmed[1..trimmed.len() - 1].contains(*quote)
        })
}

#[derive(Clone)]
struct Row {
    conditions: Vec<Condition>,
    key: String,
    fixed: bool,
    calls: Option<Vec<(u32, u32)>>,
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
