use rustc_hash::{FxHashMap, FxHashSet};

use crate::cascade::{rank, unrepresentable, Write};
use crate::css::{self, At, Decl, Node, Piece, Rule};

const MARKER_DOC: &str = "https://plumeria.dev/docs/api-reference/javascript/marker";

#[derive(Clone, Debug)]
pub struct Report {
    pub line: u32,
    pub column: u32,
    pub kind: &'static str,
    pub source: String,
    pub hint: String,
    pub blocking: bool,
}

#[derive(Clone, Debug)]
pub struct TagRule {
    pub key: String,
    pub tag: String,
    pub under: String,
    pub direct: bool,
    pub order: usize,
}

#[derive(Clone, Debug, Default)]
pub struct Converted {
    pub code: String,
    pub names: FxHashMap<String, String>,
    pub composes: FxHashMap<String, Vec<String>>,
    pub functions: FxHashMap<String, Vec<String>>,
    pub tags: Vec<TagRule>,
    pub writes: FxHashMap<String, Vec<Write>>,
    pub order: FxHashMap<String, usize>,
    pub reports: Vec<Report>,
}

impl Converted {
    pub fn blocked(&self) -> bool {
        self.reports.iter().any(|report| report.blocking)
    }
}

#[derive(Clone)]
enum Value {
    Text(String),
    Number(String),
    Raw(String),
}

#[derive(Default)]
struct StyleNode {
    decls: Vec<(String, Value)>,
    nested: Vec<(String, StyleNode)>,
    markers: Vec<String>,
}

impl StyleNode {
    fn nest(&mut self, key: &str) -> &mut StyleNode {
        let index = match self.nested.iter().position(|(k, _)| k == key) {
            Some(index) => index,
            None => {
                self.nested.push((key.to_string(), StyleNode::default()));
                self.nested.len() - 1
            }
        };
        &mut self.nested[index].1
    }

    fn set(&mut self, property: String, value: Value) {
        self.decls.retain(|(held, _)| *held != property);
        self.decls.push((property, value));
    }
}

fn camel(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut chars = name.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '-'
            && let Some(&next) = chars.peek()
            && (next.is_ascii_lowercase() || next.is_ascii_digit())
        {
            out.push(next.to_ascii_uppercase());
            chars.next();
            continue;
        }
        out.push(c);
    }
    out
}

pub fn to_key(class_name: &str) -> String {
    camel(class_name)
}

pub fn to_property(name: &str) -> String {
    if name.starts_with("--") {
        return name.to_string();
    }
    if let Some(vendor) = name.strip_prefix('-') {
        let camelised = camel(vendor);
        let mut chars = camelised.chars();
        return match chars.next() {
            Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
            None => camelised,
        };
    }
    camel(name)
}

fn kebab(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_uppercase() {
            out.push('-');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

pub fn is_identifier(text: &str) -> bool {
    let mut chars = text.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

fn unsigned_number(text: &str) -> bool {
    match text.split_once('.') {
        Some((whole, fraction)) => {
            whole.chars().all(|c| c.is_ascii_digit())
                && fraction.chars().all(|c| c.is_ascii_digit())
                && !(whole.is_empty() && fraction.is_empty())
        }
        None => !text.is_empty() && text.chars().all(|c| c.is_ascii_digit()),
    }
}

fn number(text: &str) -> bool {
    unsigned_number(text.strip_prefix('-').unwrap_or(text))
}

fn js_number(text: &str) -> String {
    let parsed: f64 = text.parse().unwrap_or(0.0);
    if parsed == 0.0 {
        return "0".to_string();
    }
    format!("{parsed}")
}

fn to_value(raw: &str) -> Value {
    let value = raw.trim();
    if let Some(length) = value.strip_suffix("px")
        && number(length)
    {
        return Value::Number(js_number(length));
    }
    if number(value) {
        return Value::Number(js_number(value));
    }
    Value::Text(value.to_string())
}

fn time(token: &str) -> bool {
    let lower = token.to_ascii_lowercase();
    lower
        .strip_suffix("ms")
        .or_else(|| lower.strip_suffix('s'))
        .is_some_and(number)
}

fn animation_part(token: &str) -> Option<&'static str> {
    let lower = token.to_ascii_lowercase();
    if ["cubic-bezier(", "steps(", "linear("].iter().any(|p| lower.starts_with(p))
        || ["linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"].contains(&lower.as_str())
    {
        return Some("animation-timing-function");
    }
    if lower == "infinite" || unsigned_number(&lower) {
        return Some("animation-iteration-count");
    }
    if ["normal", "reverse", "alternate", "alternate-reverse"].contains(&lower.as_str()) {
        return Some("animation-direction");
    }
    if ["none", "forwards", "backwards", "both"].contains(&lower.as_str()) {
        return Some("animation-fill-mode");
    }
    if ["running", "paused"].contains(&lower.as_str()) {
        return Some("animation-play-state");
    }
    None
}

fn words(value: &str) -> Option<Vec<String>> {
    let mut found = Vec::new();
    let mut depth = 0i32;
    let mut current = String::new();
    for c in value.chars() {
        if c == '(' {
            depth += 1;
        }
        if c == ')' {
            depth -= 1;
        }
        if c == ',' && depth == 0 {
            return None;
        }
        if c.is_whitespace() && depth == 0 {
            if !current.is_empty() {
                found.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(c);
    }
    if !current.is_empty() {
        found.push(current);
    }
    Some(found)
}

pub fn quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('\'');
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            '\n' => out.push_str("\\n"),
            _ => out.push(c),
        }
    }
    out.push('\'');
    out
}

fn serialise(node: &StyleNode, indent: &str, out: &mut String) {
    for marker in &node.markers {
        out.push_str(&format!("{indent}...{marker},\n"));
    }
    for (prop, value) in &node.decls {
        if let Value::Raw(raw) = value
            && raw == prop
        {
            out.push_str(&format!("{indent}{prop},\n"));
            continue;
        }
        let key = if is_identifier(prop) { prop.clone() } else { quote(prop) };
        let written = match value {
            Value::Number(n) => n.clone(),
            Value::Raw(raw) => raw.clone(),
            Value::Text(text) => quote(text),
        };
        out.push_str(&format!("{indent}{key}: {written},\n"));
    }
    for (key, child) in &node.nested {
        let written = if key.starts_with("css.extended(") {
            format!("[{key}]")
        } else if is_identifier(key) {
            key.clone()
        } else {
            quote(key)
        };
        out.push_str(&format!("{indent}{written}: {{\n"));
        serialise(child, &format!("{indent}  "), out);
        out.push_str(&format!("{indent}}},\n"));
    }
}

struct Ancestor {
    key: String,
    pseudo: String,
}

struct Target {
    key: String,
    pseudo: String,
    tag: Option<String>,
    direct: bool,
    ancestors: Vec<Ancestor>,
}

struct Refusal {
    kind: &'static str,
    hint: String,
}

#[derive(Default)]
struct Part {
    classes: Vec<String>,
    pseudos: Vec<String>,
    global: Option<String>,
    after: Option<char>,
    tag: Option<String>,
}

fn unsupported() -> Refusal {
    Refusal {
        kind: "unsupported-selector",
        hint: "Only a local class, or one local class under another, is converted.".to_string(),
    }
}

fn read_selector(selector: &str) -> Result<Target, Refusal> {
    let mut parts = vec![Part::default()];
    for piece in css::pieces(selector) {
        let part = parts.last_mut().unwrap();
        match piece {
            Piece::Class(name) => part.classes.push(name),
            Piece::Tag(name) => part.tag = Some(name),
            Piece::Pseudo(text) => part.pseudos.push(text),
            Piece::Attribute(text) => part.pseudos.push(format!(":is({text})")),
            Piece::Global(inner) => part.global = Some(inner),
            Piece::Boost => {}
            Piece::BareGlobal => {
                return Err(Refusal {
                    kind: "global",
                    hint: "A global class is written as a selector key: `':is(.name *)'`.".to_string(),
                });
            }
            Piece::Combinator(c) => parts.push(Part { after: Some(c), ..Part::default() }),
            Piece::Other => return Err(unsupported()),
        }
    }

    let last = |part: &Part| to_key(part.classes.last().unwrap());
    let ancestors = |above: &[Part]| {
        above
            .iter()
            .map(|part| Ancestor {
                key: last(part),
                pseudo: if part.pseudos.is_empty() { ":defined".to_string() } else { part.pseudos.concat() },
            })
            .collect::<Vec<_>>()
    };

    if parts.iter().any(|p| p.global.is_some() && p.classes.is_empty()) {
        let (globals, rest): (Vec<&Part>, Vec<&Part>) =
            parts.iter().partition(|p| p.global.is_some() && p.classes.is_empty());
        if rest.len() != 1 || rest[0].classes.is_empty() {
            return Err(unsupported());
        }
        let above: String = globals.iter().map(|p| format!("{} ", p.global.as_ref().unwrap())).collect();
        return Ok(Target {
            key: last(rest[0]),
            pseudo: format!(":is({above}*){}", rest[0].pseudos.concat()),
            tag: None,
            direct: false,
            ancestors: Vec::new(),
        });
    }

    if parts.iter().any(|p| matches!(p.after, Some('+' | '~'))) {
        return Err(Refusal {
            kind: "sibling-combinator",
            hint: format!(
                "A container query reaches descendants, never siblings, so no marker states this. Whether an ordinal such as `:not(:first-child)` is equivalent depends on the markup — write the relation as a selector key: {MARKER_DOC}"
            ),
        });
    }

    if parts.iter().any(|p| p.global.is_some()) {
        return Err(unsupported());
    }

    let (tagged, above) = parts.split_last().unwrap();
    if !above.is_empty()
        && tagged.classes.is_empty()
        && above.iter().all(|p| !p.classes.is_empty() && p.tag.is_none())
        && let Some(tag) = &tagged.tag
    {
        let direct = tagged.after == Some('>');
        let relation = if direct { "child-" } else { "" };
        return Ok(Target {
            key: to_key(&format!("{}-{relation}{tag}", above.last().unwrap().classes.last().unwrap())),
            pseudo: tagged.pseudos.concat(),
            tag: Some(tag.clone()),
            direct,
            ancestors: ancestors(above),
        });
    }

    if parts.iter().any(|p| p.classes.is_empty() || p.tag.is_some()) {
        return Err(unsupported());
    }

    Ok(Target {
        key: last(tagged),
        pseudo: tagged.pseudos.concat(),
        tag: None,
        direct: false,
        ancestors: ancestors(above),
    })
}

fn is_keyframes(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "keyframes"
        || lower
            .strip_prefix('-')
            .and_then(|rest| rest.split_once('-'))
            .is_some_and(|(vendor, rest)| !vendor.is_empty() && vendor.chars().all(|c| c.is_ascii_lowercase()) && rest == "keyframes")
}

const CONDITIONAL_GROUPS: &[&str] = &["media", "supports", "container", "layer", "starting-style", "scope"];

struct Converter {
    keys: Vec<(String, StyleNode)>,
    key_index: FxHashMap<String, usize>,
    candidates: Vec<(String, String)>,
    out: Converted,
    marker_pseudos: FxHashMap<String, FxHashSet<String>>,
    animations: Vec<(String, String)>,
    animation_nodes: Vec<(String, StyleNode)>,
    reached: FxHashSet<String>,
    wrote: usize,
    seen: usize,
    written: Vec<(String, usize, FxHashSet<String>)>,
}

impl Converter {
    fn key_node(&mut self, key: &str) -> &mut StyleNode {
        let index = match self.key_index.get(key) {
            Some(&index) => index,
            None => {
                self.keys.push((key.to_string(), StyleNode::default()));
                self.key_index.insert(key.to_string(), self.keys.len() - 1);
                self.keys.len() - 1
            }
        };
        &mut self.keys[index].1
    }

    fn report(&mut self, line: u32, column: u32, kind: &'static str, source: String, hint: String) {
        self.out.reports.push(Report { line, column, kind, source, hint, blocking: true });
    }

    fn animation_binding(&self, name: &str) -> Option<String> {
        self.animations.iter().find(|(n, _)| n == name).map(|(_, b)| b.clone())
    }

    fn keyframes(&mut self, at: &At) {
        let name = at.params.trim().to_string();
        let binding = to_key(&name);
        let taken = binding == "css" || binding == "styles" || self.animations.iter().any(|(_, b)| *b == binding);
        if !is_identifier(&binding) || taken {
            self.report(
                at.line,
                at.column,
                "unsupported-keyframes",
                format!("@{} {}", at.name, at.params),
                format!("`{name}` cannot be written as a `css.keyframes` binding. Rename it, then run again."),
            );
            return;
        }
        let mut node = StyleNode::default();
        for child in at.block.iter().flatten() {
            let Node::Rule(rule) = child else { continue };
            let step = node.nest(&css::split_list(&rule.prelude).join(", "));
            for declaration in &rule.children {
                if let Node::Decl(decl) = declaration {
                    step.decls.push((to_property(&decl.prop), to_value(&decl.value)));
                }
            }
        }
        self.animations.push((name, binding.clone()));
        self.animation_nodes.push((binding, node));
    }

    fn animation_declarations(&mut self, decl: &Decl) -> Option<Vec<(String, Value)>> {
        if self.animations.is_empty() {
            return None;
        }
        let value = decl.value.trim();
        if decl.prop == "animation-name" {
            let binding = self.animation_binding(value)?;
            self.reached.insert(binding.clone());
            return Some(vec![("animation-name".to_string(), Value::Raw(binding))]);
        }
        if decl.prop != "animation" {
            return None;
        }
        let tokens = words(value);
        let named = tokens
            .as_ref()
            .map(|tokens| tokens.iter().filter(|t| self.animation_binding(t).is_some()).count())
            .unwrap_or(0);
        let Some(tokens) = tokens.filter(|_| named > 0) else {
            let reads = words(&value.replace(',', " "))
                .unwrap_or_default()
                .iter()
                .any(|t| self.animation_binding(t).is_some());
            if reads {
                self.report(
                    decl.line,
                    decl.column,
                    "unsupported-animation",
                    format!("{}: {}", decl.prop, decl.value),
                    "Only a single `animation` naming one local `@keyframes` is split into longhands. Write the longhands instead.".to_string(),
                );
            }
            return None;
        };
        let mut written: Vec<(String, Value)> = Vec::new();
        let has = |written: &Vec<(String, Value)>, p: &str| written.iter().any(|(k, _)| k == p);
        for token in &tokens {
            if let Some(binding) = self.animation_binding(token) {
                if has(&written, "animation-name") {
                    return None;
                }
                written.push(("animation-name".to_string(), Value::Raw(binding)));
                continue;
            }
            if time(token) {
                let property = if has(&written, "animation-duration") { "animation-delay" } else { "animation-duration" };
                if has(&written, property) {
                    return None;
                }
                written.push((property.to_string(), Value::Text(token.clone())));
                continue;
            }
            match animation_part(token) {
                Some(property) if !has(&written, property) => {
                    written.push((property.to_string(), Value::Text(token.clone())));
                }
                _ => {
                    self.report(
                        decl.line,
                        decl.column,
                        "unsupported-animation",
                        format!("{}: {}", decl.prop, decl.value),
                        format!("`{token}` was not recognised as an `animation` component, so the shorthand was left as it was written."),
                    );
                    return None;
                }
            }
        }
        if let Some((_, Value::Raw(binding))) = written.iter().find(|(k, _)| k == "animation-name") {
            self.reached.insert(binding.clone());
        }
        Some(written)
    }

    fn walk(&mut self, nodes: &[Node], at_keys: &mut Vec<String>) {
        for node in nodes {
            match node {
                Node::Rule(rule) => self.rule(rule, at_keys),
                Node::At(at) if is_keyframes(&at.name) => {}
                Node::At(at) => {
                    let name = at.name.to_ascii_lowercase();
                    match &at.block {
                        Some(block) if CONDITIONAL_GROUPS.contains(&name.as_str()) => {
                            at_keys.push(format!("@{} {}", at.name, at.params).trim().to_string());
                            self.walk(block, at_keys);
                            at_keys.pop();
                        }
                        _ => self.report(
                            at.line,
                            at.column,
                            "unsupported-at-rule",
                            format!("@{} {}", at.name, at.params).trim().to_string(),
                            "This at-rule belongs in a global stylesheet; move it there, then run again.".to_string(),
                        ),
                    }
                }
                Node::Decl(decl) => self.report(
                    decl.line,
                    decl.column,
                    "unsupported-declaration",
                    format!("{}: {}", decl.prop, decl.value),
                    "A declaration outside a class rule has no key to land on.".to_string(),
                ),
            }
        }
    }

    fn rule(&mut self, rule: &Rule, at_keys: &[String]) {
        if let Some(nested) = rule.children.iter().find_map(|child| match child {
            Node::Rule(nested) => Some(nested),
            _ => None,
        }) {
            self.report(
                nested.line,
                nested.column,
                "nested-rule",
                format!("{} {{ {} }}", rule.prelude, nested.prelude),
                "A nested rule is not converted. Write it out as its own selector, then run again.".to_string(),
            );
            return;
        }
        if let Some(Node::At(at)) = rule.children.iter().find(|child| matches!(child, Node::At(_))) {
            self.report(
                at.line,
                at.column,
                "nested-rule",
                format!("{} {{ @{} {} }}", rule.prelude, at.name, at.params),
                "An at-rule nested in a rule is not converted. Write it around the rule instead, then run again.".to_string(),
            );
            return;
        }

        for selector in css::split_list(&rule.prelude) {
            let target = match read_selector(&selector) {
                Ok(target) => target,
                Err(refusal) => {
                    self.report(rule.line, rule.column, refusal.kind, rule.prelude.clone(), refusal.hint);
                    continue;
                }
            };

            for bare in css::classes_in(&selector) {
                let key = to_key(&bare);
                if let Some((other, _)) = self.candidates.iter().find(|(other, k)| *k == key && *other != bare).cloned() {
                    self.report(
                        rule.line,
                        rule.column,
                        "key-collision",
                        rule.prelude.clone(),
                        format!("`{bare}` and `{other}` both become `{key}`."),
                    );
                }
                if !self.candidates.iter().any(|(other, _)| *other == bare) {
                    self.candidates.push((bare, key));
                }
            }

            if let (Some(tag), Some(under)) = (&target.tag, target.ancestors.last()) {
                if !self.out.tags.iter().any(|t| t.key == target.key && t.tag == *tag && t.direct == target.direct) {
                    let order = self.out.tags.len();
                    self.out.tags.push(TagRule {
                        key: target.key.clone(),
                        tag: tag.clone(),
                        under: under.key.clone(),
                        direct: target.direct,
                        order,
                    });
                }
            }

            let mut gate: Option<String> = None;
            for Ancestor { key: id, pseudo } in &target.ancestors {
                let signature = format!("{}>{pseudo}", gate.as_deref().unwrap_or(""));
                let fresh = self.marker_pseudos.entry(id.clone()).or_default().insert(signature);
                if fresh {
                    let marker = format!("css.marker({}, {})", quote(id), quote(pseudo));
                    let holder = self.key_node(id);
                    let holder = match &gate {
                        Some(gate) => holder.nest(gate),
                        None => holder,
                    };
                    holder.markers.push(marker);
                }
                gate = Some(format!("css.extended({}, {})", quote(id), quote(pseudo)));
            }

            let place = self.seen;
            self.seen += 1;
            self.out.order.insert(target.key.clone(), place);
            let mut props = FxHashSet::default();
            let where_ = format!("{}::{}", at_keys.join("|"), target.pseudo);
            let conditional = !at_keys.is_empty();

            let mut declarations: Vec<(String, Value)> = Vec::new();
            for child in &rule.children {
                let Node::Decl(decl) = child else { continue };
                if decl.prop == "composes" {
                    let (names, from) = match decl.value.split_once(" from ") {
                        Some((names, from)) => (names, Some(from)),
                        None => (decl.value.as_str(), None),
                    };
                    if from.is_some() {
                        self.report(
                            decl.line,
                            decl.column,
                            "composes-external",
                            format!("composes: {}", decl.value),
                            "A class composed from another file is not resolved. Convert that stylesheet too, then pass both at the call site as an array.".to_string(),
                        );
                        continue;
                    }
                    self.out
                        .composes
                        .entry(target.key.clone())
                        .or_default()
                        .extend(names.split_whitespace().map(to_key));
                    continue;
                }
                let expanded = self
                    .animation_declarations(decl)
                    .unwrap_or_else(|| vec![(decl.prop.clone(), to_value(&decl.value))]);
                for (name, value) in expanded {
                    let property = to_property(&name);
                    props.insert(format!("{where_}::{property}"));
                    let place = self.wrote;
                    self.wrote += 1;
                    self.out.writes.entry(target.key.clone()).or_default().push(Write {
                        rank: rank(&name, conditional),
                        property: name,
                        suffix: target.pseudo.clone(),
                        place,
                    });
                    declarations.push((property, value));
                }
            }
            self.written.push((target.key.clone(), place, props));

            let mut node = self.key_node(&target.key);
            if let Some(gate) = &gate {
                node = node.nest(gate);
            }
            for key in at_keys {
                node = node.nest(key);
            }
            if !target.pseudo.is_empty() {
                node = node.nest(&target.pseudo);
            }
            for (property, value) in declarations {
                node.set(property, value);
            }
        }
    }
}

fn parameterise(node: &mut StyleNode, key: &str, declared: &FxHashSet<String>, params: &mut Vec<String>) {
    let owned = format!("-{}-", kebab(key));
    for (_, value) in node.decls.iter_mut() {
        let Value::Text(text) = value else { continue };
        let Some(variable) = text.trim().strip_prefix("var(").and_then(|v| v.strip_suffix(')')) else { continue };
        let variable = variable.trim();
        let valid = variable.starts_with("--")
            && variable[2..].chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        if !valid || declared.contains(variable) {
            continue;
        }
        let head = variable[2..].split('-').next().unwrap_or("");
        let hashed = head.len() == 8
            && head.starts_with('x')
            && head[1..].chars().all(|c| c.is_ascii_digit() || c.is_ascii_lowercase());
        if hashed {
            continue;
        }
        let Some(at) = variable.rfind(&owned).filter(|&at| at > 2) else { continue };
        let parameter = &variable[at + owned.len()..];
        if parameter.is_empty() || !parameter.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
            continue;
        }
        let variable = variable.to_string();
        if !params.contains(&variable) {
            params.push(variable);
        }
        *value = Value::Raw(to_key(parameter));
    }
    for (_, child) in node.nested.iter_mut() {
        parameterise(child, key, declared, params);
    }
}

fn parameter_of(variable: &str, key: &str) -> String {
    let owned = format!("-{}-", kebab(key));
    let at = variable.rfind(&owned).unwrap();
    to_key(&variable[at + owned.len()..])
}

fn collect_custom(nodes: &[Node], declared: &mut FxHashSet<String>) {
    for node in nodes {
        match node {
            Node::Decl(decl) if decl.prop.starts_with("--") => {
                declared.insert(decl.prop.clone());
            }
            Node::Rule(rule) => collect_custom(&rule.children, declared),
            Node::At(At { block: Some(block), .. }) => collect_custom(block, declared),
            _ => {}
        }
    }
}

pub fn convert(text: &str) -> Converted {
    let (nodes, broken) = css::parse(text);
    let mut converter = Converter {
        keys: Vec::new(),
        key_index: FxHashMap::default(),
        candidates: Vec::new(),
        out: Converted::default(),
        marker_pseudos: FxHashMap::default(),
        animations: Vec::new(),
        animation_nodes: Vec::new(),
        reached: FxHashSet::default(),
        wrote: 0,
        seen: 0,
        written: Vec::new(),
    };
    for piece in broken {
        converter.report(piece.line, piece.column, "parse-error", piece.source, "This part of the stylesheet could not be read.".to_string());
    }

    fn find_keyframes<'a>(nodes: &'a [Node], found: &mut Vec<&'a At>) {
        for node in nodes {
            if let Node::At(at) = node {
                if is_keyframes(&at.name) {
                    found.push(at);
                } else if let Some(block) = &at.block {
                    find_keyframes(block, found);
                }
            }
        }
    }
    let mut keyframes = Vec::new();
    find_keyframes(&nodes, &mut keyframes);
    for at in keyframes {
        converter.keyframes(at);
    }

    converter.walk(&nodes, &mut Vec::new());

    let mut declared = FxHashSet::default();
    collect_custom(&nodes, &mut declared);
    for (key, node) in converter.keys.iter_mut() {
        let mut params = Vec::new();
        parameterise(node, key, &declared, &mut params);
        if !params.is_empty() {
            converter.out.functions.insert(key.clone(), params);
        }
    }

    let mut body = String::new();
    for (key, node) in &converter.keys {
        let mut inner = String::new();
        serialise(node, "    ", &mut inner);
        match converter.out.functions.get(key) {
            None => body.push_str(&format!("  {key}: {{\n{inner}  }},\n")),
            Some(variables) => {
                let params = variables
                    .iter()
                    .map(|v| format!("{}: string | number", parameter_of(v, key)))
                    .collect::<Vec<_>>()
                    .join(", ");
                body.push_str(&format!("  {key}: ({params}) => ({{\n{inner}  }}),\n"));
            }
        }
    }

    let mut bindings = String::new();
    for (binding, node) in &converter.animation_nodes {
        if !converter.reached.contains(binding) {
            continue;
        }
        let mut inner = String::new();
        serialise(node, "  ", &mut inner);
        bindings.push_str(&format!("const {binding} = css.keyframes({{\n{inner}}});\n\n"));
    }
    for (name, binding) in converter.animations.clone() {
        if converter.reached.contains(&binding) {
            continue;
        }
        converter.out.reports.push(Report {
            line: 0,
            column: 0,
            kind: "unused-keyframes",
            source: format!("@keyframes {name}"),
            hint: format!("Nothing in the stylesheet reads `{name}`, so it was not written."),
            blocking: false,
        });
    }

    converter.out.code =
        format!("import * as css from '@plumeria/core';\n\n{bindings}export const styles = css.create({{\n{body}}});\n");

    let writes = converter.out.writes.clone();
    for (key, declarations) in &writes {
        if let Some((earlier, later)) = unrepresentable(declarations, declarations) {
            let lead = if earlier.property == later.property {
                format!("`{key}` sets `{}` after setting it where Plumeria ranks it higher — an at-rule is one step up.", later.property)
            } else {
                format!("`{key}` sets `{}` after `{}`, which Plumeria ranks above it.", later.property, earlier.property)
            };
            converter.report(
                0,
                0,
                "rank-order",
                String::new(),
                format!("{lead} CSS gives the property to the later declaration and Plumeria cannot, and one key has no order to settle that with. Write the higher-ranked declaration last."),
            );
        }
    }

    let written = std::mem::take(&mut converter.written);
    for (key, place, _) in &written {
        let earlier: Vec<_> = written.iter().filter(|(k, p, _)| k == key && p < place).collect();
        if earlier.is_empty() {
            continue;
        }
        for (between_key, between_place, between_props) in &written {
            if between_key == key || between_place > place {
                continue;
            }
            let above: FxHashSet<&String> = earlier
                .iter()
                .filter(|(_, p, _)| p < between_place)
                .flat_map(|(_, _, props)| props.iter())
                .collect();
            if between_props.iter().any(|prop| above.contains(prop)) {
                converter.report(
                    0,
                    0,
                    "split-order",
                    String::new(),
                    format!("`{key}` is written on both sides of `{between_key}` and they share a property, so one place in the array cannot say which wins. Write the class once."),
                );
            }
        }
    }

    let tags = converter.out.tags.clone();
    for pair in &tags {
        if let Some((bare, _)) = converter.candidates.iter().find(|(_, key)| *key == pair.key).cloned() {
            converter.report(
                0,
                0,
                "key-collision",
                String::new(),
                format!("`{bare}` and the rule reaching `{}` both become `{}`.", pair.tag, pair.key),
            );
        }
    }

    for (bare, key) in &converter.candidates {
        if converter.key_index.contains_key(key) {
            converter.out.names.insert(bare.clone(), key.clone());
        }
    }

    converter.out
}
