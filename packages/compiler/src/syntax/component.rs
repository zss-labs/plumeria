use oxc_ast::ast::*;
use oxc_span::Span;

use crate::eval::consts::binding_name;
use crate::syntax::module::{SpecKind, import_specs};
use crate::syntax::visit::renders_style;

pub enum Wrapped<'b, 'a> {
    Function(Span, &'b FormalParameters<'a>),
    Name(&'b str),
    Import(&'b str, &'b str),
    Ambiguous,
}

#[derive(Default)]
struct React<'b> {
    lazy: Vec<&'b str>,
    namespaces: Vec<&'b str>,
}

impl<'b> React<'b> {
    fn of(program: &'b Program) -> Self {
        let mut react = Self::default();
        for statement in &program.body {
            let Statement::ImportDeclaration(decl) = statement else {
                continue;
            };
            if decl.source.value != "react" || decl.import_kind.is_type() {
                continue;
            }
            for spec in import_specs(decl) {
                match spec.kind {
                    _ if spec.type_only => {}
                    SpecKind::Named if spec.imported == "lazy" => react.lazy.push(spec.local),
                    SpecKind::Named => {}
                    SpecKind::Default | SpecKind::Namespace => react.namespaces.push(spec.local),
                }
            }
        }
        react
    }

    fn is_lazy(&self, callee: &Expression) -> bool {
        match callee.without_parentheses() {
            Expression::Identifier(ident) => self.lazy.contains(&ident.name.as_str()),
            Expression::StaticMemberExpression(member) => {
                member.property.name == "lazy"
                    && matches!(&member.object, Expression::Identifier(object) if self.namespaces.contains(&object.name.as_str()))
            }
            _ => false,
        }
    }
}

fn returned<'b, 'a>(function: &'b Expression<'a>) -> Option<&'b Expression<'a>> {
    let body: &FunctionBody = match function.without_parentheses() {
        Expression::ArrowFunctionExpression(arrow) => {
            if let Some(value) = arrow.get_expression() {
                return Some(value.without_parentheses());
            }
            arrow.get_function_body()?
        }
        Expression::FunctionExpression(function) => function.body.as_ref()?,
        _ => return None,
    };
    match body.statements.as_slice() {
        [Statement::ReturnStatement(statement)] => statement
            .argument
            .as_ref()
            .map(Expression::without_parentheses),
        _ => None,
    }
}

fn import_source<'b>(expr: &'b Expression) -> Option<&'b str> {
    match expr.without_parentheses() {
        Expression::ImportExpression(import) => match &import.source {
            Expression::StringLiteral(value) => Some(value.value.as_str()),
            _ => None,
        },
        _ => None,
    }
}

fn picked<'b>(pick: &'b Expression) -> Option<&'b str> {
    let params = match pick.without_parentheses() {
        Expression::ArrowFunctionExpression(arrow) => &arrow.params,
        Expression::FunctionExpression(function) => &function.params,
        _ => return None,
    };
    let ([param], None) = (params.items.as_slice(), &params.rest) else {
        return None;
    };
    let module = binding_name(&param.pattern)?;
    let Expression::ObjectExpression(object) = returned(pick)? else {
        return None;
    };
    let [ObjectPropertyKind::ObjectProperty(property)] = object.properties.as_slice() else {
        return None;
    };
    let Expression::StaticMemberExpression(member) = &property.value else {
        return None;
    };
    let Expression::Identifier(object) = &member.object else {
        return None;
    };
    (!property.computed && property.key.is_specific_static_name("default") && object.name == module)
        .then_some(member.property.name.as_str())
}

fn loaded<'b>(expr: &'b Expression) -> Option<(&'b str, &'b str)> {
    if let Some(source) = import_source(expr) {
        return Some((source, "default"));
    }
    let Expression::CallExpression(call) = expr else {
        return None;
    };
    let Expression::StaticMemberExpression(then) = &call.callee else {
        return None;
    };
    let ([argument], "then") = (call.arguments.as_slice(), then.property.name.as_str()) else {
        return None;
    };
    Some((
        import_source(&then.object)?,
        picked(argument.as_expression()?)?,
    ))
}

fn function_of<'b, 'a>(expr: &'b Expression<'a>) -> Option<(Span, &'b FormalParameters<'a>)> {
    match expr {
        Expression::ArrowFunctionExpression(arrow) => Some((arrow.span, &arrow.params)),
        Expression::FunctionExpression(function) => Some((function.span, &function.params)),
        Expression::CallExpression(call) => match wrapped(call, &React::default())? {
            Wrapped::Function(span, params) => Some((span, params)),
            _ => None,
        },
        _ => None,
    }
}

fn wrapped<'b, 'a>(call: &'b CallExpression<'a>, react: &React) -> Option<Wrapped<'b, 'a>> {
    if react.is_lazy(&call.callee) {
        let loader = call.arguments.first()?.as_expression()?;
        let (source, name) = loaded(returned(loader)?)?;
        return Some(Wrapped::Import(source, name));
    }
    let mut functions = Vec::new();
    let mut names = Vec::new();
    for argument in &call.arguments {
        let expr = match argument {
            Argument::SpreadElement(spread) => &spread.argument,
            other => other.to_expression(),
        };
        match expr {
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                if let Some((span, params)) = function_of(expr)
                    && !params.items.is_empty()
                    && renders_style(expr)
                {
                    functions.push((span, params));
                }
            }
            Expression::CallExpression(inner) => match wrapped(inner, react) {
                Some(Wrapped::Function(span, params)) => functions.push((span, params)),
                Some(Wrapped::Ambiguous) => return Some(Wrapped::Ambiguous),
                Some(found) => names.push(found),
                None => {}
            },
            Expression::Identifier(ident)
                if ident.name.chars().next().is_some_and(char::is_uppercase) =>
            {
                names.push(Wrapped::Name(ident.name.as_str()));
            }
            _ => {}
        }
    }
    match (functions.as_slice(), names.len()) {
        ([(span, params)], _) => Some(Wrapped::Function(*span, params)),
        ([], 1) => names.pop(),
        ([], 0) => None,
        _ => Some(Wrapped::Ambiguous),
    }
}

pub fn wrapped_bindings<'b, 'a>(program: &'b Program<'a>) -> Vec<(String, Span, Wrapped<'b, 'a>)> {
    let react = React::of(program);
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
                    && let Some(found) = wrapped(call, &react)
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
                && let Some(found) = wrapped(call, &react)
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
        let function = match statement {
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => function,
                other => {
                    if let Some(expr) = other.as_expression()
                        && let Some((span, params)) = function_of(expr)
                    {
                        let name = match expr {
                            Expression::FunctionExpression(function) => function.id.as_ref(),
                            _ => None,
                        };
                        out.push((
                            name.map_or("default", |id| id.name.as_str()).to_string(),
                            span,
                            params,
                        ));
                    }
                    continue;
                }
            },
            other => {
                let declaration = match other {
                    Statement::ExportDeclaration(export) => Some(&export.declaration),
                    _ => other.as_declaration(),
                };
                match declaration {
                    Some(Declaration::FunctionDeclaration(function)) => function,
                    Some(Declaration::VariableDeclaration(decl)) => {
                        push_declarator_functions(decl, &mut out);
                        continue;
                    }
                    _ => continue,
                }
            }
        };
        out.push((
            function
                .id
                .as_ref()
                .map_or("default", |id| id.name.as_str())
                .to_string(),
            function.span,
            &function.params,
        ));
    }
    out
}

fn push_declarator_functions<'b, 'a>(
    decl: &'b VariableDeclaration<'a>,
    out: &mut Vec<(String, Span, &'b FormalParameters<'a>)>,
) {
    for declarator in &decl.declarations {
        if let Some(name) = binding_name(&declarator.id)
            && let Some((span, params)) = declarator.init.as_ref().and_then(function_of)
        {
            out.push((name.to_string(), span, params));
        }
    }
}
