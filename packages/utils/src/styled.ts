import { parseSync } from '@swc/core';
import * as path from 'path';
import { getLeadingCommentLength } from './ast';
import { DEFAULT_STYLE_PROP } from './constants';
import { resolveImportPath } from './resolver';
import { readRawSource } from './sourceCache';

export const REACT = '@plumeria/react';
const CORE = '@plumeria/core';
const PREFIX = '__styled';

let currentStyleProp = DEFAULT_STYLE_PROP;

export function setStyleProp(styleProp: string): void {
  if (styleProp) currentStyleProp = styleProp;
}

export function styleProp(): string {
  return currentStyleProp;
}

type Span = { start: number; end: number };

const fail = (message: string): never => {
  const error = new Error(`[plumeria] ${message}`);
  error.stack = error.message;
  throw error;
};

type Parsed = { ast: any; buffer: Buffer; base: number };

function parse(source: string, file: string): Parsed {
  const ast = parseSync(source, {
    syntax: 'typescript',
    tsx: !['.ts', '.mts', '.cts'].some((ext) => file.endsWith(ext)),
    target: 'es2022',
  });
  const leading = Buffer.byteLength(
    source.slice(0, getLeadingCommentLength(source)),
    'utf-8',
  );
  return {
    ast,
    buffer: Buffer.from(source, 'utf-8'),
    base: ast.span.start - leading,
  };
}

const text = (parsed: Parsed, span: Span): string =>
  parsed.buffer
    .subarray(span.start - parsed.base, span.end - parsed.base)
    .toString('utf-8');

const offset = (parsed: Parsed, position: number): number =>
  position - parsed.base;

const unparen = (node: any): any =>
  node?.type === 'ParenthesisExpression' ? unparen(node.expression) : node;

const exportName = (node: any): string => node.value;

type ImportSpec = {
  kind: 'named' | 'default' | 'namespace';
  local: string;
  imported: string;
  typeOnly: boolean;
};

function importSpecs(decl: any): ImportSpec[] {
  return (decl.specifiers ?? []).map((spec: any): ImportSpec => {
    if (spec.type === 'ImportDefaultSpecifier')
      return {
        kind: 'default',
        local: spec.local.value,
        imported: 'default',
        typeOnly: false,
      };
    if (spec.type === 'ImportNamespaceSpecifier')
      return {
        kind: 'namespace',
        local: spec.local.value,
        imported: '*',
        typeOnly: false,
      };
    return {
      kind: 'named',
      local: spec.local.value,
      imported: spec.imported ? exportName(spec.imported) : spec.local.value,
      typeOnly: !!spec.isTypeOnly,
    };
  });
}

const SKIP_KEYS = new Set([
  'span',
  'ctxt',
  'typeAnnotation',
  'typeParameters',
  'typeArguments',
  'returnType',
  'typeParams',
  'superTypeParams',
  'implements',
]);

const TS_EXPRESSIONS = new Set([
  'TsAsExpression',
  'TsSatisfiesExpression',
  'TsNonNullExpression',
  'TsTypeAssertion',
  'TsConstAssertion',
  'TsInstantiation',
]);

const isIntrinsicJsx = (name: string) =>
  /^[a-z]/.test(name) || name.includes('-');

function patternNames(node: any, out: Set<string>): void {
  if (!node) return;
  switch (node.type) {
    case 'Identifier':
      out.add(node.value);
      return;
    case 'Parameter':
      patternNames(node.pat, out);
      return;
    case 'TsParameterProperty':
      patternNames(node.param, out);
      return;
    case 'ObjectPattern':
      for (const property of node.properties) {
        if (property.type === 'KeyValuePatternProperty')
          patternNames(property.value, out);
        else if (property.type === 'AssignmentPatternProperty')
          out.add(property.key.value);
        else patternNames(property, out);
      }
      return;
    case 'ArrayPattern':
      for (const element of node.elements) patternNames(element, out);
      return;
    case 'AssignmentPattern':
      patternNames(node.left, out);
      return;
    case 'RestElement':
      patternNames(node.argument, out);
      return;
  }
}

function declarationNames(node: any, out: Set<string>, lexicalOnly: boolean) {
  switch (node?.type) {
    case 'VariableDeclaration':
      if (lexicalOnly && node.kind === 'var') return;
      for (const declarator of node.declarations)
        patternNames(declarator.id, out);
      return;
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      out.add(node.identifier.value);
      return;
    case 'TsEnumDeclaration':
      out.add(node.id.value);
      return;
    case 'TsModuleDeclaration':
      if (node.id?.type === 'Identifier') out.add(node.id.value);
      return;
    case 'TsImportEqualsDeclaration':
      if (!node.isTypeOnly) out.add(node.id.value);
      return;
  }
}

function lexicalNames(statements: any[]): Set<string> {
  const out = new Set<string>();
  for (const statement of statements) {
    if (statement?.type === 'ExportDeclaration')
      declarationNames(statement.declaration, out, true);
    else declarationNames(statement, out, true);
  }
  return out;
}

function hoistedNames(node: any, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) hoistedNames(item, out);
    return;
  }
  switch (node.type) {
    case 'VariableDeclaration':
      if (node.kind === 'var')
        for (const declarator of node.declarations)
          patternNames(declarator.id, out);
      return;
    case 'BlockStatement':
      hoistedNames(node.stmts, out);
      return;
    case 'IfStatement':
      hoistedNames(node.consequent, out);
      hoistedNames(node.alternate, out);
      return;
    case 'ForStatement':
      hoistedNames(node.init, out);
      hoistedNames(node.body, out);
      return;
    case 'ForInStatement':
    case 'ForOfStatement':
      hoistedNames(node.left, out);
      hoistedNames(node.body, out);
      return;
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'LabeledStatement':
    case 'WithStatement':
      hoistedNames(node.body, out);
      return;
    case 'TryStatement':
      hoistedNames(node.block, out);
      hoistedNames(node.handler?.body, out);
      hoistedNames(node.finalizer, out);
      return;
    case 'SwitchStatement':
      for (const branch of node.cases) hoistedNames(branch.consequent, out);
      return;
    case 'ExportDeclaration':
      hoistedNames(node.declaration, out);
      return;
  }
}

type Hooks = {
  reference?: (name: string, depth: number) => void;
  member?: (node: any, walker: Walker) => boolean;
  enter?: (node: any) => void;
};

class Walker {
  scopes: Set<string>[] = [];

  constructor(private hooks: Hooks) {}

  depth(name: string): number {
    for (let index = this.scopes.length - 1; index >= 0; index--) {
      if (this.scopes[index].has(name)) return index;
    }
    return -1;
  }

  scoped(names: Set<string>, run: () => void): void {
    this.scopes.push(names);
    try {
      run();
    } finally {
      this.scopes.pop();
    }
  }

  reference(name: string): void {
    this.hooks.reference?.(name, this.depth(name));
  }

  key(key: any): void {
    if (key?.type === 'Computed') this.walk(key.expression);
  }

  pattern(node: any): void {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        return;
      case 'Parameter':
        this.walk(node.decorators);
        this.pattern(node.pat);
        return;
      case 'TsParameterProperty':
        this.walk(node.decorators);
        this.pattern(node.param);
        return;
      case 'ObjectPattern':
        for (const property of node.properties) {
          if (property.type === 'KeyValuePatternProperty') {
            this.key(property.key);
            this.pattern(property.value);
          } else if (property.type === 'AssignmentPatternProperty') {
            this.walk(property.value);
          } else this.pattern(property);
        }
        return;
      case 'ArrayPattern':
        for (const element of node.elements) this.pattern(element);
        return;
      case 'AssignmentPattern':
        this.pattern(node.left);
        this.walk(node.right);
        return;
      case 'RestElement':
        this.pattern(node.argument);
        return;
      default:
        this.walk(node);
    }
  }

  statements(statements: any[]): void {
    for (const statement of statements) this.walk(statement);
  }

  block(statements: any[]): void {
    this.scoped(lexicalNames(statements), () => this.statements(statements));
  }

  fn(node: any): void {
    const params: any[] = node.params ?? (node.param ? [node.param] : []);
    const names = new Set<string>();
    for (const param of params) patternNames(param, names);
    if (node.type === 'FunctionExpression' && node.identifier)
      names.add(node.identifier.value);
    const body = node.body;
    this.walk(node.decorators);
    this.scoped(names, () => {
      for (const param of params) this.pattern(param);
      if (body?.type !== 'BlockStatement') {
        this.walk(body);
        return;
      }
      const locals = new Set<string>();
      hoistedNames(body.stmts, locals);
      for (const name of lexicalNames(body.stmts)) locals.add(name);
      this.scoped(locals, () => this.statements(body.stmts));
    });
  }

  cls(node: any): void {
    const names = new Set<string>();
    if (node.type === 'ClassExpression' && node.identifier)
      names.add(node.identifier.value);
    this.walk(node.decorators);
    this.scoped(names, () => {
      this.walk(node.superClass);
      for (const member of node.body ?? []) {
        switch (member.type) {
          case 'ClassMethod':
          case 'PrivateMethod':
            this.key(member.key);
            this.fn(member.function);
            break;
          case 'Constructor':
            this.key(member.key);
            this.fn(member);
            break;
          case 'ClassProperty':
          case 'PrivateProperty':
            this.walk(member.decorators);
            this.key(member.key);
            this.walk(member.value);
            break;
          case 'StaticBlock':
            this.block(member.body.stmts);
            break;
          default:
            this.walk(member);
        }
      }
    });
  }

  jsxName(name: any): void {
    if (name?.type === 'Identifier') {
      if (!isIntrinsicJsx(name.value)) this.reference(name.value);
    } else if (name?.type === 'JSXMemberExpression') this.jsxName(name.object);
  }

  walk(node: any): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) this.walk(item);
      return;
    }
    if (typeof node.type !== 'string') {
      for (const key of Object.keys(node))
        if (!SKIP_KEYS.has(key)) this.walk(node[key]);
      return;
    }
    this.hooks.enter?.(node);
    switch (node.type) {
      case 'Identifier':
        this.reference(node.value);
        return;
      case 'MemberExpression':
        if (this.hooks.member?.(node, this)) return;
        this.walk(node.object);
        if (node.property.type === 'Computed')
          this.walk(node.property.expression);
        return;
      case 'SuperPropExpression':
        if (node.property.type === 'Computed')
          this.walk(node.property.expression);
        return;
      case 'KeyValueProperty':
        this.key(node.key);
        this.walk(node.value);
        return;
      case 'KeyValuePatternProperty':
        this.key(node.key);
        this.walk(node.value);
        return;
      case 'AssignmentPatternProperty':
        this.reference(node.key.value);
        this.walk(node.value);
        return;
      case 'MethodProperty':
      case 'GetterProperty':
      case 'SetterProperty':
        this.key(node.key);
        this.fn(node);
        return;
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
      case 'FunctionDeclaration':
        this.fn(node);
        return;
      case 'ClassDeclaration':
      case 'ClassExpression':
        this.cls(node);
        return;
      case 'BlockStatement':
        this.block(node.stmts);
        return;
      case 'VariableDeclaration':
        for (const declarator of node.declarations) {
          this.pattern(declarator.id);
          this.walk(declarator.init);
        }
        return;
      case 'ForStatement': {
        const names = new Set<string>();
        declarationNames(node.init, names, true);
        this.scoped(names, () => {
          this.walk(node.init);
          this.walk(node.test);
          this.walk(node.update);
          this.walk(node.body);
        });
        return;
      }
      case 'ForInStatement':
      case 'ForOfStatement': {
        const names = new Set<string>();
        declarationNames(node.left, names, true);
        this.scoped(names, () => {
          this.walk(node.left);
          this.walk(node.right);
          this.walk(node.body);
        });
        return;
      }
      case 'CatchClause': {
        const names = new Set<string>();
        patternNames(node.param, names);
        for (const name of lexicalNames(node.body.stmts)) names.add(name);
        this.scoped(names, () => {
          this.pattern(node.param);
          this.statements(node.body.stmts);
        });
        return;
      }
      case 'SwitchStatement':
        this.walk(node.discriminant);
        this.scoped(
          lexicalNames(node.cases.flatMap((branch: any) => branch.consequent)),
          () => {
            for (const branch of node.cases) {
              this.walk(branch.test);
              this.statements(branch.consequent);
            }
          },
        );
        return;
      case 'LabeledStatement':
        this.walk(node.body);
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'JSXClosingElement':
        return;
      case 'ExportNamedDeclaration':
        if (!node.source)
          for (const spec of node.specifiers)
            if (
              spec.type === 'ExportSpecifier' &&
              spec.orig.type === 'Identifier'
            )
              this.reference(spec.orig.value);
        return;
      case 'JSXOpeningElement':
        this.jsxName(node.name);
        this.walk(node.attributes);
        return;
      case 'JSXAttribute':
        this.walk(node.value);
        return;
      case 'TsParameterProperty':
        this.pattern(node.param);
        return;
    }
    if (TS_EXPRESSIONS.has(node.type)) {
      this.walk(node.expression);
      return;
    }
    if (node.type.startsWith('Ts')) return;
    for (const key of Object.keys(node))
      if (!SKIP_KEYS.has(key)) this.walk(node[key]);
  }
}

const KEYED = new Set([
  'KeyValueProperty',
  'KeyValuePatternProperty',
  'MethodProperty',
  'GetterProperty',
  'SetterProperty',
  'ClassProperty',
  'ClassMethod',
  'PrivateMethod',
  'PrivateProperty',
  'Constructor',
  'TsPropertySignature',
  'TsMethodSignature',
  'TsGetterSignature',
  'TsSetterSignature',
]);

function collectNames(node: any, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectNames(item, out);
    return;
  }
  const record = (name: any) => {
    if (typeof name === 'string' && name.startsWith(PREFIX)) out.add(name);
  };
  switch (node.type) {
    case 'Identifier':
      record(node.value);
      return;
    case 'ImportSpecifier':
      record(node.local.value);
      if (node.imported) record(node.imported.value);
      return;
    case 'ExportSpecifier':
      record(node.orig.value);
      if (node.exported) record(node.exported.value);
      return;
    case 'ExportNamespaceSpecifier':
    case 'ExportDefaultSpecifier':
      record((node.name ?? node.exported)?.value);
      return;
    case 'MemberExpression':
    case 'SuperPropExpression':
      collectNames(node.object, out);
      if (node.property.type === 'Computed')
        collectNames(node.property.expression, out);
      return;
    case 'LabeledStatement':
      collectNames(node.body, out);
      return;
    case 'BreakStatement':
    case 'ContinueStatement':
      return;
    case 'JSXAttribute':
      collectNames(node.value, out);
      return;
    case 'JSXOpeningElement':
    case 'JSXClosingElement':
      if (
        !(node.name?.type === 'Identifier' && isIntrinsicJsx(node.name.value))
      )
        collectNames(node.name, out);
      collectNames(node.attributes, out);
      return;
    case 'JSXMemberExpression':
      collectNames(node.object, out);
      return;
    case 'TsEnumMember':
      collectNames(node.init, out);
      return;
    case 'TsQualifiedName':
      collectNames(node.left, out);
      return;
  }
  const keyed = KEYED.has(node.type);
  for (const key of Object.keys(node)) {
    if (key === 'span' || key === 'ctxt') continue;
    if (keyed && key === 'key') {
      if (node.key?.type === 'Computed') collectNames(node.key.expression, out);
      continue;
    }
    collectNames(node[key], out);
  }
}

function prefixOf(ast: any): string {
  const names = new Set<string>();
  collectNames(ast.body, names);
  for (let index = 0; ; index++) {
    const prefix = index === 0 ? PREFIX : `${PREFIX}${index}`;
    const lead = `${prefix}_`;
    if (![...names].some((name) => name.startsWith(lead))) return prefix;
  }
}

function propertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

type Dyn = { path: string[]; leaf: string; fn: string; reads: string[] };
type Rule = { statics: string[]; dyns: Dyn[] };
type Target =
  | { kind: 'tag'; tag: string }
  | { kind: 'local'; name: string }
  | { kind: 'import'; source: string; name: string };
type Def = {
  name: string;
  statementStart: number;
  init: Span;
  target: Target;
  rule: Rule;
};
type Layer = { binding: string; hasBase: boolean; fns: string[][] };
type Chain = { tag: string; layers: Layer[] };

const arrowMessage = (label: string) =>
  `"${label}" must be an arrow function with an expression body, as in (props) => props.value.`;

function dynamicReads(
  fn: any,
  label: string,
  definitions: Set<string>,
): string[] {
  if (fn.type !== 'ArrowFunctionExpression') return fail(arrowMessage(label));
  if (fn.body?.type === 'BlockStatement') return fail(arrowMessage(label));
  const params: any[] = fn.params;
  if (params.length !== 1 || params[0].type === 'RestElement')
    return fail(
      `"${label}" must take exactly one parameter, the component props.`,
    );
  const pattern = params[0];
  let param: string | undefined;
  let reads: string[] = [];
  if (pattern.type === 'Identifier') {
    param = pattern.value;
  } else if (pattern.type === 'ObjectPattern') {
    if (pattern.properties.some((p: any) => p.type === 'RestElement'))
      return fail(
        `"${label}" cannot use a rest element in its parameter. Name each prop it reads.`,
      );
    for (const property of pattern.properties) {
      const key = property.key;
      if (key?.type !== 'Identifier')
        return fail(`"${label}" must destructure props by name.`);
      const nested =
        property.type === 'KeyValuePatternProperty'
          ? property.value.type !== 'Identifier'
          : property.value != null;
      if (nested)
        return fail(
          `"${label}" cannot use a default value or a nested pattern in its parameter.`,
        );
      reads.push(key.value);
    }
  } else {
    return fail(
      `"${label}" must take the props as one name or as a destructured object.`,
    );
  }

  let bare = 0;
  let branches = false;
  let definition: string | undefined;
  const members: string[] = [];
  const walker = new Walker({
    reference: (name, depth) => {
      if (param !== undefined && name === param && depth === 0) bare++;
      else if (
        definition === undefined &&
        depth === -1 &&
        definitions.has(name)
      )
        definition = name;
    },
    member: (node, walker) => {
      const object = unparen(node.object);
      if (
        param === undefined ||
        object?.type !== 'Identifier' ||
        object.value !== param ||
        walker.depth(param) !== 0
      )
        return false;
      if (node.property.type !== 'Computed') {
        const name = node.property.value;
        if (!members.includes(name)) members.push(name);
        return true;
      }
      return false;
    },
    enter: (node) => {
      if (
        node.type === 'ConditionalExpression' ||
        (node.type === 'BinaryExpression' &&
          (node.operator === '&&' ||
            node.operator === '||' ||
            node.operator === '??'))
      )
        branches = true;
    },
  });
  walker.fn(fn);
  if (definition !== undefined)
    return fail(
      `"${label}" reads the Plumeria definition "${definition}", which has no value at runtime. Read it in a static value of the rule instead.`,
    );
  if (branches)
    return fail(
      `"${label}" branches its value. A value that may or may not override cannot be resolved at build time; split the variants into separate styled components.`,
    );
  if (param !== undefined) {
    if (bare > 0)
      return fail(`"${label}" must read props by name, as in ${param}.value.`);
    reads = members;
  }
  return reads;
}

function keyText(parsed: Parsed, key: any): string {
  if (key.type === 'Computed') return `[${text(parsed, key.expression.span)}]`;
  return text(parsed, key.span);
}

function splitRule(
  parsed: Parsed,
  object: any,
  path: string[],
  definitions: Set<string>,
  rule: Rule,
  statics: string[],
): void {
  for (const property of object.properties) {
    if (property.type === 'SpreadElement') {
      statics.push(
        text(parsed, {
          start: property.spread.start,
          end: property.arguments.span.end,
        }),
      );
      continue;
    }
    if (property.type === 'Identifier') {
      statics.push(text(parsed, property.span));
      continue;
    }
    if (property.type !== 'KeyValueProperty')
      fail('A styled rule cannot hold methods or accessors.');
    const key = keyText(parsed, property.key);
    const selector =
      property.key.type === 'Computed' ||
      /^[:[@]/.test(key.replace(/^['"]+/, ''));
    const value = unparen(property.value);
    if (
      value.type === 'ArrowFunctionExpression' ||
      value.type === 'FunctionExpression'
    ) {
      const label = [...path, key].join(' ');
      const reads = dynamicReads(value, label, definitions);
      rule.dyns.push({
        path: [...path],
        leaf: key,
        fn: text(parsed, value.span),
        reads,
      });
    } else if (value.type === 'ObjectExpression' && selector) {
      const nested: string[] = [];
      splitRule(parsed, value, [...path, key], definitions, rule, nested);
      if (nested.length) statics.push(`${key}: { ${nested.join(', ')} }`);
    } else {
      statics.push(
        text(parsed, {
          start: property.key.span.start,
          end: property.value.span.end,
        }),
      );
    }
  }
}

function styledTarget(
  parsed: Parsed,
  callee: any,
  styled: Set<string>,
  imports: Map<string, [string, string]>,
): Target | undefined {
  callee = unparen(callee);
  if (callee?.type === 'MemberExpression') {
    const object = unparen(callee.object);
    if (
      object?.type === 'Identifier' &&
      styled.has(object.value) &&
      callee.property.type === 'Identifier'
    )
      return { kind: 'tag', tag: callee.property.value };
    return undefined;
  }
  if (callee?.type === 'CallExpression') {
    const inner = unparen(callee.callee);
    if (inner?.type !== 'Identifier' || !styled.has(inner.value))
      return undefined;
    const argument =
      callee.arguments.length === 1 && !callee.arguments[0].spread
        ? callee.arguments[0].expression
        : undefined;
    const component = unparen(argument);
    if (component?.type !== 'Identifier') {
      const label = argument ? text(parsed, argument.span) : '';
      return fail(
        `styled(${label}) must name a styled component directly. A component chosen at runtime cannot be resolved at build time.`,
      );
    }
    const name = component.value;
    const imported = imports.get(name);
    return imported
      ? { kind: 'import', source: imported[0], name: imported[1] }
      : { kind: 'local', name };
  }
  return undefined;
}

function definitionsOf(ast: any): Set<string> {
  const namespaces = new Set<string>();
  const named = new Set<string>();
  for (const statement of ast.body) {
    if (
      statement.type !== 'ImportDeclaration' ||
      statement.source.value !== CORE
    )
      continue;
    for (const spec of importSpecs(statement)) {
      if (spec.kind === 'named') named.add(spec.local);
      else namespaces.add(spec.local);
    }
  }
  const names = new Set<string>();
  for (const declaration of topLevelDeclarations(ast)) {
    for (const declarator of declaration.declarations) {
      const init = unparen(declarator.init);
      if (init?.type !== 'CallExpression') continue;
      const callee = unparen(init.callee);
      const core =
        callee?.type === 'MemberExpression'
          ? callee.property.type !== 'Computed' &&
            unparen(callee.object)?.type === 'Identifier' &&
            namespaces.has(unparen(callee.object).value)
          : callee?.type === 'Identifier' && named.has(callee.value);
      if (core && declarator.id.type === 'Identifier')
        names.add(declarator.id.value);
    }
  }
  return names;
}

function* topLevelDeclarations(ast: any): Generator<any> {
  for (const statement of ast.body) {
    if (statement.type === 'VariableDeclaration') yield statement;
    else if (
      statement.type === 'ExportDeclaration' &&
      statement.declaration.type === 'VariableDeclaration'
    )
      yield statement.declaration;
  }
}

type Analysis = {
  file: string;
  prefix: string;
  reactImports: Span[];
  defs: Def[];
  exports: [string, string][];
};

function analyze(parsed: Parsed, file: string): Analysis | undefined {
  const { ast } = parsed;
  const styled = new Set<string>();
  const reactImports: Span[] = [];
  const imports = new Map<string, [string, string]>();
  for (const statement of ast.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    const from: string = statement.source.value;
    if (from === REACT) {
      if (statement.typeOnly) continue;
      let binds = false;
      for (const spec of importSpecs(statement)) {
        if (spec.typeOnly) continue;
        if (spec.kind === 'named') {
          if (spec.imported === 'styled') {
            styled.add(spec.local);
            binds = true;
          }
        } else {
          fail(
            `Import styled from "${REACT}" by name, as in import { styled } from "${REACT}".`,
          );
        }
      }
      if (binds) reactImports.push(statement.span);
      continue;
    }
    for (const spec of importSpecs(statement)) {
      if (spec.kind !== 'namespace' && !spec.typeOnly)
        imports.set(spec.local, [from, spec.imported]);
    }
  }
  if (styled.size === 0) return undefined;
  const definitions = definitionsOf(ast);

  const defs: Def[] = [];
  const exports: [string, string][] = [];
  for (const statement of ast.body) {
    let declaration: any;
    let exported = false;
    if (statement.type === 'VariableDeclaration') declaration = statement;
    else if (
      statement.type === 'ExportDeclaration' &&
      statement.declaration.type === 'VariableDeclaration'
    ) {
      declaration = statement.declaration;
      exported = true;
    } else if (
      statement.type === 'ExportNamedDeclaration' &&
      !statement.source
    ) {
      for (const spec of statement.specifiers) {
        if (spec.type !== 'ExportSpecifier') continue;
        const local = exportName(spec.orig);
        exports.push([
          local,
          spec.exported ? exportName(spec.exported) : local,
        ]);
      }
      continue;
    } else if (statement.type === 'ExportDefaultExpression') {
      const value = unparen(statement.expression);
      if (value?.type === 'Identifier') exports.push([value.value, 'default']);
      else if (
        value?.type === 'CallExpression' &&
        styledTarget(parsed, value.callee, styled, imports)
      )
        fail(
          'A default export of styled needs a name. Declare it as const Button = styled.button({...}), then export default Button.',
        );
      continue;
    } else continue;
    for (const declarator of declaration.declarations) {
      const call = unparen(declarator.init);
      if (call?.type !== 'CallExpression') continue;
      const target = styledTarget(parsed, call.callee, styled, imports);
      if (!target) continue;
      if (declarator.id.type !== 'Identifier')
        fail(
          'A styled component must be bound to one name, as in const Button = styled.button({...}).',
        );
      const name: string = declarator.id.value;
      if (declaration.kind !== 'const')
        fail(
          `Declare "${name}" with const. A styled component cannot be reassigned.`,
        );
      const argument =
        call.arguments.length === 1 && !call.arguments[0].spread
          ? unparen(call.arguments[0].expression)
          : undefined;
      if (argument?.type !== 'ObjectExpression')
        fail(`"${name}" must pass its rule as an object literal.`);
      const rule: Rule = { statics: [], dyns: [] };
      const statics: string[] = [];
      splitRule(parsed, argument, [], definitions, rule, statics);
      rule.statics = statics;
      if (exported) exports.push([name, name]);
      defs.push({
        name,
        statementStart: statement.span.start,
        init: call.span,
        target,
        rule,
      });
    }
  }

  let count = 0;
  new Walker({
    reference: (name, depth) => {
      if (depth === -1 && styled.has(name)) count++;
    },
  }).statements(ast.body);
  if (count !== defs.length)
    fail(
      'styled can only be called at the top level, as in const Button = styled.button({...}).',
    );

  const defined = new Set(defs.map((def) => def.name));
  return {
    file,
    prefix: prefixOf(ast),
    reactImports,
    defs,
    exports: exports.filter(([local]) => defined.has(local)),
  };
}

const localForExport = (analysis: Analysis, exported: string) =>
  analysis.exports.find(([, name]) => name === exported)?.[0];

class Imports {
  bySource: [string, [string, string][]][] = [];

  add(source: string, imported: string, local: string): void {
    const entry = this.bySource.find(([from]) => from === source);
    if (entry) entry[1].push([imported, local]);
    else this.bySource.push([source, [[imported, local]]]);
  }
}

function encodeName(name: string): string {
  let out = '';
  for (const c of name) {
    if (/^[A-Za-z0-9_]$/.test(c)) out += c;
    else out += `$${c.codePointAt(0)!.toString(16)}$`;
  }
  return out;
}

const MAX_STYLED_DEPTH = 16;

const tooDeep = (): never =>
  fail(
    `Styled inheritance exceeds ${MAX_STYLED_DEPTH} levels (including the base component).`,
  );

const layerName = (prefix: string, component: string, index: number) =>
  `${prefix}_${encodeName(component)}__${index}`;

class Chains {
  memo = new Map<string, Chain>();

  constructor(
    private analysis: Analysis,
    public visiting: [string, string][],
    private imports: Imports | undefined,
  ) {}

  chain(name: string, depth: number): Chain {
    if (depth > MAX_STYLED_DEPTH) tooDeep();
    const memo = this.memo.get(name);
    if (memo) {
      if (depth - 1 + memo.layers.length > MAX_STYLED_DEPTH) tooDeep();
      return structuredClone(memo);
    }
    const file = this.analysis.file;
    if (this.visiting.some(([f, n]) => f === file && n === name))
      fail(`"${name}" extends itself.`);
    const def = this.analysis.defs.find((d) => d.name === name);
    if (!def)
      return fail(
        `"${name}" is not a styled component. styled() accepts only components defined with styled.`,
      );
    this.visiting.push([file, name]);
    let base: Chain;
    const target = def.target;
    if (target.kind === 'tag') base = { tag: target.tag, layers: [] };
    else if (target.kind === 'local') base = this.chain(target.name, depth + 1);
    else {
      const foreign = foreignChain(
        target.source,
        target.name,
        file,
        this.visiting,
        depth + 1,
      );
      const layers: Layer[] = [];
      foreign.chain.layers.forEach((layer, index) => {
        const local = layerName(this.analysis.prefix, def.name, index);
        if (this.imports) {
          const exported = layerName(foreign.prefix, foreign.exported, index);
          this.imports.add(foreign.specifier, exported, local);
          layer.fns.forEach((_, fn) =>
            this.imports!.add(
              foreign.specifier,
              `${exported}$${fn}`,
              `${local}$${fn}`,
            ),
          );
        }
        layers.push({ ...layer, binding: local });
      });
      base = { tag: foreign.chain.tag, layers };
    }
    this.visiting.pop();
    const chain = base;
    chain.layers.push({
      binding: layerName(this.analysis.prefix, def.name, chain.layers.length),
      hasBase: def.rule.statics.length > 0,
      fns: def.rule.dyns.map((d) => [...d.reads]),
    });
    this.memo.set(name, structuredClone(chain));
    return chain;
  }
}

type Resolved =
  | { kind: 'found'; file: string; exported: string; local: string }
  | { kind: 'missing' }
  | { kind: 'unreadable'; file: string; message: string }
  | { kind: 'ambiguous' };

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const MISSING: Resolved = { kind: 'missing' };

function resolveExport(
  file: string,
  exported: string,
  trail: [string, string][],
): Resolved {
  if (trail.some(([f, n]) => f === file && n === exported)) return MISSING;
  let parsed: Parsed;
  try {
    parsed = parse(readRawSource(file), file);
  } catch (error) {
    return { kind: 'unreadable', file, message: errorMessage(error) };
  }
  trail.push([file, exported]);
  try {
    return resolveIn(file, parsed.ast, exported, trail);
  } finally {
    trail.pop();
  }
}

function resolveIn(
  file: string,
  ast: any,
  exported: string,
  trail: [string, string][],
): Resolved {
  const found = (local: string): Resolved => ({
    kind: 'found',
    file,
    exported,
    local,
  });
  const imports = new Map<string, [string, string]>();
  const values = new Set<string>();
  for (const statement of ast.body) {
    if (statement.type === 'ImportDeclaration') {
      if (statement.typeOnly) continue;
      for (const spec of importSpecs(statement)) {
        if (spec.typeOnly) continue;
        values.add(spec.local);
        if (spec.kind !== 'namespace')
          imports.set(spec.local, [statement.source.value, spec.imported]);
      }
    } else if (statement.type === 'ExportDeclaration') {
      declarationNames(statement.declaration, values, false);
    } else if (statement.type === 'ExportDefaultDeclaration') {
      const decl = statement.decl;
      if (
        (decl.type === 'FunctionExpression' ||
          decl.type === 'ClassExpression') &&
        decl.identifier
      )
        values.add(decl.identifier.value);
    } else {
      declarationNames(statement, values, false);
    }
  }
  const follow = (from: string, name: string): Resolved => {
    const next = resolveImportPath(from, file);
    return next ? resolveExport(next, name, trail) : MISSING;
  };
  const stars: string[] = [];
  for (const statement of ast.body) {
    switch (statement.type) {
      case 'ExportDeclaration': {
        const names = new Set<string>();
        declarationNames(statement.declaration, names, false);
        if (names.has(exported)) return found(exported);
        break;
      }
      case 'ExportDefaultDeclaration':
        if (exported === 'default') return found('default');
        break;
      case 'ExportDefaultExpression': {
        if (exported !== 'default') break;
        const value = unparen(statement.expression);
        const imported =
          value?.type === 'Identifier' ? imports.get(value.value) : undefined;
        return imported ? follow(imported[0], imported[1]) : found('default');
      }
      case 'ExportNamedDeclaration': {
        if (statement.typeOnly) break;
        const from: string | undefined = statement.source?.value;
        for (const spec of statement.specifiers) {
          if (spec.type === 'ExportNamespaceSpecifier') {
            if (from !== undefined && exportName(spec.name) === exported)
              return found(`* as ${from}`);
            continue;
          }
          if (spec.type !== 'ExportSpecifier' || spec.isTypeOnly) continue;
          const local = exportName(spec.orig);
          const name = spec.exported ? exportName(spec.exported) : local;
          if (name !== exported) continue;
          if (from !== undefined) return follow(from, local);
          if (!values.has(local)) continue;
          const imported = imports.get(local);
          return imported ? follow(imported[0], imported[1]) : found(local);
        }
        break;
      }
      case 'ExportAllDeclaration':
        if (!statement.typeOnly) stars.push(statement.source.value);
        break;
    }
  }
  if (exported === 'default') return MISSING;
  const bindings: { file: string; exported: string; local: string }[] = [];
  for (const from of stars) {
    const resolved = follow(from, exported);
    if (resolved.kind === 'ambiguous' || resolved.kind === 'unreadable')
      return resolved;
    if (
      resolved.kind === 'found' &&
      !bindings.some(
        (b) => b.file === resolved.file && b.local === resolved.local,
      )
    )
      bindings.push(resolved);
  }
  if (bindings.length === 0) return MISSING;
  if (bindings.length === 1) return { kind: 'found', ...bindings[0] };
  return { kind: 'ambiguous' };
}

function moduleSpecifier(importer: string, file: string): string {
  const relative = path
    .relative(path.dirname(importer), file)
    .split(path.sep)
    .join('/');
  return relative.startsWith('../') ? relative : `./${relative}`;
}

type Foreign = {
  chain: Chain;
  prefix: string;
  specifier: string;
  exported: string;
};

function foreignChain(
  source: string,
  exported: string,
  importer: string,
  visiting: [string, string][],
  depth: number,
): Foreign {
  const notStyled = () =>
    fail(
      `"${exported}" from "${source}" is not a styled component. styled() accepts only components defined with styled.`,
    );
  const unreadable = (file: string, message: string): never =>
    fail(
      `Cannot read "${file}" while resolving "${exported}" from "${source}": ${message}`,
    );
  const file = resolveImportPath(source, importer) ?? notStyled();
  const resolved = resolveExport(file, exported, []);
  if (resolved.kind === 'missing') notStyled();
  if (resolved.kind === 'unreadable')
    unreadable(resolved.file, resolved.message);
  if (resolved.kind === 'ambiguous')
    fail(
      `"${exported}" from "${source}" is exported by more than one export * with different bindings, so it cannot be resolved. Re-export it by name.`,
    );
  const { file: defining, exported: exportedThere } = resolved as {
    file: string;
    exported: string;
  };
  let parsed: Parsed;
  try {
    parsed = parse(readRawSource(defining), defining);
  } catch (error) {
    return unreadable(defining, errorMessage(error));
  }
  const analysis = analyze(parsed, defining) ?? notStyled();
  const local = localForExport(analysis, exportedThere) ?? notStyled();
  const chains = new Chains(analysis, visiting, undefined);
  const chain = chains.chain(local, depth);
  return {
    chain,
    prefix: analysis.prefix,
    specifier: defining === file ? source : moduleSpecifier(importer, defining),
    exported: exportedThere,
  };
}

function dynObject(dynamic: Dyn, prefix: string): string {
  const value = `${prefix}_value`;
  let inner = `{ ${dynamic.leaf}: ${value} }`;
  for (const key of [...dynamic.path].reverse()) inner = `{ ${key}: ${inner} }`;
  return `(${value}) => (${inner})`;
}

function createText(def: Def, binding: string, prefix: string): string {
  const entries: string[] = [];
  if (def.rule.statics.length)
    entries.push(`base: { ${def.rule.statics.join(', ')} }`);
  def.rule.dyns.forEach((dynamic, index) =>
    entries.push(`d${index}: ${dynObject(dynamic, prefix)}`),
  );
  let out = `const ${binding} = ${prefix}_css.create({ ${entries.join(', ')} });\n`;
  def.rule.dyns.forEach((dynamic, index) => {
    out += `const ${binding}$${index} = ${dynamic.fn};\n`;
  });
  return out;
}

function componentText(
  chain: Chain,
  styleProp: string,
  prefix: string,
): string {
  const style = `${prefix}_sx`;
  const rest = `${prefix}_props`;
  const reads: string[] = [];
  const local = (name: string) => `${prefix}_prop${reads.indexOf(name)}`;
  const styles: string[] = [];
  for (const layer of chain.layers) {
    if (layer.hasBase) styles.push(`${layer.binding}.base`);
    layer.fns.forEach((names, index) => {
      for (const name of names) {
        if (name === styleProp)
          fail(`A styled rule cannot read the "${name}" prop.`);
        if (!reads.includes(name)) reads.push(name);
      }
      const argument = names
        .map((name) => `${name}: ${local(name)}`)
        .join(', ');
      styles.push(
        `${layer.binding}.d${index}(${layer.binding}$${index}({ ${argument} }))`,
      );
    });
  }
  styles.push(style);
  const params = [
    `${propertyKey(styleProp)}: ${style}`,
    ...reads.map((name) => `${name}: ${local(name)}`),
    `...${rest}`,
  ];
  return `({ ${params.join(', ')} }) => <${chain.tag} ${styleProp}={[${styles.join(', ')}]} {...${rest}} />`;
}

export function desugar(
  source: string,
  file: string,
  styleProp: string,
): string | undefined {
  if (!source.includes(REACT)) return undefined;
  const parsed = parse(source, file);
  const analysis = analyze(parsed, file);
  if (!analysis) return undefined;
  if (
    analysis.defs.length > 0 &&
    ['.ts', '.mts', '.cts'].some((ext) => file.endsWith(ext))
  )
    fail(
      `styled renders JSX, so it must be used in a .tsx or .jsx file. Rename ${file}.`,
    );

  const imports = new Imports();
  const chains = new Chains(analysis, [], imports);
  const chainsOf = analysis.defs.map((def) => chains.chain(def.name, 1));

  const prefix = analysis.prefix;
  const edits: [number, number, string][] = [];
  let header = `import * as ${prefix}_css from '@plumeria/core';`;
  for (const [from, specs] of imports.bySource) {
    const list = specs
      .map(([imported, local]) => `${imported} as ${local}`)
      .join(', ');
    header += `\nimport { ${list} } from '${from}';`;
  }
  analysis.reactImports.forEach((span, index) =>
    edits.push([
      offset(parsed, span.start),
      offset(parsed, span.end),
      index === 0 ? header : '',
    ]),
  );
  analysis.defs.forEach((def, index) => {
    const chain = chainsOf[index];
    const own = chain.layers[chain.layers.length - 1];
    const start = offset(parsed, def.statementStart);
    edits.push([start, start, createText(def, own.binding, prefix)]);
    edits.push([
      offset(parsed, def.init.start),
      offset(parsed, def.init.end),
      componentText(chain, styleProp, prefix),
    ]);
  });

  const exports: string[] = [];
  for (const [local, exported] of analysis.exports) {
    const index = analysis.defs.findIndex((def) => def.name === local);
    chainsOf[index].layers.forEach((layer, layerIndex) => {
      const name = layerName(prefix, exported, layerIndex);
      exports.push(`${layer.binding} as ${name}`);
      layer.fns.forEach((_, fn) =>
        exports.push(`${layer.binding}$${fn} as ${name}$${fn}`),
      );
    });
  }

  edits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const pieces: string[] = [];
  let cursor = 0;
  for (const [start, end, replacement] of edits) {
    pieces.push(parsed.buffer.subarray(cursor, start).toString('utf-8'));
    pieces.push(replacement);
    cursor = end;
  }
  pieces.push(parsed.buffer.subarray(cursor).toString('utf-8'));
  let out = pieces.join('');
  if (exports.length) out += `\nexport { ${exports.join(', ')} };\n`;
  return out;
}
