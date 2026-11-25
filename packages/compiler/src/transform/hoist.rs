use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

pub const MODULE_SITE: u32 = u32::MAX;

#[derive(Clone, Copy, Default)]
pub struct DeclSite {
    pub at: u32,
    pub body_end: Option<u32>,
    pub directive_start: Option<u32>,
    pub module: bool,
}

impl DeclSite {
    pub fn insertions(&self, names: &[String], source: &str) -> Vec<(u32, String)> {
        let names = names.join(", ");
        match (self.body_end, self.directive_start) {
            (Some(end), _) => vec![
                (self.at, format!("{{ let {names}; return ")),
                (end, "; }".to_string()),
            ],
            (None, _) if self.module && self.at == 0 => vec![(self.at, format!("var {names};\n"))],
            (None, _) if self.module => vec![(self.at, format!("\nvar {names};"))],
            (None, Some(start)) => {
                let before = &source[..start as usize];
                let line = before.rsplit_once('\n').map_or(before, |(_, line)| line);
                let indent = &line[..line.len() - line.trim_start_matches([' ', '\t']).len()];
                let newline = if source[self.at as usize..].starts_with("\r\n")
                    || before.strip_suffix(line).is_some_and(|prefix| prefix.ends_with("\r\n"))
                {
                    "\r\n"
                } else {
                    "\n"
                };
                vec![(self.at, format!("{newline}{indent}let {names};"))]
            }
            (None, None) => vec![(self.at, format!(" let {names};"))],
        }
    }
}

pub fn collect_decl_sites(program: &Program) -> FxHashMap<u32, DeclSite> {
    let mut collector = Collector::default();
    let at = match (program.directives.last(), &program.hashbang) {
        (Some(directive), _) => directive.span.end,
        (None, Some(hashbang)) => hashbang.span.end,
        (None, None) => program.span.start,
    };
    collector.sites.insert(
        MODULE_SITE,
        DeclSite {
            at,
            module: true,
            ..DeclSite::default()
        },
    );
    collector.visit_program(program);
    collector.sites
}

#[derive(Default)]
struct Collector {
    sites: FxHashMap<u32, DeclSite>,
}

fn body_site(body: &FunctionBody) -> DeclSite {
    match body.directives.last() {
        Some(directive) => DeclSite {
            at: directive.span.end,
            directive_start: Some(directive.span.start),
            ..DeclSite::default()
        },
        None => DeclSite {
            at: body.span.start + 1,
            ..DeclSite::default()
        },
    }
}

impl<'a> Visit<'a> for Collector {
    fn visit_static_block(&mut self, it: &StaticBlock<'a>) {
        if let Some(first) = it.body.first() {
            self.sites.insert(
                it.span.start,
                DeclSite {
                    at: first.span().start,
                    ..DeclSite::default()
                },
            );
        }
        walk::walk_static_block(self, it);
    }

    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_syntax::scope::ScopeFlags) {
        if let Some(body) = &it.body {
            self.sites.insert(it.span.start, body_site(body));
        }
        walk::walk_function(self, it, flags);
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        let site = match (it.body.as_function_body(), it.body.as_expression()) {
            (Some(body), _) => Some(body_site(body)),
            (None, Some(expr)) => {
                let span = expr.span();
                Some(DeclSite {
                    at: span.start,
                    body_end: Some(span.end),
                    ..DeclSite::default()
                })
            }
            (None, None) => None,
        };
        if let Some(site) = site {
            self.sites.insert(it.span.start, site);
        }
        walk::walk_arrow_function_expression(self, it);
    }
}
