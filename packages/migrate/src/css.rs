use cssparser::{
    AtRuleParser, CowRcStr, DeclarationParser, ParseError, Parser, ParserInput, ParserState,
    QualifiedRuleParser, RuleBodyItemParser, RuleBodyParser, StyleSheetParser, Token,
};

pub struct Decl {
    pub prop: String,
    pub value: String,
    pub line: u32,
    pub column: u32,
}

pub struct Rule {
    pub prelude: String,
    pub line: u32,
    pub column: u32,
    pub children: Vec<Node>,
}

pub struct At {
    pub name: String,
    pub params: String,
    pub line: u32,
    pub column: u32,
    pub block: Option<Vec<Node>>,
}

pub enum Node {
    Rule(Rule),
    At(At),
    Decl(Decl),
}

pub struct Broken {
    pub line: u32,
    pub column: u32,
    pub source: String,
}

struct Tree;

fn rest<'i>(input: &mut Parser<'i, '_>) -> &'i str {
    let start = input.position();
    while input.next_including_whitespace_and_comments().is_ok() {}
    input.slice_from(start)
}

pub fn strip_comments(text: &str) -> String {
    let mut input = ParserInput::new(text);
    let mut parser = Parser::new(&mut input);
    let mut out = String::new();
    let mut start = parser.position();
    loop {
        let before = parser.position();
        match parser.next_including_whitespace_and_comments() {
            Ok(Token::Comment(_)) => {
                out.push_str(parser.slice(start..before));
                start = parser.position();
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    out.push_str(parser.slice_from(start));
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn located(state: &ParserState) -> (u32, u32) {
    let location = state.source_location();
    (location.line + 1, location.column)
}

impl<'i> QualifiedRuleParser<'i> for Tree {
    type Prelude = String;
    type QualifiedRule = Node;
    type Error = ();

    fn parse_prelude<'t>(&mut self, input: &mut Parser<'i, 't>) -> Result<String, ParseError<'i, ()>> {
        Ok(strip_comments(rest(input)))
    }

    fn parse_block<'t>(
        &mut self,
        prelude: String,
        start: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> Result<Node, ParseError<'i, ()>> {
        let (line, column) = located(start);
        Ok(Node::Rule(Rule { prelude, line, column, children: body(input) }))
    }
}

impl<'i> AtRuleParser<'i> for Tree {
    type Prelude = (String, String);
    type AtRule = Node;
    type Error = ();

    fn parse_prelude<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
    ) -> Result<(String, String), ParseError<'i, ()>> {
        Ok((name.to_string(), strip_comments(rest(input))))
    }

    fn rule_without_block(&mut self, (name, params): (String, String), start: &ParserState) -> Result<Node, ()> {
        let (line, column) = located(start);
        Ok(Node::At(At { name, params, line, column, block: None }))
    }

    fn parse_block<'t>(
        &mut self,
        (name, params): (String, String),
        start: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> Result<Node, ParseError<'i, ()>> {
        let (line, column) = located(start);
        Ok(Node::At(At { name, params, line, column, block: Some(body(input)) }))
    }
}

impl<'i> DeclarationParser<'i> for Tree {
    type Declaration = Node;
    type Error = ();

    fn parse_value<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
        start: &ParserState,
    ) -> Result<Node, ParseError<'i, ()>> {
        let (line, column) = located(start);
        let prop = if name.starts_with("--") { name.to_string() } else { name.to_ascii_lowercase() };
        Ok(Node::Decl(Decl { prop, value: strip_comments(rest(input)), line, column }))
    }
}

impl<'i> RuleBodyItemParser<'i, Node, ()> for Tree {
    fn parse_declarations(&self) -> bool {
        true
    }
    fn parse_qualified(&self) -> bool {
        true
    }
}

fn body(input: &mut Parser<'_, '_>) -> Vec<Node> {
    RuleBodyParser::new(input, &mut Tree).filter_map(Result::ok).collect()
}

pub fn parse(text: &str) -> (Vec<Node>, Vec<Broken>) {
    let mut input = ParserInput::new(text);
    let mut parser = Parser::new(&mut input);
    let mut nodes = Vec::new();
    let mut broken = Vec::new();
    for item in StyleSheetParser::new(&mut parser, &mut Tree) {
        match item {
            Ok(node) => nodes.push(node),
            Err((error, source)) => broken.push(Broken {
                line: error.location.line + 1,
                column: error.location.column,
                source: source.trim().to_string(),
            }),
        }
    }
    (nodes, broken)
}

pub fn split_list(text: &str) -> Vec<String> {
    let mut input = ParserInput::new(text);
    let mut parser = Parser::new(&mut input);
    let mut items = Vec::new();
    let mut start = parser.position();
    loop {
        let before = parser.position();
        match parser.next_including_whitespace() {
            Ok(Token::Comma) => {
                items.push(parser.slice(start..before).trim().to_string());
                start = parser.position();
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    items.push(parser.slice_from(start).trim().to_string());
    items.retain(|item| !item.is_empty());
    items
}

pub fn classes_in(text: &str) -> Vec<String> {
    let mut input = ParserInput::new(text);
    let mut parser = Parser::new(&mut input);
    let mut found = Vec::new();
    collect_classes(&mut parser, &mut found);
    found
}

fn collect_classes(parser: &mut Parser<'_, '_>, found: &mut Vec<String>) {
    let mut dot = false;
    loop {
        let token = match parser.next_including_whitespace() {
            Ok(token) => token.clone(),
            Err(_) => return,
        };
        match token {
            Token::Delim('.') => {
                dot = true;
                continue;
            }
            Token::Ident(name) if dot => found.push(name.to_string()),
            Token::Function(_) | Token::ParenthesisBlock | Token::SquareBracketBlock => {
                let _ = parser.parse_nested_block(|inner| {
                    collect_classes(inner, found);
                    Ok::<(), ParseError<'_, ()>>(())
                });
            }
            _ => {}
        }
        dot = false;
    }
}

pub enum Piece {
    Class(String),
    Tag(String),
    Pseudo(String),
    Global(String),
    BareGlobal,
    Boost,
    Attribute(String),
    Combinator(char),
    Other,
}

pub fn pieces(selector: &str) -> Vec<Piece> {
    let mut input = ParserInput::new(selector);
    let mut parser = Parser::new(&mut input);
    let mut out = Vec::new();
    let mut space = false;
    loop {
        let start = parser.position();
        let token = match parser.next_including_whitespace() {
            Ok(token) => token.clone(),
            Err(_) => break,
        };
        let piece = match token {
            Token::WhiteSpace(_) => {
                space = true;
                continue;
            }
            Token::Delim(c @ ('>' | '+' | '~')) => {
                space = false;
                out.push(Piece::Combinator(c));
                continue;
            }
            Token::Delim('.') => match parser.next() {
                Ok(Token::Ident(name)) => Piece::Class(name.to_string()),
                _ => Piece::Other,
            },
            Token::Ident(name) => Piece::Tag(name.to_string()),
            Token::Colon => pseudo(&mut parser, start),
            Token::SquareBracketBlock => {
                let _ = parser.parse_nested_block(|inner| {
                    rest(inner);
                    Ok::<(), ParseError<'_, ()>>(())
                });
                Piece::Attribute(parser.slice_from(start).replace('\'', "\""))
            }
            _ => Piece::Other,
        };
        if space {
            if !out.is_empty() && !matches!(out.last(), Some(Piece::Combinator(_))) {
                out.push(Piece::Combinator(' '));
            }
            space = false;
        }
        out.push(piece);
    }
    out
}

fn pseudo<'i>(parser: &mut Parser<'i, '_>, start: cssparser::SourcePosition) -> Piece {
    let mut element = false;
    let mut token = match parser.next_including_whitespace() {
        Ok(token) => token.clone(),
        Err(_) => return Piece::Other,
    };
    if matches!(token, Token::Colon) {
        element = true;
        token = match parser.next_including_whitespace() {
            Ok(token) => token.clone(),
            Err(_) => return Piece::Other,
        };
    }
    match token {
        Token::Ident(name) => {
            if !element && name.eq_ignore_ascii_case("global") {
                return Piece::BareGlobal;
            }
            Piece::Pseudo(parser.slice_from(start).to_string())
        }
        Token::Function(name) => {
            let mut inner_text = String::new();
            let _ = parser.parse_nested_block(|inner| {
                inner_text = rest(inner).trim().to_string();
                Ok::<(), ParseError<'_, ()>>(())
            });
            if !element && name.eq_ignore_ascii_case("global") {
                return if inner_text.is_empty() { Piece::BareGlobal } else { Piece::Global(inner_text) };
            }
            if !element
                && name.eq_ignore_ascii_case("not")
                && (inner_text.starts_with("#\\") || inner_text.starts_with("#_"))
            {
                return Piece::Boost;
            }
            Piece::Pseudo(parser.slice_from(start).to_string())
        }
        _ => Piece::Other,
    }
}
