use oxc_ast::ast::*;
use oxc_span::Span;

use crate::eval::consts::binding_name;
use crate::syntax::visit::renders_style;

pub enum Wrapped<'b, 'a> {
    Function(Span, &'b FormalParameters<'a>),
    Name(&'b str),
    Ambiguous,
}

fn function_of<'b, 'a>(expr: &'b Expression<'a>) -> Option<(Span, &'b FormalParameters<'a>)> {
    match expr {
        Expression::ArrowFunctionExpression(arrow) => Some((arrow.span, &arrow.params)),
        Expression::FunctionExpression(function) => Some((function.span, &function.params)),
        Expression::CallExpression(call) => match wrapped(call)? {
            Wrapped::Function(span, params) => Some((span, params)),
            _ => None,
        },
        _ => None,
    }
}

fn wrapped<'b, 'a>(call: &'b CallExpression<'a>) -> Option<Wrapped<'b, 'a>> {
    let mut functions = Vec::new();
    let mut names = Vec::new();
    for argument in &call.arguments {
        let expr = match argument {
            Argument::SpreadElement(spread) => &spread.argument,
            other => other.to_expression(),
        };
        match expr {
            Expression::ArrowFunctionExpression(arrow)
                if !arrow.params.items.is_empty() && renders_style(expr) =>
            {
                functions.push((arrow.span, &*arrow.params));
            }
            Expression::FunctionExpression(function)
                if !function.params.items.is_empty() && renders_style(expr) =>
            {
                functions.push((function.span, &*function.params));
            }
            Expression::CallExpression(inner) => match wrapped(inner) {
                Some(Wrapped::Function(span, params)) => functions.push((span, params)),
                Some(Wrapped::Name(name)) => names.push(name),
                Some(Wrapped::Ambiguous) => return Some(Wrapped::Ambiguous),
                None => {}
            },
            Expression::Identifier(ident)
                if ident.name.chars().next().is_some_and(char::is_uppercase) =>
            {
                names.push(ident.name.as_str());
            }
            _ => {}
        }
    }
    match (functions.as_slice(), names.as_slice()) {
        ([(span, params)], _) => Some(Wrapped::Function(*span, params)),
        ([], [name]) => Some(Wrapped::Name(name)),
        ([], []) => None,
        _ => Some(Wrapped::Ambiguous),
    }
}

pub fn wrapped_bindings<'b, 'a>(program: &'b Program<'a>) -> Vec<(String, Span, Wrapped<'b, 'a>)> {
    let mut out = Vec::new();
    for statement in &program.body {
        let decl = match statement {
            Statement::VariableDeclaration(decl) => decl,
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(decl) => decl,
                _ => continue,
            },
            Statement::ExportDefaultDeclaration(export) => {
                if let Some(Expression::CallExpression(call)) = export.declaration.as_expression()
                    && let Some(found) = wrapped(call)
                {
                    out.push(("default".to_string(), call.span, found));
                }
                continue;
            }
            _ => continue,
        };
        for declarator in &decl.declarations {
            if let (Some(name), Some(Expression::CallExpression(call))) =
                (binding_name(&declarator.id), &declarator.init)
                && let Some(found) = wrapped(call)
            {
                out.push((name.to_string(), call.span, found));
            }
        }
    }
    out
}

pub fn component_functions<'b, 'a>(
    program: &'b Program<'a>,
) -> Vec<(String, Span, &'b FormalParameters<'a>)> {
    let mut out = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::FunctionDeclaration(function) => {
                let name = function
                    .id
                    .as_ref()
                    .map(|id| id.name.to_string())
                    .unwrap_or_else(|| "default".to_string());
                out.push((name, function.span, &*function.params));
            }
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::FunctionDeclaration(function) => {
                    let name = function
                        .id
                        .as_ref()
                        .map(|id| id.name.to_string())
                        .unwrap_or_else(|| "default".to_string());
                    out.push((name, function.span, &*function.params));
                }
                Declaration::VariableDeclaration(decl) => push_declarator_functions(decl, &mut out),
                _ => {}
            },
            Statement::VariableDeclaration(decl) => push_declarator_functions(decl, &mut out),
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    let name = function
                        .id
                        .as_ref()
                        .map(|id| id.name.to_string())
                        .unwrap_or_else(|| "default".to_string());
                    out.push((name, function.span, &*function.params));
                }
                ExportDefaultDeclarationKind::ClassDeclaration(_)
                | ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => {}
                other => {
                    let expr = other.to_expression();
                    match expr {
                        Expression::ArrowFunctionExpression(arrow) => {
                            out.push(("default".to_string(), arrow.span, &*arrow.params));
                        }
                        Expression::FunctionExpression(function) => {
                            let name = function
                                .id
                                .as_ref()
                                .map(|id| id.name.to_string())
                                .unwrap_or_else(|| "default".to_string());
                            out.push((name, function.span, &*function.params));
                        }
                        Expression::CallExpression(_) => {
                            if let Some((span, params)) = function_of(expr) {
                                out.push(("default".to_string(), span, params));
                            }
                        }
                        _ => {}
                    }
                }
            },
            _ => {}
        }
    }
    out
}

fn push_declarator_functions<'b, 'a>(
    decl: &'b VariableDeclaration<'a>,
    out: &mut Vec<(String, Span, &'b FormalParameters<'a>)>,
) {
    for declarator in &decl.declarations {
        let Some(name) = binding_name(&declarator.id) else {
            continue;
        };
        let Some(init) = &declarator.init else {
            continue;
        };
        if let Some((span, params)) = function_of(init) {
            out.push((name.to_string(), span, params));
        }
    }
}
