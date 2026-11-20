use oxc_allocator::Allocator;
use oxc_ast::ast::{Expression, ObjectExpression, ObjectPropertyKind, PropertyKey};
use oxc_parser::Parser;
use oxc_span::SourceType;

pub fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if matches!(parts.last(), Some(last) if *last != "..") {
                    parts.pop();
                } else {
                    parts.push("..");
                }
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}

pub fn dirname(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

pub fn basename(path: &str) -> &str {
    path.rsplit_once('/').map_or(path, |(_, name)| name)
}

pub fn join(dir: &str, path: &str) -> String {
    if dir.is_empty() { normalize(path) } else { normalize(&format!("{dir}/{path}")) }
}

pub fn relative(from_dir: &str, to: &str) -> String {
    let from: Vec<&str> = from_dir.split('/').filter(|p| !p.is_empty()).collect();
    let to_parts: Vec<&str> = to.split('/').filter(|p| !p.is_empty()).collect();
    let common = from.iter().zip(&to_parts).take_while(|(a, b)| a == b).count();
    let mut out: Vec<&str> = vec![".."; from.len() - common];
    out.extend(&to_parts[common..]);
    let joined = out.join("/");
    if joined.starts_with("..") { joined } else { format!("./{joined}") }
}

pub struct Paths {
    base: String,
    rules: Vec<(String, Vec<String>)>,
}

fn text_of<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::StringLiteral(literal) => literal.value.as_str(),
        _ => None,
    }
}

fn key_of<'a>(key: &'a PropertyKey<'a>) -> Option<&'a str> {
    match key {
        PropertyKey::StringLiteral(literal) => literal.value.as_str(),
        PropertyKey::StaticIdentifier(name) => Some(name.name.as_str()),
        _ => None,
    }
}

pub fn field<'a>(expression: &'a Expression<'a>, name: &str) -> Option<&'a Expression<'a>> {
    let Expression::ObjectExpression(object) = expression else { return None };
    object.properties.iter().find_map(|property| match property {
        ObjectPropertyKind::ObjectProperty(property) if key_of(&property.key) == Some(name) => Some(&property.value),
        _ => None,
    })
}

fn read_rules(paths: &ObjectExpression) -> Vec<(String, Vec<String>)> {
    paths
        .properties
        .iter()
        .filter_map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else { return None };
            let pattern = key_of(&property.key)?.to_string();
            let Expression::ArrayExpression(targets) = &property.value else { return None };
            let targets = targets
                .elements
                .iter()
                .filter_map(|element| element.as_expression().and_then(text_of).map(str::to_string))
                .collect();
            Some((pattern, targets))
        })
        .collect()
}

impl Paths {
    pub fn load(read: impl Fn(&str) -> Option<String>) -> Option<Paths> {
        let mut base = None;
        let mut rules = None;
        let mut file = "tsconfig.json".to_string();
        let mut seen = Vec::new();
        while !seen.contains(&file) {
            seen.push(file.clone());
            let Some(text) = read(&file) else { break };
            let allocator = Allocator::default();
            let source = format!("({text})");
            let Ok(expression) = Parser::new(&allocator, &source, SourceType::mjs()).parse_expression() else { break };
            let expression = match &expression {
                Expression::ParenthesizedExpression(inner) => &inner.expression,
                other => other,
            };
            let dir = dirname(&file).to_string();
            if let Some(options) = field(expression, "compilerOptions") {
                if base.is_none() {
                    base = field(options, "baseUrl").and_then(text_of).map(|url| join(&dir, url));
                }
                if rules.is_none()
                    && let Some(Expression::ObjectExpression(paths)) = field(options, "paths")
                {
                    rules = Some((read_rules(paths), dir.clone()));
                }
            }
            let next = match field(expression, "extends") {
                Some(Expression::StringLiteral(literal)) => literal.value.as_str().map(str::to_string),
                _ => None,
            };
            match next {
                Some(next) if next.starts_with("./") || next.starts_with("../") => {
                    let next = join(&dir, &next);
                    file = if next.ends_with(".json") { next } else { format!("{next}.json") };
                }
                _ => break,
            }
        }
        let (rules, dir) = rules?;
        let root = base.unwrap_or(dir);
        let rules = rules
            .into_iter()
            .map(|(pattern, targets)| (pattern, targets.iter().map(|target| join(&root, target)).collect()))
            .collect();
        Some(Paths { base: String::new(), rules })
    }

    pub fn aliases(&self, path: &str) -> Vec<String> {
        let mut found = Vec::new();
        for (pattern, targets) in &self.rules {
            for target in targets {
                let full = join(&self.base, target);
                match full.split_once('*') {
                    Some((prefix, suffix)) => {
                        if let Some(captured) = path.strip_prefix(prefix).and_then(|rest| rest.strip_suffix(suffix)) {
                            found.push(pattern.replacen('*', captured, 1));
                        }
                    }
                    None if full == path => found.push(pattern.clone()),
                    None => {}
                }
            }
        }
        found
    }

    fn candidates(&self, specifier: &str) -> Vec<String> {
        let mut found = Vec::new();
        for (pattern, targets) in &self.rules {
            let captured = match pattern.split_once('*') {
                Some((prefix, suffix)) => specifier
                    .strip_prefix(prefix)
                    .and_then(|rest| rest.strip_suffix(suffix))
                    .map(str::to_string),
                None => (pattern == specifier).then(String::new),
            };
            let Some(captured) = captured else { continue };
            for target in targets {
                found.push(join(&self.base, &target.replacen('*', &captured, 1)));
            }
        }
        found
    }
}

pub fn resolve(specifier: &str, importer: &str, paths: Option<&Paths>, exists: impl Fn(&str) -> bool) -> Option<String> {
    if specifier.starts_with("./") || specifier.starts_with("../") {
        let candidate = join(dirname(importer), specifier);
        return exists(&candidate).then_some(candidate);
    }
    paths?.candidates(specifier).into_iter().find(|candidate| exists(candidate))
}
