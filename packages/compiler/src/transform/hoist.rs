use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

pub const MODULE_SITE: u32 = u32::MAX;

#[derive(Clone, Copy, Default)]
pub struct DeclSite {
    pub at: u32,
    pub body_end: Option<u32>,
    pub after_directive: bool,
    pub module: bool,
}

impl DeclSite {
    pub fn insertions(&self, names: &[String]) -> Vec<(u32, String)> {
        let names = names.join(", ");
        match self.body_end {
            Some(end) => vec![
                (self.at, format!("{{ let {names}; return ")),
                (end, "; }".to_string()),
            ],
            None if self.module && self.at == 0 => vec![(self.at, format!("var {names};\n"))],
            None if self.module => vec![(self.at, format!("\nvar {names};"))],
            None if self.after_directive => vec![(self.at, format!("\nlet {names};"))],
            None => vec![(self.at, format!(" let {names};"))],
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
            after_directive: true,
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
