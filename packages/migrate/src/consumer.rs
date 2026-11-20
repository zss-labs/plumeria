use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::cascade::unrepresentable;
use crate::resolve::{basename, dirname, relative, resolve, Paths};
use crate::stylesheet::Converted;

const CORE: &str = "@plumeria/core";

pub struct Sheet {
    pub path: String,
    pub target: String,
    pub converted: Converted,
}

pub struct Hold {
    pub sheet: usize,
    pub kind: &'static str,
    pub name: String,
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub blocking: bool,
}

#[derive(Default)]
pub struct Outcome {
    pub edits: Vec<(u32, u32, String)>,
    pub holds: Vec<Hold>,
    pub failed: Option<String>,
}

#[derive(Clone)]
struct Read {
    span: Span,
    sheet: usize,
    local: String,
    key: String,
}

enum Item {
    Read { guard: Option<Span>, read: Read },
    Cond { span: Span, reads: Vec<Read> },
    Other,
    Unknown { span: Span },
    Word(String),
}

struct StyleAttr {
    span: Span,
    items: Vec<Item>,
}

struct StyleObject {
    attr: Span,
    expression: Span,
    properties: Vec<(Option<String>, Span, Span)>,
}

struct Element {
    tag: Option<String>,
    name_end: u32,
    parent: Option<usize>,
    own: Option<StyleAttr>,
    style_prop: Option<(Span, bool)>,
    style: Option<StyleObject>,
}

struct Binding {
    sheet: usize,
    local: String,
}

struct Scan<'s> {
    text: &'s str,
    file: &'s str,
    scoping: &'s Scoping,
    sheets: &'s [Sheet],
    paths: Option<&'s Paths>,
    exists: &'s dyn Fn(&str) -> bool,
    style_prop: &'s str,
    bindings: FxHashMap<SymbolId, Binding>,
    claimed: FxHashMap<u32, Option<String>>,
    edits: Vec<(Span, String)>,
    elements: Vec<Element>,
    stack: Vec<Option<usize>>,
    in_use: usize,
    uses_css: bool,
    css_local: Option<String>,
    holds: Vec<Hold>,
}

fn property_name<'a>(member: &'a StaticMemberExpression<'a>) -> &'a str {
    member.property.name.as_str()
}

fn computed_name<'a>(member: &'a ComputedMemberExpression<'a>) -> Option<String> {
    match member.expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.as_str().unwrap_or_default().to_string()),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first().and_then(|q| q.value.cooked.as_ref()).and_then(|c| c.as_str()).map(str::to_string)
        }
        _ => None,
    }
}

fn is_nullish_literal(expression: &Expression) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => true,
        Expression::BooleanLiteral(literal) => !literal.value,
        Expression::StringLiteral(literal) => literal.value.as_str().unwrap_or_default().is_empty(),
        Expression::Identifier(identifier) => identifier.name.as_str() == "undefined",
        _ => false,
    }
}

impl<'s> Scan<'s> {
    fn line_column(&self, offset: u32) -> (u32, u32) {
        let before = &self.text[..offset as usize];
        let line = before.matches('\n').count() as u32 + 1;
        let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) as u32 + 1;
        (line, column)
    }

    fn hold(&mut self, sheet: usize, kind: &'static str, name: String, at: u32) {
        let (line, column) = self.line_column(at);
        self.holds.push(Hold { sheet, kind, name, file: self.file.to_string(), line, column, blocking: true });
    }

    fn note(&mut self, sheet: usize, kind: &'static str, name: String, at: u32) {
        let (line, column) = self.line_column(at);
        self.holds.push(Hold { sheet, kind, name, file: self.file.to_string(), line, column, blocking: false });
    }

    fn binding_of(&self, expression: &Expression) -> Option<SymbolId> {
        let Expression::Identifier(identifier) = expression.get_inner_expression() else { return None };
        let reference = identifier.reference_id.get()?;
        let symbol = self.scoping.get_reference(reference).symbol_id()?;
        self.bindings.contains_key(&symbol).then_some(symbol)
    }

    fn read_parts(&self, object: &Expression, name: Option<String>, span: Span) -> Option<Option<Read>> {
        let symbol = self.binding_of(object)?;
        let binding = &self.bindings[&symbol];
        let sheet = binding.sheet;
        Some(name.map(|name| Read {
            span,
            sheet,
            local: binding.local.clone(),
            key: self.sheets[sheet].converted.names.get(&name).cloned().unwrap_or(name),
        }))
    }

    fn read_of(&self, expression: &Expression) -> Option<Read> {
        match expression.get_inner_expression() {
            Expression::StaticMemberExpression(member) => {
                self.read_parts(&member.object, Some(property_name(member).to_string()), member.span)?
            }
            Expression::ComputedMemberExpression(member) => {
                self.read_parts(&member.object, computed_name(member), member.span)?
            }
            _ => None,
        }
    }

    fn item_of(&self, expression: &Expression) -> Item {
        let inner = expression.get_inner_expression();
        if let Some(read) = self.read_of(inner) {
            return Item::Read { guard: None, read };
        }
        if let Expression::LogicalExpression(logical) = inner
            && logical.operator == LogicalOperator::And
            && let Some(read) = self.read_of(&logical.right)
        {
            return Item::Read { guard: Some(logical.left.span()), read };
        }
        if let Expression::ConditionalExpression(conditional) = inner {
            let branches = [&conditional.consequent, &conditional.alternate];
            let reads: Vec<Option<Read>> = branches.iter().map(|b| self.read_of(b)).collect();
            let fits = branches.iter().zip(&reads).all(|(b, r)| r.is_some() || is_nullish_literal(b));
            if fits && reads.iter().any(Option::is_some) {
                return Item::Cond { span: inner.span(), reads: reads.into_iter().flatten().collect() };
            }
        }
        Item::Other
    }

    fn list_of(&self, expression: &Expression) -> Vec<Item> {
        let inner = expression.get_inner_expression();
        match inner {
            Expression::TemplateLiteral(template) if !template.expressions.is_empty() => {
                if let Some(items) = self.template_items(template) {
                    return items;
                }
            }
            Expression::CallExpression(call) => {
                if let Some(elements) = joined(call) {
                    return elements
                        .iter()
                        .map(|element| match element {
                            ArrayExpressionElement::SpreadElement(_) => Item::Other,
                            ArrayExpressionElement::Elision(_) => Item::Word(String::new()),
                            _ => self.item_of(element.to_expression()),
                        })
                        .filter(|item| !matches!(item, Item::Word(w) if w.is_empty()))
                        .collect();
                }
            }
            Expression::LogicalExpression(logical)
                if logical.operator == LogicalOperator::Or
                    && matches!(logical.right.get_inner_expression(), Expression::Identifier(id) if id.name.as_str() == "undefined") =>
            {
                return self.list_of(&logical.left);
            }
            _ => {}
        }
        vec![self.item_of(inner)]
    }

    fn template_items(&self, template: &TemplateLiteral) -> Option<Vec<Item>> {
        let count = template.quasis.len();
        let mut items = Vec::new();
        for (index, quasi) in template.quasis.iter().enumerate() {
            let text = quasi.value.cooked.as_ref()?.as_str()?;
            let glued_left = index > 0 && !text.is_empty() && !text.starts_with(char::is_whitespace);
            let glued_right = index + 1 < count && !text.is_empty() && !text.ends_with(char::is_whitespace);
            if glued_left || glued_right {
                return None;
            }
            items.extend(text.split_whitespace().map(|word| Item::Word(word.to_string())));
            if let Some(expression) = template.expressions.get(index) {
                items.push(self.item_of(expression));
            }
        }
        Some(items)
    }

    fn style_attr(&mut self, attribute: &JSXAttribute) -> Option<StyleAttr> {
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else { return None };
        let expression = container.expression.as_expression()?;
        let items = self.list_of(expression);
        if !items.iter().any(|item| matches!(item, Item::Read { .. } | Item::Cond { .. })) {
            return None;
        }
        Some(StyleAttr { span: attribute.span, items })
    }

    fn claim(&mut self, items: &[Item]) {
        for item in items {
            match item {
                Item::Read { read, .. } => {
                    self.claimed.insert(read.span.start, None);
                }
                Item::Cond { reads, .. } => {
                    for read in reads {
                        self.claimed.insert(read.span.start, Some(format!("{}.{}", read.local, read.key)));
                    }
                }
                _ => {}
            }
        }
    }

    fn style_object(&self, attribute: &JSXAttribute) -> Option<StyleObject> {
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else { return None };
        let Expression::ObjectExpression(object) = container.expression.as_expression()?.get_inner_expression() else {
            return None;
        };
        let properties = object
            .properties
            .iter()
            .map(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    let name = match &property.key {
                        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str().unwrap_or_default().to_string()),
                        key => key.as_expression().and_then(|e| match e.get_inner_expression() {
                            Expression::StringLiteral(literal) if property.computed => Some(literal.value.as_str().unwrap_or_default().to_string()),
                            _ => None,
                        }),
                    };
                    (name, property.span, unguarded(&property.value).span())
                }
                ObjectPropertyKind::SpreadProperty(spread) => (None, spread.span, spread.span),
            })
            .collect();
        Some(StyleObject { attr: attribute.span, expression: object.span, properties })
    }

    fn render(&mut self, span: Span) -> String {
        let mut inner: Vec<usize> = (0..self.edits.len())
            .filter(|&i| self.edits[i].0.start >= span.start && self.edits[i].0.end <= span.end)
            .collect();
        inner.sort_by_key(|&i| self.edits[i].0.start);
        let mut out = String::new();
        let mut at = span.start;
        let mut taken = Vec::new();
        for i in inner {
            let (edit, text) = &self.edits[i];
            if edit.start < at {
                continue;
            }
            out.push_str(&self.text[at as usize..edit.start as usize]);
            out.push_str(text);
            at = edit.end;
            taken.push(i);
        }
        out.push_str(&self.text[at as usize..span.end as usize]);
        taken.sort_unstable_by(|a, b| b.cmp(a));
        for i in taken {
            self.edits.remove(i);
        }
        out
    }

    fn value_read(&mut self, read: Read) {
        if let Some(claim) = self.claimed.get(&read.span.start).cloned() {
            if let Some(text) = claim {
                self.edits.push((read.span, text));
            }
            return;
        }
        let local = read.local.clone();
        let converted = &self.sheets[read.sheet].converted;
        if converted.functions.contains_key(&read.key) {
            self.hold(read.sheet, "function-style-value", read.key.clone(), read.span.start);
            return;
        }
        let keys = composed(converted, &read.key);
        if self.in_use > 0 {
            if keys.len() > 1 {
                self.hold(read.sheet, "composes-in-use", read.key.clone(), read.span.start);
                return;
            }
            self.edits.push((read.span, format!("{local}.{}", read.key)));
            return;
        }
        self.uses_css = true;
        let css = self.css_local.clone().unwrap_or_else(|| "css".to_string());
        let list = keys.iter().map(|k| format!("{local}.{k}")).collect::<Vec<_>>().join(", ");
        self.edits.push((read.span, format!("{css}.use({list})")));
    }

    fn check_read(&mut self, read: &Read) -> bool {
        let converted = &self.sheets[read.sheet].converted;
        if !converted.order.contains_key(&read.key) {
            self.hold(read.sheet, "missing", read.key.clone(), read.span.start);
            return false;
        }
        true
    }
}

fn without_query(specifier: &str) -> &str {
    specifier.split(['?', '#']).next().unwrap_or(specifier)
}

fn composed(converted: &Converted, key: &str) -> Vec<String> {
    let mut keys: Vec<String> = converted.composes.get(key).cloned().unwrap_or_default();
    keys.push(key.to_string());
    keys.sort_by_key(|k| converted.order.get(k).copied().unwrap_or(0));
    keys.dedup();
    keys
}

fn joined<'a, 'b>(call: &'b CallExpression<'a>) -> Option<&'b oxc_allocator::Vec<'a, ArrayExpressionElement<'a>>> {
    let Expression::StaticMemberExpression(callee) = &call.callee else { return None };
    if callee.property.name.as_str() != "join" || call.arguments.len() != 1 {
        return None;
    }
    let Some(Expression::StringLiteral(separator)) = call.arguments[0].as_expression() else { return None };
    if separator.value.as_str() != Some(" ") {
        return None;
    }
    match callee.object.get_inner_expression() {
        Expression::ArrayExpression(array) => Some(&array.elements),
        Expression::CallExpression(filter) => {
            let Expression::StaticMemberExpression(member) = &filter.callee else { return None };
            if member.property.name.as_str() != "filter" {
                return None;
            }
            match member.object.get_inner_expression() {
                Expression::ArrayExpression(array) => Some(&array.elements),
                _ => None,
            }
        }
        _ => None,
    }
}

fn unguarded<'a, 'b>(expression: &'b Expression<'a>) -> &'b Expression<'a> {
    let Expression::ConditionalExpression(conditional) = expression.get_inner_expression() else { return expression };
    let Expression::BinaryExpression(test) = conditional.test.get_inner_expression() else { return expression };
    let Expression::UnaryExpression(typeof_) = test.left.get_inner_expression() else { return expression };
    let Expression::StringLiteral(kind) = test.right.get_inner_expression() else { return expression };
    let Expression::TemplateLiteral(template) = conditional.consequent.get_inner_expression() else { return expression };
    let same = |a: &Expression, b: &Expression| match (a.get_inner_expression(), b.get_inner_expression()) {
        (Expression::Identifier(a), Expression::Identifier(b)) => a.name == b.name,
        _ => false,
    };
    if test.operator != BinaryOperator::StrictEquality
        || typeof_.operator != UnaryOperator::Typeof
        || kind.value.as_str() != Some("number")
        || template.expressions.len() != 1
        || template.quasis.last().map(|q| q.value.raw.as_str()) != Some("px")
        || !same(&typeof_.argument, &conditional.alternate)
        || !same(&template.expressions[0], &conditional.alternate)
    {
        return expression;
    }
    &conditional.alternate
}

fn attribute_name<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    match &attribute.name {
        JSXAttributeName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXAttributeName::NamespacedName(_) => None,
    }
}

impl<'a> Visit<'a> for Scan<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        let opening = &element.opening_element;
        let tag = match &opening.name {
            JSXElementName::Identifier(identifier) if identifier.name.starts_with(|c: char| c.is_ascii_lowercase()) => {
                Some(identifier.name.as_str().to_string())
            }
            _ => None,
        };
        let parent = self.stack.last().copied().flatten();
        let mut class_own = None;
        let mut prop_own = None;
        let mut present = None;
        let mut style_prop = None;
        let mut style = None;
        for item in &opening.attributes {
            let JSXAttributeItem::Attribute(attribute) = item else { continue };
            match attribute_name(attribute) {
                Some("className") => class_own = self.style_attr(attribute),
                Some(name) if name == self.style_prop => {
                    present = Some(attribute.span);
                    prop_own = self.style_attr(attribute);
                    if let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
                        && let Some(expression) = container.expression.as_expression()
                    {
                        let inner = expression.get_inner_expression();
                        style_prop = Some((inner.span(), matches!(inner, Expression::ArrayExpression(_))));
                    }
                }
                Some("style") => style = self.style_object(attribute),
                _ => {}
            }
        }
        let mut own = class_own.or(prop_own);
        if let Some(own) = &mut own {
            self.claim(&own.items);
            if let Some(span) = present {
                own.items.push(Item::Unknown { span });
            }
        }
        let index = self.elements.len();
        self.elements.push(Element { tag, name_end: opening.name.span().end, parent, own, style_prop, style });
        self.stack.push(Some(index));
        walk::walk_jsx_element(self, element);
        self.stack.pop();
    }

    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        self.stack.push(None);
        walk::walk_jsx_attribute(self, attribute);
        self.stack.pop();
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let css = self.css_local.clone();
        let is_use = matches!(&call.callee, Expression::StaticMemberExpression(member)
            if member.property.name.as_str() == "use"
                && matches!(member.object.get_inner_expression(), Expression::Identifier(id) if Some(id.name.as_str()) == css.as_deref()));
        if let Expression::Identifier(callee) = &call.callee
            && callee.name.as_str() == "require"
            && let Some(Argument::StringLiteral(literal)) = call.arguments.first()
        {
            self.foreign_specifier(literal.value.as_str().unwrap_or_default(), call.span.start, "require");
        }
        if is_use {
            self.visit_expression(&call.callee);
            self.in_use += 1;
            for argument in &call.arguments {
                self.visit_argument(argument);
            }
            self.in_use -= 1;
            return;
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_import_expression(&mut self, expression: &ImportExpression<'a>) {
        if let Expression::StringLiteral(literal) = &expression.source {
            self.foreign_specifier(literal.value.as_str().unwrap_or_default(), expression.span.start, "dynamic-import");
        }
        walk::walk_import_expression(self, expression);
    }

    fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
        match self.read_parts(&member.object, Some(property_name(member).to_string()), member.span) {
            Some(Some(read)) => {
                if self.check_read(&read) {
                    self.value_read(read);
                }
            }
            Some(None) => {}
            None => walk::walk_static_member_expression(self, member),
        }
    }

    fn visit_computed_member_expression(&mut self, member: &ComputedMemberExpression<'a>) {
        match self.read_parts(&member.object, computed_name(member), member.span) {
            Some(Some(read)) => {
                if self.check_read(&read) {
                    self.value_read(read);
                }
            }
            Some(None) => {
                let sheet = self.bindings[&self.binding_of(&member.object).unwrap()].sheet;
                let written = self.text[member.span.start as usize..member.span.end as usize].to_string();
                self.hold(sheet, "dynamic-access", written, member.span.start);
                self.visit_expression(&member.expression);
            }
            None => walk::walk_computed_member_expression(self, member),
        }
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(reference) = identifier.reference_id.get() else { return };
        let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else { return };
        if let Some(binding) = self.bindings.get(&symbol) {
            let sheet = binding.sheet;
            self.hold(sheet, "dynamic-access", identifier.name.as_str().to_string(), identifier.span.start);
        }
    }
}

impl Scan<'_> {
    fn sheet_for(&self, specifier: &str, paths: Option<&Paths>) -> Result<Option<usize>, ()> {
        let specifier = without_query(specifier);
        let resolved = resolve(specifier, self.file, paths, self.exists);
        match resolved {
            Some(path) => Ok(self.sheets.iter().position(|sheet| sheet.path == path)),
            None if specifier.ends_with(".module.css") => Err(()),
            None => Ok(None),
        }
    }

    fn foreign_specifier(&mut self, specifier: &str, at: u32, kind: &'static str) {
        let paths = self.paths;
        match self.sheet_for(specifier, paths) {
            Ok(Some(sheet)) => self.hold(sheet, kind, specifier.to_string(), at),
            Ok(None) => {}
            Err(()) => self.unresolved(specifier, at),
        }
    }

    fn unresolved(&mut self, specifier: &str, at: u32) {
        let name = basename(without_query(specifier)).to_string();
        for sheet in 0..self.sheets.len() {
            if basename(&self.sheets[sheet].path) == name {
                self.hold(sheet, "unresolved-import", specifier.to_string(), at);
            }
        }
    }

    fn reads_of(items: &[Item]) -> Vec<(usize, &Read)> {
        let mut out = Vec::new();
        for (slot, item) in items.iter().enumerate() {
            match item {
                Item::Read { read, .. } => out.push((slot, read)),
                Item::Cond { reads, .. } => out.extend(reads.iter().map(|read| (slot, read))),
                _ => {}
            }
        }
        out
    }

    fn settle(&mut self, items: &[Item]) {
        let mut reads: Vec<(usize, usize, String, u32)> = Vec::new();
        for (slot, read) in Self::reads_of(items) {
            for key in composed(&self.sheets[read.sheet].converted, &read.key) {
                reads.push((slot, read.sheet, key, read.span.start));
            }
        }
        let mut beyond = Vec::new();
        for (index, mine) in reads.iter().enumerate() {
            for theirs in &reads[index + 1..] {
                if mine.1 != theirs.1 || (mine.0 == theirs.0 && mine.2 != theirs.2 && Self::same_cond(items, mine.0)) {
                    continue;
                }
                let writes = &self.sheets[mine.1].converted.writes;
                let (Some(left), Some(right)) = (writes.get(&mine.2), writes.get(&theirs.2)) else { continue };
                if mine.2 != theirs.2 && unrepresentable(left, right).is_some() {
                    beyond.push(mine.clone());
                    beyond.push(theirs.clone());
                }
            }
        }
        for (_, sheet, key, at) in beyond {
            self.hold(sheet, "cascade", key, at);
        }
    }

    fn same_cond(items: &[Item], slot: usize) -> bool {
        matches!(items[slot], Item::Cond { .. })
    }

    fn children(&self) -> Vec<Vec<usize>> {
        let mut children = vec![Vec::new(); self.elements.len()];
        for (index, element) in self.elements.iter().enumerate() {
            if let Some(parent) = element.parent {
                children[parent].push(index);
            }
        }
        children
    }

    fn inherit(&mut self) -> Vec<Vec<(usize, String, usize, String)>> {
        let children = self.children();
        let mut inherited: Vec<Vec<(usize, String, usize, String)>> = vec![Vec::new(); self.elements.len()];
        let mut notes = Vec::new();
        let mut conditional = Vec::new();
        for (index, element) in self.elements.iter().enumerate() {
            let Some(own) = &element.own else { continue };
            for (slot, read) in Self::reads_of(&own.items) {
                for pair in &self.sheets[read.sheet].converted.tags {
                    if pair.under != read.key {
                        continue;
                    }
                    if !matches!(own.items[slot], Item::Read { guard: None, .. }) {
                        conditional.push((read.sheet, pair.key.clone(), read.span.start));
                        continue;
                    }
                    let mut found = false;
                    let mut queue: Vec<(usize, usize)> = children[index].iter().map(|&c| (c, 1)).collect();
                    while let Some((child, depth)) = queue.pop() {
                        if self.elements[child].tag.as_deref() == Some(pair.tag.as_str()) && (!pair.direct || depth == 1) {
                            found = true;
                            let held = &mut inherited[child];
                            if !held.iter().any(|(s, k, _, _)| *s == read.sheet && *k == pair.key) {
                                held.push((read.sheet, pair.key.clone(), pair.order, read.local.clone()));
                            }
                        }
                        queue.extend(children[child].iter().map(|&c| (c, depth + 1)));
                    }
                    if !found {
                        notes.push((read.sheet, pair.key.clone(), own.span.start));
                    }
                }
            }
        }
        for (sheet, key, at) in notes {
            self.note(sheet, "tag-out-of-view", key, at);
        }
        for (sheet, key, at) in conditional {
            self.hold(sheet, "conditional-tag", key, at);
        }
        for held in inherited.iter_mut() {
            held.sort_by_key(|(_, _, order, _)| *order);
        }
        inherited
    }

    fn call_text(&mut self, element: usize, read: &Read, consumed: &mut FxHashSet<usize>) -> Option<String> {
        let local = read.local.clone();
        let Some(variables) = self.sheets[read.sheet].converted.functions.get(&read.key).cloned() else {
            return Some(format!("{local}.{}", read.key));
        };
        let Some(style) = &self.elements[element].style else {
            self.hold(read.sheet, "function-arguments", read.key.clone(), read.span.start);
            return None;
        };
        let mut spans = Vec::new();
        for variable in &variables {
            match style.properties.iter().position(|(name, _, _)| name.as_deref() == Some(variable.as_str())) {
                Some(found) => {
                    consumed.insert(found);
                    spans.push(style.properties[found].2);
                }
                None => {
                    self.hold(read.sheet, "function-arguments", read.key.clone(), read.span.start);
                    return None;
                }
            }
        }
        let arguments = spans.into_iter().map(|span| self.render(span)).collect::<Vec<_>>().join(", ");
        Some(format!("{local}.{}({arguments})", read.key))
    }

    fn emit(&mut self, inherited: Vec<Vec<(usize, String, usize, String)>>) {
        let prop = self.style_prop.to_string();
        for index in (0..self.elements.len()).rev() {
            let own = self.elements[index].own.take();
            let tags: Vec<String> = inherited[index]
                .iter()
                .map(|(_, key, _, local)| format!("{local}.{key}"))
                .collect();
            let Some(own) = own else {
                if tags.is_empty() || self.elements[index].tag.is_none() {
                    continue;
                }
                match self.elements[index].style_prop {
                    Some((span, array)) => {
                        let rendered = self.render(span);
                        let text = if array {
                            let inner = rendered.strip_prefix('[').and_then(|r| r.strip_suffix(']')).unwrap_or(&rendered).trim();
                            if inner.is_empty() { format!("[{}]", tags.join(", ")) } else { format!("[{}, {inner}]", tags.join(", ")) }
                        } else {
                            format!("[{}, {rendered}]", tags.join(", "))
                        };
                        self.edits.push((span, text));
                    }
                    None => {
                        let at = self.elements[index].name_end;
                        let list = if tags.len() == 1 { tags[0].clone() } else { format!("[{}]", tags.join(", ")) };
                        self.edits.push((Span::new(at, at), format!(" {prop}={{{list}}}")));
                    }
                }
                continue;
            };

            self.settle(&own.items);
            let mut consumed = FxHashSet::default();
            let mut styles: Vec<(Option<(usize, usize)>, String)> = Vec::new();
            let mut mixed = false;
            for item in &own.items {
                match item {
                    Item::Read { guard, read } => {
                        let guard = guard.map(|span| self.render(span));
                        let converted = &self.sheets[read.sheet].converted;
                        let keys = composed(converted, &read.key);
                        for key in keys {
                            let order = self.sheets[read.sheet].converted.order.get(&key).copied();
                            let Some(order) = order else {
                                self.hold(read.sheet, "missing", key, read.span.start);
                                continue;
                            };
                            let part = Read { key: key.clone(), ..read.clone() };
                            let Some(text) = self.call_text(index, &part, &mut consumed) else { continue };
                            let text = match &guard {
                                Some(guard) => format!("{guard} && {text}"),
                                None => text,
                            };
                            styles.push((Some((read.sheet, order)), text));
                        }
                    }
                    Item::Cond { span, reads } => {
                        for read in reads {
                            let converted = &self.sheets[read.sheet].converted;
                            if converted.functions.contains_key(&read.key) || composed(converted, &read.key).len() > 1 {
                                self.hold(read.sheet, "conditional-composes", read.key.clone(), read.span.start);
                            }
                        }
                        let text = self.render(*span);
                        styles.push((None, text));
                    }
                    Item::Other | Item::Word(_) => mixed = true,
                    Item::Unknown { span } => {
                        for (_, read) in Self::reads_of(&own.items) {
                            self.hold(read.sheet, "style-prop-present", self.style_prop.to_string(), span.start);
                        }
                    }
                }
            }

            let mut groups: FxHashMap<usize, Vec<usize>> = FxHashMap::default();
            for (slot, (sortable, _)) in styles.iter().enumerate() {
                if let Some((sheet, _)) = sortable {
                    groups.entry(*sheet).or_default().push(slot);
                }
            }
            for slots in groups.values() {
                let mut ordered: Vec<(Option<(usize, usize)>, String)> = slots.iter().map(|&s| styles[s].clone()).collect();
                ordered.sort_by_key(|(sortable, _)| sortable.map(|(_, order)| order));
                for (&slot, entry) in slots.iter().zip(ordered) {
                    styles[slot] = entry;
                }
            }

            let mut list: Vec<String> = tags;
            list.extend(styles.into_iter().map(|(_, text)| text));
            let expression = if list.len() == 1 { list[0].clone() } else { format!("[{}]", list.join(", ")) };
            if mixed {
                for (_, read) in Self::reads_of(&own.items) {
                    self.hold(read.sheet, "class-name-mixed", "className".to_string(), own.span.start);
                }
                continue;
            }
            self.edits.push((own.span, format!("{prop}={{{expression}}}")));

            if consumed.is_empty() {
                continue;
            }
            let Some(style) = self.elements[index].style.take() else { continue };
            let kept: Vec<Span> = style
                .properties
                .iter()
                .enumerate()
                .filter(|(i, _)| !consumed.contains(i))
                .map(|(_, (_, span, _))| *span)
                .collect();
            if kept.is_empty() {
                let mut start = style.attr.start as usize;
                while start > 0 && self.text.as_bytes()[start - 1].is_ascii_whitespace() {
                    start -= 1;
                }
                self.edits.push((Span::new(start as u32, style.attr.end), String::new()));
            } else {
                let kept = kept.into_iter().map(|span| self.render(span)).collect::<Vec<_>>().join(", ");
                self.edits.push((style.expression, format!("{{ {kept} }}")));
            }
        }
    }
}

pub fn mentions(sheet: &Sheet, paths: Option<&Paths>, text: &str) -> bool {
    text.contains(basename(&sheet.path))
        || paths.is_some_and(|paths| paths.aliases(&sheet.path).iter().any(|alias| text.contains(alias.as_str())))
}

pub fn scan(
    file: &str,
    text: &str,
    sheets: &[Sheet],
    paths: Option<&Paths>,
    exists: &dyn Fn(&str) -> bool,
    style_prop: &str,
) -> Outcome {
    let named: Vec<usize> = (0..sheets.len()).filter(|&i| mentions(&sheets[i], paths, text)).collect();
    if named.is_empty() {
        return Outcome::default();
    }
    let Ok(source_type) = SourceType::from_path(file) else { return Outcome::default() };
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, source_type).parse();
    if parsed.fatal_error || !parsed.diagnostics.is_empty() {
        let mut outcome = Outcome { failed: Some(format!("{file} could not be parsed")), ..Outcome::default() };
        for sheet in named {
            outcome.holds.push(Hold {
                sheet,
                kind: "parse-error",
                name: file.to_string(),
                file: file.to_string(),
                line: 0,
                column: 0,
                blocking: true,
            });
        }
        return outcome;
    }
    let program = parsed.program;
    let semantic = SemanticBuilder::new().build(&program).semantic;
    let scoping = semantic.scoping();

    let mut scan = Scan {
        text,
        file,
        scoping,
        sheets,
        paths,
        exists,
        style_prop,
        bindings: FxHashMap::default(),
        claimed: FxHashMap::default(),
        edits: Vec::new(),
        elements: Vec::new(),
        stack: Vec::new(),
        in_use: 0,
        uses_css: false,
        css_local: None,
        holds: Vec::new(),
    };

    let mut has_core = false;
    let mut imports: Vec<(Span, SymbolId)> = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::ImportDeclaration(declaration) => {
                let specifier = declaration.source.value.as_str().unwrap_or_default();
                if specifier == CORE {
                    has_core = true;
                    for item in declaration.specifiers.iter().flatten() {
                        match item {
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                                scan.css_local = Some(namespace.local.name.as_str().to_string());
                            }
                            ImportDeclarationSpecifier::ImportSpecifier(named) if named.imported.name().as_str() == "css" => {
                                scan.css_local = Some(named.local.name.as_str().to_string());
                            }
                            _ => {}
                        }
                    }
                    continue;
                }
                let sheet = match scan.sheet_for(specifier, paths) {
                    Ok(Some(sheet)) => sheet,
                    Ok(None) => continue,
                    Err(()) => {
                        scan.unresolved(specifier, declaration.span.start);
                        continue;
                    }
                };
                let items: &[ImportDeclarationSpecifier] = declaration.specifiers.as_ref().map_or(&[], |s| s.as_slice());
                match items {
                    [ImportDeclarationSpecifier::ImportDefaultSpecifier(default)]
                        if !declaration.import_kind.is_type() && without_query(specifier) == specifier =>
                    {
                        let Some(symbol) = default.local.symbol_id.get() else { continue };
                        scan.bindings.insert(symbol, Binding { sheet, local: default.local.name.as_str().to_string() });
                        imports.push((declaration.span, symbol));
                    }
                    _ => scan.hold(sheet, "import-shape", specifier.to_string(), declaration.span.start),
                }
            }
            Statement::ExportFromDeclaration(declaration) => {
                scan.foreign_specifier(declaration.source.value.as_str().unwrap_or_default(), declaration.span.start, "re-export");
            }
            Statement::ExportAllDeclaration(declaration) => {
                scan.foreign_specifier(declaration.source.value.as_str().unwrap_or_default(), declaration.span.start, "re-export");
            }
            _ => {}
        }
    }

    if imports.is_empty() {
        walk::walk_program(&mut scan, &program);
        return Outcome { holds: scan.holds, ..Outcome::default() };
    }

    if imports.len() == 1 && !scoping.symbol_names().any(|name| name == "styles") {
        for binding in scan.bindings.values_mut() {
            binding.local = "styles".to_string();
        }
    }

    for statement in &program.body {
        if !matches!(statement, Statement::ImportDeclaration(_)) {
            scan.visit_statement(statement);
        }
    }

    let inherited = scan.inherit();
    scan.emit(inherited);

    let need_namespace = scan.uses_css && scan.css_local.is_none();
    if need_namespace && scoping.symbol_names().any(|name| name == "css") {
        for &(span, symbol) in &imports {
            let sheet = scan.bindings[&symbol].sheet;
            scan.hold(sheet, "css-binding-taken", "css".to_string(), span.start);
        }
    }
    for (position, &(span, symbol)) in imports.iter().enumerate() {
        let binding = &scan.bindings[&symbol];
        let target = &sheets[binding.sheet].target;
        let specifier = relative(dirname(file), target.strip_suffix(".ts").unwrap_or(target));
        let imported = if binding.local == "styles" {
            format!("import {{ styles }} from '{specifier}';")
        } else {
            format!("import {{ styles as {} }} from '{specifier}';", binding.local)
        };
        let prefix = if position > 0 {
            ""
        } else if need_namespace {
            "import * as css from '@plumeria/core';\n"
        } else if !has_core {
            "import '@plumeria/core';\n"
        } else {
            ""
        };
        scan.edits.push((span, format!("{prefix}{imported}")));
    }

    let mut edits: Vec<(u32, u32, String)> = scan.edits.into_iter().map(|(span, text)| (span.start, span.end, text)).collect();
    edits.sort_by_key(|(start, end, _)| (*start, *end));
    let overlapping = edits.windows(2).any(|pair| pair[0].1 > pair[1].0);
    let mut holds = scan.holds;
    let mut failed = None;
    if overlapping {
        failed = Some(format!("{file}: two rewrites overlap"));
        for &(span, symbol) in &imports {
            let _ = span;
            holds.push(Hold {
                sheet: Scan::sheet_of(&scan.bindings, symbol),
                kind: "overlap",
                name: file.to_string(),
                file: file.to_string(),
                line: 0,
                column: 0,
                blocking: true,
            });
        }
    }
    Outcome { edits, holds, failed }
}

impl Scan<'_> {
    fn sheet_of(bindings: &FxHashMap<SymbolId, Binding>, symbol: SymbolId) -> usize {
        bindings[&symbol].sheet
    }
}
