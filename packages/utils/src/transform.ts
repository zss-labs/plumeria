import { parseSync } from '@swc/core';
import type {
  Expression,
  HasSpan,
  ImportSpecifier,
  ImportDeclaration,
  Module,
  ObjectExpression,
  Identifier,
  CallExpression,
  VariableDeclaration,
  VariableDeclarator,
  JSXAttributeOrSpread,
  JSXAttribute,
  SpreadElement,
  ExportDeclaration,
  JSXOpeningElement,
  MemberExpression,
  AssignmentExpression,
  ObjectPattern,
  PropertyName,
} from '@swc/core';
import * as path from 'path';
import {
  applyCssValue,
  genBase36Hash,
  camelToKebabCase,
  isAtRule,
} from 'zss-engine';
import type { CSSProperties } from 'zss-engine';
import {
  traverse,
  t,
  getRootIdentifier,
  resolveOriginError,
  unwrapExpression,
  deepMerge,
  scanOverlay,
  fileTableKeys,
  resolveFileError,
  getFileDependencies,
  resolveExport,
  exportNames,
  resolveComponentKey,
  resolveThemeSelector,
  objectExpressionToObject,
  collectLocalConsts,
  collectLocalConstNodes,
} from './parser';
import { componentFunctions, wrappedBindings } from './component';
import { assertNoDroppedValues } from './unresolvableValue';
import { checkedVarTypeHash } from './varType';
import {
  MODULE_SITE,
  collectDeclSites,
  collectSiteScopes,
  insertions,
  usesReservedName,
} from './hoist';
import type { DeclSite } from './hoist';

const spreadValues = (
  tables: Parameters<typeof objectExpressionToObject> extends [
    unknown,
    ...infer Rest,
  ]
    ? Rest
    : never,
  constNodes: Map<string, any>,
  sourceOf: (node: any) => string,
) => {
  const spread = (prop: any) => {
    let values: Record<string, unknown>;
    try {
      values = objectExpressionToObject(
        { properties: [prop] } as unknown as ObjectExpression,
        ...tables,
      ) as Record<string, unknown>;
    } catch {
      return null;
    }

    const argument = prop.arguments;
    const declared =
      argument?.type === 'Identifier'
        ? constNodes.get(argument.value)
        : undefined;
    const source =
      declared && t.isObjectExpression(declared) ? declared : undefined;

    return { values, source };
  };

  const resolvesValue = (value: any) => {
    try {
      const probe = objectExpressionToObject(
        {
          properties: [
            {
              type: 'KeyValueProperty',
              key: { type: 'Identifier', value: '__probe' },
              value,
            },
          ],
        } as unknown as ObjectExpression,
        ...tables,
      ) as Record<string, unknown>;
      return '__probe' in probe;
    } catch {
      return false;
    }
  };

  return { spread, resolvesValue, sourceOf };
};

import { getStyleRecords } from './create';
import {
  styleFunctionsOf,
  resolveDynamicStyle,
  isDefinedArgument,
} from './dynamicKey';
import type {
  NamedParam,
  StyleFunctions,
  DynamicStyleTables,
} from './dynamicKey';
import { getStateWeights } from './escalation';
import type { StyleSource } from './escalation';
import { themeHashOf } from './createTheme';
import { resolveImportPath } from './resolver';
import { getLeadingCommentLength } from './ast';
import { collectReferenceIdentifiers } from './references';
import { resolveNamespaceMembers } from './namespaceImport';
import { assertPropertyPolicy } from './propertyPolicy';
import { desugar } from './styled';
import type { PropertyPolicy } from './propertyPolicy';
import type {
  StaticTable,
  KeyframesHashTable,
  ViewTransitionHashTable,
  VarTypeHashTable,
  PositionTryHashTable,
  CreateHashTable,
  CreateThemeHashTable,
  CreateStaticHashTable,
  CSSObject,
  Condition,
  TableEntry,
} from './types';

type CreateStyleValue = {
  name: string;
  type: 'create' | 'constant';
  obj: CSSObject;
  hashMap: Record<string, Record<string, string>> | CSSObject;
  isExported: boolean;
  initSpan: { start: number; end: number };
  declSpan: { start: number; end: number };
  functions?: Record<
    string,
    {
      params: string[];
      named?: NamedParam[];
      defaults?: Record<string, Expression>;
      body: ObjectExpression;
    }
  >;
};

interface StyleConditional {
  test: Expression;
  testString?: string;
  testLHS?: string;
  truthy: CSSObject;
  falsy: CSSObject;
  groupId?: number;
  groupName?: string;
  valueName?: string;
  varName?: string;
  order?: number;
  closed?: boolean;
}

interface KeyedRow {
  conditions: Condition[];
  key: string;
  fixed: boolean;
  calls?: Expression[];
}

type Span = [number, number];
type Place = { start: number; end: number };
type Host = { at: number; open: number; close: number; braces: boolean };

const spanOf = (node: any): Span => [node.span.start, node.span.end];
const spanKey = ([start, end]: Span) => `${start}:${end}`;

const isIdentifierSource = (source: string) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(source);

const isLiteralSource = (source: string) => {
  const trimmed = source.trim();
  return (
    (trimmed !== '' && !isNaN(Number(trimmed))) ||
    ['"', "'"].some(
      (quote) =>
        trimmed.length >= 2 &&
        trimmed.startsWith(quote) &&
        trimmed.endsWith(quote) &&
        !trimmed.slice(1, -1).includes(quote),
    )
  );
};

const unwrapExport = (node: any): any => {
  if (node?.type === 'ExportDeclaration') return node.declaration;
  if (node?.type === 'ExportDefaultDeclaration') return node.decl;
  if (node?.type === 'ExportDefaultExpression') return node.expression;
  return node;
};

const unwrapPatternDefault = (pattern: any): any =>
  pattern?.type === 'AssignmentPattern' ? pattern.left : pattern;

const destructuredPropAliases = (fn: {
  params: unknown[];
}): Map<string, string> => {
  const aliases = new Map<string, string>();
  const first = fn.params[0] as any;
  const pattern = unwrapPatternDefault(first?.pat ?? first);
  if (pattern?.type !== 'ObjectPattern') return aliases;
  for (const item of pattern.properties ?? []) {
    if (item.type !== 'KeyValuePatternProperty') continue;
    const local = unwrapPatternDefault(item.value);
    const key = item.key;
    if (!t.isIdentifier(local)) continue;
    if (!t.isIdentifier(key) && !t.isStringLiteral(key)) continue;
    const name = String(key.value);
    if (name !== local.value) aliases.set(local.value, name);
  }
  return aliases;
};

const propDefaultMessage = (source: string): string =>
  `[plumeria] A style prop default must be a defined style: "${source}". ` +
  `Apply a conditional or dynamic style where the element is styled.`;

const spreadStyleMessage = (source: string): string =>
  `[plumeria] Spread elements in a style array are not supported: "...${source}". ` +
  `List each style explicitly.`;

type LocalStyleAlias = { expression: Expression; context: number };

const resolveLocalStyleAlias = (
  aliases: Record<string, LocalStyleAlias[]>,
  expression: Expression,
): Expression => {
  let current = expression;
  const seen = new Set<string>();
  while (t.isIdentifier(current)) {
    const name = current.value;
    if (seen.has(name)) break;
    seen.add(name);
    const candidates = aliases[name];
    if (!candidates || candidates.length === 0) break;
    const candidate = candidates.find(
      (candidate) =>
        candidate.context === (current as Identifier & { ctxt: number }).ctxt,
    );
    if (!candidate) break;
    current = candidate.expression;
  }
  return current;
};

const isStaticArgValue = (node: Expression): boolean =>
  node.type === 'StringLiteral' ||
  node.type === 'NumericLiteral' ||
  node.type === 'BooleanLiteral' ||
  (node.type === 'TemplateLiteral' && node.expressions.length === 0) ||
  t.isIdentifier(node) ||
  t.isMemberExpression(node);

const isNoOpStyle = (node: Expression): boolean =>
  t.isNullLiteral(node) ||
  (t.isBooleanLiteral(node) && node.value === false) ||
  (t.isIdentifier(node) && node.value === 'undefined');

type CallBinding = { params: string[]; args: string[] };

type DynamicVar = {
  cssVar: string;
  valueExpr: string;
  test?: string;
  order?: number;
  call?: CallBinding;
};

const staticClass = (part: string): string | undefined => {
  if (part.length < 2 || !part.startsWith('"') || !part.endsWith('"'))
    return undefined;
  const inner = part.slice(1, -1);
  return /["\\]/.test(inner) ? undefined : inner;
};

const classTernary = (part: string) => {
  if (part.length < 2 || !part.startsWith('(') || !part.endsWith(')'))
    return undefined;
  const body = part.slice(1, -1);
  const colon = body.lastIndexOf(' : ');
  if (colon < 0) return undefined;
  const falsy = staticClass(body.slice(colon + 3));
  if (falsy === undefined) return undefined;
  const left = body.slice(0, colon);
  const question = left.lastIndexOf(' ? ');
  if (question < 0) return undefined;
  const truthy = staticClass(left.slice(question + 3));
  if (truthy === undefined) return undefined;
  return { test: left.slice(0, question), truthy, falsy };
};

const generatedTest = (test: string, generated: string[]) => {
  const negated = test.startsWith('!');
  const base = negated ? test.slice(1) : test;
  const name =
    base.length >= 2 && base.startsWith('(') && base.endsWith(')')
      ? base.slice(1, -1)
      : base;
  return generated.includes(name) ? { name, negated } : undefined;
};

const complementary = (first: string, second: string, generated: string[]) => {
  const a = generatedTest(first, generated);
  const b = generatedTest(second, generated);
  return !!a && !!b && a.name === b.name && a.negated !== b.negated;
};

const joinClassParts = (parts: string[], generated: string[]): string => {
  if (!parts.length) return '""';
  const joined = () => parts.join(' + " " + ');
  const ternaries: Array<{
    index: number;
    test: string;
    truthy: string;
    falsy: string;
  }> = [];
  for (const [index, part] of parts.entries()) {
    if (staticClass(part) !== undefined) continue;
    const ternary = classTernary(part);
    if (!ternary) return joined();
    ternaries.push({ index, ...ternary });
  }
  let keys: Array<{ name: string; negated: boolean }>;
  if (ternaries.length === 1) {
    const { test } = ternaries[0];
    keys = [generatedTest(test, generated) ?? { name: test, negated: false }];
  } else {
    const found = ternaries.map(({ test }) => generatedTest(test, generated));
    if (
      found.some((key) => !key) ||
      found.some((key, index) => index > 0 && key!.name !== found[0]!.name)
    )
      return joined();
    keys = found as Array<{ name: string; negated: boolean }>;
  }
  const yes: string[] = [];
  const no: string[] = [];
  let pending = 0;
  parts.forEach((part, index) => {
    const ternary = ternaries[pending];
    if (ternary && ternary.index === index) {
      const [whenTrue, whenFalse] = keys[pending].negated
        ? [ternary.falsy, ternary.truthy]
        : [ternary.truthy, ternary.falsy];
      if (whenTrue) yes.push(whenTrue);
      if (whenFalse) no.push(whenFalse);
      pending++;
      return;
    }
    const className = staticClass(part);
    if (className) {
      yes.push(className);
      no.push(className);
    }
  });
  return keys.length
    ? `(${keys[0].name} ? ${JSON.stringify(yes.join(' '))} : ${JSON.stringify(no.join(' '))})`
    : JSON.stringify(yes.join(' '));
};

const isWordChar = (char: string | undefined) =>
  char !== undefined && /[A-Za-z0-9_$]/.test(char);

const mentions = (text: string, name: string): boolean => {
  for (let at = text.indexOf(name); at >= 0; ) {
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + name.length]))
      return true;
    at = text.indexOf(name, at + name.length);
  }
  return false;
};

const assignedCall = (call: CallBinding, value: string): string =>
  `(${call.params.map((param, index) => `${param} = ${call.args[index]}`).join(', ')}, ${value})`;

type Invoke = (params: string, body: string, args: string) => string;

const PARAM = '__plumeria';

const paramMatches = (text: string) => {
  const matches: Array<{ start: number; index: number; end: number }> = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (char === '"' || char === "'" || char === '`') {
      at++;
      while (at < text.length && text[at] !== char)
        at += text[at] === '\\' ? 2 : 1;
      at++;
      continue;
    }
    const before = at > 0 ? text[at - 1] : undefined;
    if (
      text.startsWith(PARAM, at) &&
      !(
        before !== undefined &&
        (isWordChar(before) || before.charCodeAt(0) >= 0x80)
      )
    ) {
      const digits = /^\d+/.exec(text.slice(at + PARAM.length))?.[0];
      if (!digits) {
        at += PARAM.length;
        continue;
      }
      const end = at + PARAM.length + digits.length;
      matches.push({ start: at, index: Number(digits), end });
      at = end;
      continue;
    }
    at++;
  }
  return matches;
};

const inlineParams = (text: string, bound: string[]): string => {
  let out = '';
  let last = 0;
  for (const { start, index, end } of paramMatches(text)) {
    const source = bound[index];
    if (source === undefined) continue;
    out += text.slice(last, start) + source;
    last = end;
  }
  return out + text.slice(last);
};

const foldDynamicVars = (
  vars: DynamicVar[],
  assign: boolean,
  invoke: Invoke,
): string[] => {
  const sorted = [...vars].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (sorted.some((entry) => entry.call)) {
    const parts: string[] = [];
    let index = 0;
    while (index < sorted.length) {
      const first = sorted[index];
      let end = index + 1;
      if (first.call)
        while (end < sorted.length && sorted[end].call === first.call) end++;
      const pairs = sorted
        .slice(index, end)
        .filter((entry) => entry.cssVar)
        .map((entry) => `"${entry.cssVar}": ${entry.valueExpr}`);
      const object = !first.call
        ? `{ ${pairs.join(', ')} }`
        : assign
          ? assignedCall(first.call, `{ ${pairs.join(', ')} }`)
          : invoke(
              first.call.params.join(', '),
              `({ ${pairs.join(', ')} })`,
              first.call.args.join(', '),
            );
      parts.push(
        first.test ? `...((${first.test}) ? ${object} : null)` : `...${object}`,
      );
      index = end;
    }
    return parts;
  }
  const grouped = new Map<string, DynamicVar[]>();
  sorted.forEach((entry) => {
    const list = grouped.get(entry.cssVar);
    if (list) list.push(entry);
    else grouped.set(entry.cssVar, [entry]);
  });

  return [...grouped].map(([cssVar, entries]) => {
    let value = 'undefined';
    entries.forEach((entry) => {
      value = entry.test
        ? `((${entry.test}) ? ${entry.valueExpr} : ${value})`
        : entry.valueExpr;
    });
    return `"${cssVar}": ${value}`;
  });
};

export type TransformEnv = {
  source: string;
  moduleId: string;
  filePath: string;
  root: string;
  styleProp: string;
  classProp?: string;
  propertyPolicy: PropertyPolicy | undefined;
  isDev: boolean;
  addDependency: (depPath: string) => void;
};

export type TransformOutput = {
  code: string;
};

export const transformSource = async (
  env: TransformEnv,
): Promise<TransformOutput> => {
  const scannedTables = scanOverlay(undefined, env.styleProp);
  const { root, styleProp, propertyPolicy, isDev, addDependency } = env;
  const classProp = env.classProp ?? 'className';
  const id = env.moduleId;
  const source = desugar(env.source, env.moduleId, styleProp) ?? env.source;
  const resourcePath = env.moduleId;
  const baseId = env.filePath;
  const ast = parseSync(source, {
    syntax: 'typescript',
    tsx: true,
    target: 'es2022',
  });
  resolveNamespaceMembers(ast, id);

  assertPropertyPolicy(ast, propertyPolicy, id);

  const leadingLen = getLeadingCommentLength(source);
  const sourceBuffer = Buffer.from(source, 'utf-8');
  const leadingBytes = Buffer.byteLength(source.slice(0, leadingLen), 'utf-8');
  const baseByteOffset = ast.span.start - leadingBytes;

  const getSource = (node: Expression): string => {
    const start = (node as HasSpan).span.start - baseByteOffset;
    const end = (node as HasSpan).span.end - baseByteOffset;
    return sourceBuffer.subarray(start, end).toString('utf-8');
  };

  const throwCompilationError = (message: string, node?: HasSpan): never => {
    let suffix = '';
    if (node) {
      const offset = node.span.start - baseByteOffset;
      let line = 1;
      let colStart = 0;
      for (let i = 0; i < offset && i < sourceBuffer.length; i++) {
        if (sourceBuffer[i] === 10) {
          line++;
          colStart = i + 1;
        }
      }
      const col = offset - colStart + 1;
      suffix = ` (${path.basename(resourcePath)}:${line}:${col})`;
    }
    const err = new Error(`${message}${suffix}`);
    err.stack = err.message;
    throw err;
  };

  const assertResolvable = (node: HasSpan): void => {
    if (t.isIdentifier(node) && (node as Identifier).value === 'undefined')
      return;
    if (
      t.isMemberExpression(node) ||
      t.isIdentifier(node) ||
      t.isCallExpression(node) ||
      t.isArrowFunctionExpression(node) ||
      t.isFunctionExpression(node)
    ) {
      const rootId = getRootIdentifier(node);
      const isPlumeriaStyle =
        rootId &&
        isVisibleReference(node as Expression) &&
        ((localCreateStyles[rootId] !== undefined &&
          localCreateStyles[rootId].type !== 'constant') ||
          mergedCreateTable[rootId] !== undefined);
      if (!isPlumeriaStyle) {
        const failure = resolveOriginError(node, rootId, localImports);
        if (failure) {
          throwCompilationError(
            `[plumeria] ${failure.message} (${path.basename(failure.filePath)})`,
          );
        }
        throwCompilationError(
          `[plumeria] Dynamic or unresolvable style object "${getSource(node)}" is not supported.`,
          node,
        );
      }
    }
  };

  const ownFailure = resolveFileError(baseId, '');
  if (ownFailure) throwCompilationError(`[plumeria] ${ownFailure.message}`);

  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      const sourcePath = node.source.value;
      const actualPath = resolveImportPath(sourcePath, id);
      if (actualPath) {
        addDependency(actualPath);
        const transDeps = getFileDependencies(actualPath);
        for (const dep of transDeps) {
          addDependency(dep);
        }
      }
    }
  }

  if (scannedTables.componentPropsTable) {
    const parentFiles = new Set<string>();
    for (const compKey of Object.keys(scannedTables.componentPropsTable)) {
      if (!compKey.startsWith(`${id}-`)) continue;
      const props = scannedTables.componentPropsTable[compKey];
      for (const propName of Object.keys(props)) {
        for (const entry of props[propName]) {
          if (entry.filePath !== id) {
            parentFiles.add(entry.filePath);
          }
        }
      }
    }
    for (const parentFile of parentFiles) {
      addDependency(parentFile);
    }
  }

  const components: Array<{ name: string; node: HasSpan }> = [];
  const propAliases = new Map<string, Map<string, string>>();
  const propDefaults = new Map<string, Map<string, Expression>>();
  const declaredProps = new Map<string, Set<string>>();
  const addComponent = (name: string, fn: HasSpan & { params: unknown[] }) => {
    components.push({ name, node: fn });
    const first = fn.params[0] as any;
    const pattern = unwrapPatternDefault(first?.pat ?? first);
    const defaults = new Map<string, Expression>();
    for (const item of pattern?.properties ?? []) {
      if (item.type === 'AssignmentPatternProperty' && item.value)
        defaults.set(item.key.value, item.value);
      if (
        item.type === 'KeyValuePatternProperty' &&
        item.value?.type === 'AssignmentPattern'
      )
        defaults.set(item.key.value, item.value.right);
    }
    propDefaults.set(name, defaults);
    const aliases = destructuredPropAliases(fn);
    if (aliases.size > 0) propAliases.set(name, aliases);
    const declared = new Set<string>();
    for (const item of pattern?.properties ?? []) {
      const key = item.key;
      if (t.isIdentifier(key) || t.isStringLiteral(key))
        declared.add(String(key.value));
    }
    if (declared.size > 0) declaredProps.set(name, declared);
  };
  for (const { name, fn } of componentFunctions(ast)) addComponent(name, fn);

  const appliedStyleProps = new Set<string>();
  const ownerComponentOf = (at: HasSpan) =>
    components.find(
      (c) =>
        at.span.start >= c.node.span.start && at.span.start <= c.node.span.end,
    )?.name;
  const markStylePropApplied = (name: string, at: HasSpan) => {
    const owner = ownerComponentOf(at);
    if (owner) {
      appliedStyleProps.add(`${owner}:${name}`);
    }
  };

  const processStyleRecords = (
    style: CSSObject,
    weights?: Record<string, number>,
  ) => getStyleRecords(style as CSSProperties, weights);

  const localConsts = collectLocalConsts(ast);
  const localConstNodes = collectLocalConstNodes(ast);
  const importMap: StaticTable = {};
  const keyframesImportMap: KeyframesHashTable = {};
  const viewTransitionImportMap: ViewTransitionHashTable = {};
  const varTypeImportMap: VarTypeHashTable = {};
  const positionTryImportMap: PositionTryHashTable = {};
  const createImportMap: CreateHashTable = {};
  const createFunctionImportMap: Record<string, StyleFunctions> = {};
  const createThemeImportMap: CreateThemeHashTable = {};
  const createStaticImportMap: CreateStaticHashTable = {};
  const plumeriaAliases: Record<string, string> = {};
  const localImports: Record<
    string,
    { actualPath: string; importedName: string }
  > = {};

  for (const statement of ast.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    const node = statement as ImportDeclaration;
    const sourcePath = node.source.value;

    if (sourcePath === '@plumeria/core') {
      node.specifiers.forEach((specifier) => {
        if (specifier.type === 'ImportNamespaceSpecifier') {
          plumeriaAliases[specifier.local.value] = 'NAMESPACE';
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          plumeriaAliases[specifier.local.value] = 'NAMESPACE';
        } else if (specifier.type === 'ImportSpecifier') {
          const importedName = specifier.imported
            ? specifier.imported.value
            : specifier.local.value;
          plumeriaAliases[specifier.local.value] = importedName;
        }
      });
    }

    const actualPath = resolveImportPath(sourcePath, resourcePath);

    if (actualPath) {
      node.specifiers.forEach((specifier: ImportSpecifier) => {
        if (specifier.type === 'ImportNamespaceSpecifier') {
          localImports[specifier.local.value] = {
            actualPath,
            importedName: '*',
          };
          return;
        }
        if (
          specifier.type === 'ImportSpecifier' ||
          specifier.type === 'ImportDefaultSpecifier'
        ) {
          const importedName =
            specifier.type === 'ImportDefaultSpecifier'
              ? 'default'
              : specifier.imported
                ? specifier.imported.value
                : specifier.local.value;
          const localName = specifier.local.value;
          let resolvedKey = `${actualPath}-${importedName}`;
          const resolved = resolveExport(actualPath, importedName);
          if (resolved) {
            resolvedKey = `${resolved.filePath}-${resolved.localName}`;
          }
          const uniqueKey = resolvedKey;
          localImports[localName] = { actualPath, importedName };

          if (scannedTables.staticTable[uniqueKey]) {
            importMap[localName] = scannedTables.staticTable[uniqueKey];
          }
          if (scannedTables.keyframesHashTable[uniqueKey]) {
            keyframesImportMap[localName] =
              scannedTables.keyframesHashTable[uniqueKey];
          }
          if (scannedTables.viewTransitionHashTable[uniqueKey]) {
            viewTransitionImportMap[localName] =
              scannedTables.viewTransitionHashTable[uniqueKey];
          }
          if (scannedTables.varTypeHashTable?.[uniqueKey]) {
            varTypeImportMap[localName] =
              scannedTables.varTypeHashTable[uniqueKey];
          }
          if (scannedTables.positionTryHashTable?.[uniqueKey]) {
            positionTryImportMap[localName] =
              scannedTables.positionTryHashTable[uniqueKey];
          }
          if (scannedTables.createHashTable[uniqueKey]) {
            createImportMap[localName] =
              scannedTables.createHashTable[uniqueKey];
          }
          if (scannedTables.createFunctionTable[uniqueKey]) {
            createFunctionImportMap[localName] = styleFunctionsOf(
              scannedTables.createFunctionTable[uniqueKey],
            );
          }
          if (scannedTables.createThemeHashTable[uniqueKey]) {
            createThemeImportMap[localName] =
              scannedTables.createThemeHashTable[uniqueKey];
          }
          if (scannedTables.createStaticHashTable[uniqueKey]) {
            createStaticImportMap[localName] =
              scannedTables.createStaticHashTable[uniqueKey];
          }
        }
      });
    }
  }

  const mergedStaticTable: StaticTable = Object.create(
    scannedTables.staticTable,
  );
  for (const key of Object.keys(localConsts)) {
    mergedStaticTable[key] = localConsts[key];
  }
  for (const key of Object.keys(importMap)) {
    mergedStaticTable[key] = importMap[key];
  }

  const mergedKeyframesTable: KeyframesHashTable = Object.create(
    scannedTables.keyframesHashTable,
  );
  for (const key of fileTableKeys(resourcePath, 'keyframesHashTable') ?? []) {
    mergedKeyframesTable[key.slice(resourcePath.length + 1)] =
      scannedTables.keyframesHashTable[key];
  }
  for (const key of Object.keys(keyframesImportMap)) {
    mergedKeyframesTable[key] = keyframesImportMap[key];
  }

  const mergedViewTransitionTable: ViewTransitionHashTable = Object.create(
    scannedTables.viewTransitionHashTable,
  );
  for (const key of fileTableKeys(resourcePath, 'viewTransitionHashTable') ??
    []) {
    mergedViewTransitionTable[key.slice(resourcePath.length + 1)] =
      scannedTables.viewTransitionHashTable[key];
  }
  for (const key of Object.keys(viewTransitionImportMap)) {
    mergedViewTransitionTable[key] = viewTransitionImportMap[key];
  }

  const varTypeHashTable = scannedTables.varTypeHashTable ?? {};
  const mergedVarTypeTable: VarTypeHashTable = Object.create(varTypeHashTable);
  for (const key of fileTableKeys(resourcePath, 'varTypeHashTable') ?? []) {
    mergedVarTypeTable[key.slice(resourcePath.length + 1)] =
      varTypeHashTable[key];
  }
  for (const key of Object.keys(varTypeImportMap)) {
    mergedVarTypeTable[key] = varTypeImportMap[key];
  }

  const positionTryHashTable = scannedTables.positionTryHashTable ?? {};
  const mergedPositionTryTable: PositionTryHashTable =
    Object.create(positionTryHashTable);
  for (const key of fileTableKeys(resourcePath, 'positionTryHashTable') ?? []) {
    mergedPositionTryTable[key.slice(resourcePath.length + 1)] =
      positionTryHashTable[key];
  }
  for (const key of Object.keys(positionTryImportMap)) {
    mergedPositionTryTable[key] = positionTryImportMap[key];
  }

  const mergedCreateTable: CreateHashTable = Object.create(
    scannedTables.createHashTable,
  );
  for (const key of fileTableKeys(resourcePath, 'createHashTable') ?? []) {
    mergedCreateTable[key.slice(resourcePath.length + 1)] =
      scannedTables.createHashTable[key];
  }
  for (const key of Object.keys(createImportMap)) {
    mergedCreateTable[key] = createImportMap[key];
  }

  const mergedCreateThemeHashTable: CreateThemeHashTable = Object.create(
    scannedTables.createThemeHashTable,
  );
  for (const key of fileTableKeys(resourcePath, 'createThemeHashTable') ?? []) {
    mergedCreateThemeHashTable[key.slice(resourcePath.length + 1)] =
      scannedTables.createThemeHashTable[key];
  }
  for (const key of Object.keys(createThemeImportMap)) {
    mergedCreateThemeHashTable[key] = createThemeImportMap[key];
  }

  const mergedCreateStaticHashTable: CreateStaticHashTable = Object.create(
    scannedTables.createStaticHashTable,
  );
  for (const key of fileTableKeys(resourcePath, 'createStaticHashTable') ??
    []) {
    mergedCreateStaticHashTable[key.slice(resourcePath.length + 1)] =
      scannedTables.createStaticHashTable[key];
  }
  for (const key of Object.keys(createStaticImportMap)) {
    mergedCreateStaticHashTable[key] = createStaticImportMap[key];
  }

  const dynamicStyleTables: DynamicStyleTables = {
    keyframesHashTable: mergedKeyframesTable,
    viewTransitionHashTable: mergedViewTransitionTable,
    varTypeHashTable: mergedVarTypeTable,
    positionTryHashTable: mergedPositionTryTable,
    createThemeHashTable: mergedCreateThemeHashTable,
    createThemeObjectTable: scannedTables.createThemeObjectTable,
    createHashTable: mergedCreateTable,
    createStaticHashTable: mergedCreateStaticHashTable,
    createStaticObjectTable: scannedTables.createStaticObjectTable,
  };

  const localCreateStyles: Record<string, CreateStyleValue> = {};
  const localStyleAliases: Record<string, LocalStyleAlias[]> = {};

  const checkStyleAliasAssignment = (decl: VariableDeclarator) => {
    if (!t.isIdentifier(decl.id) || !decl.init) return;
    const init = unwrapExpression(decl.init);
    if (t.isMemberExpression(init) && t.isIdentifier(init.object)) {
      const objName = init.object.value;
      if (
        localCreateStyles[objName] !== undefined ||
        mergedCreateTable[objName] !== undefined
      ) {
        (localStyleAliases[decl.id.value] ??= []).push({
          expression: init,
          context: (decl.id as Identifier & { ctxt: number }).ctxt,
        });
      }
    }
  };

  const replacements: Array<{
    start: number;
    end: number;
    content: string;
  }> = [];

  const setReplacement = (
    span: { start: number; end: number },
    content: string,
  ) => {
    const start = span.start - baseByteOffset;
    const end = span.end - baseByteOffset;
    const existing = replacements.find(
      (replacement) => replacement.start === start && replacement.end === end,
    );
    if (existing) existing.content = content;
    else replacements.push({ start, end, content });
  };

  const declSites = usesReservedName(ast)
    ? new Map<number, DeclSite>()
    : collectDeclSites(ast, source, baseByteOffset);
  const siteAt = collectSiteScopes(ast);
  const siteTemps = new Map<number, string[]>();
  const tempNext = new Map<number, number>();
  let argBase: number | null = null;
  const helpers = new Map<
    string,
    { name: string; params: string; body: string }
  >();

  const siteOf = (node: HasSpan): number | undefined => {
    const site = siteAt(node.span.start);
    return site !== null && declSites.has(site) ? site : undefined;
  };

  const declareTemps = (site: number, temps: string[], unique = true) => {
    let declared = siteTemps.get(site);
    if (!declared) siteTemps.set(site, (declared = []));
    for (const temp of temps)
      if (!unique || !declared.includes(temp)) declared.push(temp);
  };

  const argNames = (from: number, to: number) =>
    Array.from(
      { length: Math.max(0, to - from) },
      (_, index) => `__plumeria_arg${from + index}`,
    );

  const invoke: Invoke = (params, body, args) => {
    if (declSites.size === 0) return `((${params}) => ${body})(${args})`;
    const key = `${params}\u0000${body}`;
    let helper = helpers.get(key);
    if (!helper) {
      helper = { name: `__plumeria_fn${helpers.size}`, params, body };
      helpers.set(key, helper);
    }
    return `${helper.name}(${args})`;
  };

  const readOnce = (
    source: string,
    body: (value: string) => string,
  ): string => {
    if (isIdentifierSource(source)) return `(${body(source)})`;
    if (argBase !== null) {
      const temp = `__plumeria_arg${argBase++}`;
      return `(${temp} = (${source}), ${body(temp)})`;
    }
    const value = '__plumeria_value';
    return invoke(value, body(value), source);
  };

  const deferredSources: Array<{
    token: string;
    start: number;
    end: number;
  }> = [];
  const deferRange = (start: number, end: number): string => {
    const token = `__plumeria_preserved_${deferredSources.length}__`;
    deferredSources.push({ token, start, end });
    return token;
  };
  const deferSource = (node: HasSpan): string =>
    deferRange(
      node.span.start - baseByteOffset,
      node.span.end - baseByteOffset,
    );
  const deferProperty = (
    property: ObjectExpression['properties'][number],
  ): string | null => {
    const node = property as {
      span?: { start: number; end: number };
      spread?: { start: number; end: number };
      arguments?: HasSpan;
      key?: HasSpan;
      value?: HasSpan;
    };
    const range =
      node.spread && node.arguments
        ? { start: node.spread.start, end: node.arguments.span.end }
        : node.span
          ? { start: node.span.start, end: node.span.end }
          : node.key && node.value
            ? { start: node.key.span.start, end: node.value.span.end }
            : null;
    return range
      ? deferRange(range.start - baseByteOffset, range.end - baseByteOffset)
      : null;
  };

  const dynamicFnCalls: CallExpression[] = [];
  const processedDecls = new Set<VariableDeclaration>();
  const separatelyExported = new Set<string>();
  for (const statement of ast.body) {
    if (statement.type !== 'ExportNamedDeclaration' || statement.source)
      continue;
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === 'ExportSpecifier' &&
        t.isIdentifier(specifier.orig)
      ) {
        separatelyExported.add(specifier.orig.value);
      }
    }
  }
  const idSpans = new Set<number>();
  const excludedSpans = new Set<number>();
  const referenceIdents = collectReferenceIdentifiers(ast);

  const topLevelDeclarators = new Set<VariableDeclarator>();
  for (const statement of ast.body) {
    const declaration = unwrapExport(statement);
    if (t.isVariableDeclaration(declaration)) {
      declaration.declarations.forEach((decl) => topLevelDeclarators.add(decl));
    }
  }

  const unwrapStyleExpression = (node: any): any => {
    while (
      node &&
      [
        'ParenthesisExpression',
        'TsAsExpression',
        'TsSatisfiesExpression',
        'TsNonNullExpression',
        'TsConstAssertion',
        'TsTypeAssertion',
      ].includes(node.type)
    )
      node = node.expression;
    return node;
  };
  const literalObjectArgument = (
    node: Expression,
    seen = new Set<string>(),
  ): ObjectExpression | null => {
    node = unwrapStyleExpression(node);
    if (t.isObjectExpression(node)) return node;
    if (!t.isIdentifier(node) || seen.has(node.value)) return null;
    seen.add(node.value);
    const declaration = [...topLevelDeclarators].find(
      (decl) =>
        t.isIdentifier(decl.id) && decl.id.value === (node as Identifier).value,
    );
    return declaration?.init
      ? literalObjectArgument(declaration.init, seen)
      : null;
  };
  const registeredStyleCalls = new Set<number>();

  const dropDefinition = (
    init: Expression,
    declSpan: { start: number; end: number },
    isExported: boolean,
  ) => {
    const span = isExported ? (init as HasSpan).span : declSpan;
    replacements.push({
      start: span.start - baseByteOffset,
      end: span.end - baseByteOffset,
      content: isExported ? '""' : '',
    });
  };

  const registerStyle = (
    node: VariableDeclarator,
    declSpan: { start: number; end: number },
    isExported: boolean,
  ) => {
    let propName: string | undefined;
    const init = unwrapStyleExpression(node.init) as Expression | undefined;
    if (
      t.isIdentifier(node.id) &&
      init &&
      t.isCallExpression(init) &&
      init.arguments.length >= 1
    ) {
      const callee = init.callee;

      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object) &&
        t.isIdentifier(callee.property)
      ) {
        const objectName = callee.object.value;
        const propertyName = callee.property.value;
        const alias = plumeriaAliases[objectName];

        if (alias === 'NAMESPACE') {
          propName = propertyName;
        }
      } else if (t.isIdentifier(callee)) {
        const calleeName = callee.value;
        const originalName = plumeriaAliases[calleeName];
        if (originalName) {
          propName = originalName;
        }
      }
    }

    if (propName && init && t.isCallExpression(init)) {
      if (
        ['create', 'createTheme', 'createStatic', 'varType'].includes(
          propName,
        ) &&
        !topLevelDeclarators.has(node)
      ) {
        throwCompilationError(
          `[plumeria] css.${propName} must be assigned to a top-level variable so its styles can be resolved across files. Move this declaration outside the function or block.`,
          node,
        );
      }
      if (
        ['create', 'createTheme', 'createStatic', 'varType'].includes(propName)
      ) {
        const argumentIndex = propName === 'createTheme' ? 1 : 0;
        const argument = init.arguments[argumentIndex];
        const object = argument && literalObjectArgument(argument.expression);
        if (!object)
          throwCompilationError(
            `[plumeria] css.${propName} needs a style object it can read at build time. Pass an object literal or a top-level constant containing one.`,
            init,
          );
        argument.expression = object!;
        registeredStyleCalls.add(init.span.start);
      }
      if (
        propName === 'create' &&
        t.isObjectExpression(init.arguments[0].expression)
      ) {
        const obj = objectExpressionToObject(
          init.arguments[0].expression as ObjectExpression,
          mergedStaticTable,
          mergedKeyframesTable,
          mergedViewTransitionTable,
          mergedCreateThemeHashTable,
          scannedTables.createThemeObjectTable,
          mergedCreateTable,
          mergedCreateStaticHashTable,
          scannedTables.createStaticObjectTable,
          undefined,
          mergedVarTypeTable,
          mergedPositionTryTable,
        );
        assertNoDroppedValues(
          init.arguments[0].expression as ObjectExpression,
          obj,
          spreadValues(
            [
              mergedStaticTable,
              mergedKeyframesTable,
              mergedViewTransitionTable,
              mergedCreateThemeHashTable,
              scannedTables.createThemeObjectTable,
              mergedCreateTable,
              mergedCreateStaticHashTable,
              scannedTables.createStaticObjectTable,
              undefined,
              mergedVarTypeTable,
              mergedPositionTryTable,
            ],
            localConstNodes,
            getSource,
          ),
        );

        if (obj) {
          const hashMap: Record<string, Record<string, string>> = {};
          Object.entries(obj).forEach(([key, style]) => {
            if (typeof style !== 'object' || style === null) return;
            const records = getStyleRecords(style as CSSProperties);
            const atomMap: Record<string, string> = {};
            records.forEach((r) => (atomMap[r.key] = r.hash));
            hashMap[key] = atomMap;
          });

          const styleFunctions = styleFunctionsOf(
            init.arguments[0].expression as ObjectExpression,
          );

          if (t.isIdentifier(node.id)) {
            idSpans.add(node.id.span.start);
          }

          if (t.isIdentifier(node.id)) {
            localCreateStyles[node.id.value] = {
              name: node.id.value,
              type: 'create',
              obj,
              hashMap,
              isExported,
              initSpan: {
                start: init.span.start - baseByteOffset,
                end: init.span.end - baseByteOffset,
              },
              declSpan: {
                start: declSpan.start - baseByteOffset,
                end: declSpan.end - baseByteOffset,
              },
              functions: styleFunctions,
            };
          }
        }
      } else if (
        propName === 'createTheme' &&
        init.arguments.length >= 2 &&
        t.isObjectExpression(init.arguments[1].expression)
      ) {
        if (t.isIdentifier(node.id)) {
          idSpans.add(node.id.span.start);
        }

        const selectorExpr = init.arguments[0].expression;
        const selector = resolveThemeSelector(
          selectorExpr,
          mergedStaticTable,
          mergedCreateStaticHashTable,
          scannedTables.createStaticObjectTable,
        );

        if (!selector) {
          throwCompilationError(
            `[plumeria] createTheme needs a selector it can read at build time. ` +
              `Pass a string literal such as ".dark", or a name this file declares as one.`,
            selectorExpr as HasSpan,
          );
        }

        if (selector.startsWith('@') && !isAtRule(selector)) {
          throwCompilationError(
            `[plumeria] Unsupported at-rule: "${selector}". createTheme only supports nesting at-rules such as @media, @container, and @supports.`,
            selectorExpr as HasSpan,
          );
        }

        const obj = objectExpressionToObject(
          init.arguments[1].expression as ObjectExpression,
          mergedStaticTable,
          mergedKeyframesTable,
          mergedViewTransitionTable,
          mergedCreateThemeHashTable,
          scannedTables.createThemeObjectTable,
          mergedCreateTable,
          mergedCreateStaticHashTable,
          scannedTables.createStaticObjectTable,
          undefined,
          mergedVarTypeTable,
          mergedPositionTryTable,
        );
        assertNoDroppedValues(
          init.arguments[1].expression as ObjectExpression,
          obj,
          spreadValues(
            [
              mergedStaticTable,
              mergedKeyframesTable,
              mergedViewTransitionTable,
              mergedCreateThemeHashTable,
              scannedTables.createThemeObjectTable,
              mergedCreateTable,
              mergedCreateStaticHashTable,
              scannedTables.createStaticObjectTable,
              undefined,
              mergedVarTypeTable,
              mergedPositionTryTable,
            ],
            localConstNodes,
            getSource,
          ),
        );

        const hash = themeHashOf(selector, obj);
        if (t.isIdentifier(node.id)) {
          const uniqueKey = `${resourcePath}-${node.id.value}`;

          scannedTables.createThemeHashTable[uniqueKey] = hash;
          scannedTables.createThemeObjectTable[hash] = obj;
          if (scannedTables.createThemeSelectorTable) {
            scannedTables.createThemeSelectorTable[hash] = selector;
          }

          mergedCreateThemeHashTable[node.id.value] = hash;

          const themeHashMap: Record<string, any> = {};
          for (const [key, value] of Object.entries(obj)) {
            const cssVarName = camelToKebabCase(key);
            const atomicHash = genBase36Hash(
              { _theme: hash, [key]: value },
              1,
              8,
            );
            themeHashMap[key] = `var(--${atomicHash}-${cssVarName})`;
          }

          localCreateStyles[node.id.value] = {
            name: node.id.value,
            type: 'constant',
            obj,
            hashMap: themeHashMap,
            isExported,
            initSpan: {
              start: init.span.start - baseByteOffset,
              end: init.span.end - baseByteOffset,
            },
            declSpan: {
              start: declSpan.start - baseByteOffset,
              end: declSpan.end - baseByteOffset,
            },
          };
        }
      } else if (
        propName === 'varType' &&
        t.isIdentifier(node.id) &&
        t.isObjectExpression(init.arguments[0].expression)
      ) {
        const expr = init.arguments[0].expression as ObjectExpression;
        const obj = objectExpressionToObject(
          expr,
          mergedStaticTable,
          mergedKeyframesTable,
          mergedViewTransitionTable,
          mergedCreateThemeHashTable,
          scannedTables.createThemeObjectTable,
          mergedCreateTable,
          mergedCreateStaticHashTable,
          scannedTables.createStaticObjectTable,
          undefined,
          mergedVarTypeTable,
          mergedPositionTryTable,
        );
        assertNoDroppedValues(
          expr,
          obj,
          spreadValues(
            [
              mergedStaticTable,
              mergedKeyframesTable,
              mergedViewTransitionTable,
              mergedCreateThemeHashTable,
              scannedTables.createThemeObjectTable,
              mergedCreateTable,
              mergedCreateStaticHashTable,
              scannedTables.createStaticObjectTable,
              undefined,
              mergedVarTypeTable,
              mergedPositionTryTable,
            ],
            localConstNodes,
            getSource,
          ),
        );
        let hash = '';
        try {
          hash = checkedVarTypeHash(node.id.value, obj);
        } catch (error) {
          throwCompilationError((error as Error).message, init);
        }
        mergedVarTypeTable[node.id.value] = hash;
        (scannedTables.varTypeObjectTable ??= {})[hash] = obj;
        dropDefinition(init, declSpan, isExported);
      } else if (
        ['keyframes', 'viewTransitionClass', 'positionTry'].includes(
          propName,
        ) &&
        t.isObjectExpression(init.arguments[0].expression)
      ) {
        registeredStyleCalls.add(init.span.start);
        dropDefinition(init, declSpan, isExported);
      } else if (
        propName === 'createStatic' &&
        t.isObjectExpression(init.arguments[0].expression)
      ) {
        if (t.isIdentifier(node.id)) {
          idSpans.add(node.id.span.start);
        }
        const obj = objectExpressionToObject(
          init.arguments[0].expression as ObjectExpression,
          mergedStaticTable,
          mergedKeyframesTable,
          mergedViewTransitionTable,
          mergedCreateThemeHashTable,
          scannedTables.createThemeObjectTable,
          mergedCreateTable,
          mergedCreateStaticHashTable,
          scannedTables.createStaticObjectTable,
          undefined,
          mergedVarTypeTable,
          mergedPositionTryTable,
        );
        assertNoDroppedValues(
          init.arguments[0].expression as ObjectExpression,
          obj,
          spreadValues(
            [
              mergedStaticTable,
              mergedKeyframesTable,
              mergedViewTransitionTable,
              mergedCreateThemeHashTable,
              scannedTables.createThemeObjectTable,
              mergedCreateTable,
              mergedCreateStaticHashTable,
              scannedTables.createStaticObjectTable,
              undefined,
              mergedVarTypeTable,
              mergedPositionTryTable,
            ],
            localConstNodes,
            getSource,
          ),
        );
        const hash = genBase36Hash(obj, 1, 8);
        if (t.isIdentifier(node.id)) {
          const uniqueKey = `${resourcePath}-${node.id.value}`;

          scannedTables.createStaticHashTable[uniqueKey] = hash;
          scannedTables.createStaticObjectTable[hash] = obj;
          mergedCreateStaticHashTable[node.id.value] = hash;

          localCreateStyles[node.id.value] = {
            name: node.id.value,
            type: 'constant',
            obj,
            hashMap: obj,
            isExported,
            initSpan: {
              start: init.span.start - baseByteOffset,
              end: init.span.end - baseByteOffset,
            },
            declSpan: {
              start: declSpan.start - baseByteOffset,
              end: declSpan.end - baseByteOffset,
            },
          };
        }
      }
    }
  };

  traverse(ast, {
    ImportDeclaration({ node }: { node: ImportDeclaration }) {
      if (node.source.value === '@plumeria/core') {
        if (node.typeOnly) return;

        const typeOnlySpecs = node.specifiers.filter(
          (s) => s.type === 'ImportSpecifier' && s.isTypeOnly,
        );

        if (typeOnlySpecs.length > 0) {
          const names = typeOnlySpecs

            .map((s) => {
              if (s.type !== 'ImportSpecifier') return;
              const imported = s.imported ? s.imported.value : s.local.value;
              const local = s.local.value;
              return imported === local ? imported : `${imported} as ${local}`;
            })
            .join(', ');

          replacements.push({
            start: node.span.start - baseByteOffset,
            end: node.span.end - baseByteOffset,
            content: `import type { ${names} } from '@plumeria/core'`,
          });
        } else {
          replacements.push({
            start: node.span.start - baseByteOffset,
            end: node.span.end - baseByteOffset,
            content: '',
          });
        }
      }
      node.specifiers.forEach((specifier) => {
        if (specifier.local) {
          excludedSpans.add(specifier.local.span.start);
        }
        if (specifier.type === 'ImportSpecifier' && specifier.imported) {
          excludedSpans.add(specifier.imported.span.start);
        }
      });
    },
    ExportDeclaration({ node }: { node: ExportDeclaration }) {
      if (t.isVariableDeclaration(node.declaration)) {
        processedDecls.add(node.declaration);
        node.declaration.declarations.forEach((decl) => {
          registerStyle(decl, node.span, true);
          checkStyleAliasAssignment(decl);
        });
      }
    },
    VariableDeclaration({ node }: { node: VariableDeclaration }) {
      if (processedDecls.has(node)) return;
      node.declarations.forEach((decl) => {
        registerStyle(
          decl,
          node.span,
          node.declarations.length > 1 ||
            (t.isIdentifier(decl.id) && separatelyExported.has(decl.id.value)),
        );
        checkStyleAliasAssignment(decl);
      });
    },

    CallExpression({ node }: { node: CallExpression }) {
      const callee = node.callee;
      let propName: string | undefined;

      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object) &&
        t.isIdentifier(callee.property)
      ) {
        const objectName = callee.object.value;
        const propertyName = callee.property.value;
        const alias = plumeriaAliases[objectName];

        if (alias === 'NAMESPACE') {
          propName = propertyName;
        }
      } else if (t.isIdentifier(callee)) {
        const calleeName = callee.value;
        const originalName = plumeriaAliases[calleeName];
        if (originalName) {
          propName = originalName;
        }
      }

      if (propName) {
        if (
          ['create', 'createTheme', 'createStatic', 'varType'].includes(
            propName,
          ) &&
          !registeredStyleCalls.has(node.span.start)
        ) {
          throwCompilationError(
            `[plumeria] css.${propName} must be assigned to a named top-level variable. Destructuring, assignment statements, and default-exported calls cannot be compiled.`,
            node,
          );
        }
        const args = node.arguments;

        if (propName === 'keyframes' && args.length > 0) {
          const expr = args[0].expression;
          if (t.isObjectExpression(expr)) {
            const obj = objectExpressionToObject(
              expr,
              mergedStaticTable,
              mergedKeyframesTable,
              mergedViewTransitionTable,
              mergedCreateThemeHashTable,
              scannedTables.createThemeObjectTable,
              mergedCreateTable,
              mergedCreateStaticHashTable,
              scannedTables.createStaticObjectTable,
              undefined,
              mergedVarTypeTable,
              mergedPositionTryTable,
            );
            assertNoDroppedValues(
              expr,
              obj,
              spreadValues(
                [
                  mergedStaticTable,
                  mergedKeyframesTable,
                  mergedViewTransitionTable,
                  mergedCreateThemeHashTable,
                  scannedTables.createThemeObjectTable,
                  mergedCreateTable,
                  mergedCreateStaticHashTable,
                  scannedTables.createStaticObjectTable,
                  undefined,
                  mergedVarTypeTable,
                  mergedPositionTryTable,
                ],
                localConstNodes,
                getSource,
              ),
            );
            const hash = genBase36Hash(obj, 1, 8);
            scannedTables.keyframesObjectTable[hash] = obj;
            if (!registeredStyleCalls.has(node.span.start)) {
              replacements.push({
                start: node.span.start - baseByteOffset,
                end: node.span.end - baseByteOffset,
                content: JSON.stringify(`kf-${hash}`),
              });
            }
          }
        } else if (
          propName === 'viewTransitionClass' &&
          args.length > 0 &&
          t.isObjectExpression(args[0].expression)
        ) {
          const obj = objectExpressionToObject(
            args[0].expression as ObjectExpression,
            mergedStaticTable,
            mergedKeyframesTable,
            mergedViewTransitionTable,
            mergedCreateThemeHashTable,
            scannedTables.createThemeObjectTable,
            mergedCreateTable,
            mergedCreateStaticHashTable,
            scannedTables.createStaticObjectTable,
            undefined,
            mergedVarTypeTable,
            mergedPositionTryTable,
          );
          assertNoDroppedValues(
            args[0].expression as ObjectExpression,
            obj,
            spreadValues(
              [
                mergedStaticTable,
                mergedKeyframesTable,
                mergedViewTransitionTable,
                mergedCreateThemeHashTable,
                scannedTables.createThemeObjectTable,
                mergedCreateTable,
                mergedCreateStaticHashTable,
                scannedTables.createStaticObjectTable,
                undefined,
                mergedVarTypeTable,
                mergedPositionTryTable,
              ],
              localConstNodes,
              getSource,
            ),
          );
          const hash = genBase36Hash(obj, 1, 8);
          scannedTables.viewTransitionObjectTable[hash] = obj;
          if (!registeredStyleCalls.has(node.span.start)) {
            replacements.push({
              start: node.span.start - baseByteOffset,
              end: node.span.end - baseByteOffset,
              content: JSON.stringify(`vt-${hash}`),
            });
          }
        } else if (
          propName === 'positionTry' &&
          args.length > 0 &&
          t.isObjectExpression(args[0].expression)
        ) {
          const obj = objectExpressionToObject(
            args[0].expression as ObjectExpression,
            mergedStaticTable,
            mergedKeyframesTable,
            mergedViewTransitionTable,
            mergedCreateThemeHashTable,
            scannedTables.createThemeObjectTable,
            mergedCreateTable,
            mergedCreateStaticHashTable,
            scannedTables.createStaticObjectTable,
            undefined,
            mergedVarTypeTable,
            mergedPositionTryTable,
          );
          assertNoDroppedValues(
            args[0].expression as ObjectExpression,
            obj,
            spreadValues(
              [
                mergedStaticTable,
                mergedKeyframesTable,
                mergedViewTransitionTable,
                mergedCreateThemeHashTable,
                scannedTables.createThemeObjectTable,
                mergedCreateTable,
                mergedCreateStaticHashTable,
                scannedTables.createStaticObjectTable,
                undefined,
                mergedVarTypeTable,
                mergedPositionTryTable,
              ],
              localConstNodes,
              getSource,
            ),
          );
          const hash = genBase36Hash(obj, 1, 8);
          (scannedTables.positionTryObjectTable ??= {})[hash] = obj;
          if (!registeredStyleCalls.has(node.span.start)) {
            replacements.push({
              start: node.span.start - baseByteOffset,
              end: node.span.end - baseByteOffset,
              content: JSON.stringify(`--pt-${hash}`),
            });
          }
        } else if (
          propName === 'createTheme' &&
          args.length >= 2 &&
          t.isObjectExpression(args[1].expression)
        ) {
          const selectorExpr = args[0].expression;
          const selector = resolveThemeSelector(
            selectorExpr,
            mergedStaticTable,
            mergedCreateStaticHashTable,
            scannedTables.createStaticObjectTable,
          );

          if (!selector) {
            throwCompilationError(
              `[plumeria] createTheme needs a selector it can read at build time. ` +
                `Pass a string literal such as ".dark", or a name this file declares as one.`,
              selectorExpr as HasSpan,
            );
          }

          if (selector.startsWith('@') && !isAtRule(selector)) {
            throwCompilationError(
              `[plumeria] Unsupported at-rule: "${selector}". createTheme only supports nesting at-rules such as @media, @container, and @supports.`,
              selectorExpr as HasSpan,
            );
          }
          const obj = objectExpressionToObject(
            args[1].expression as ObjectExpression,
            mergedStaticTable,
            mergedKeyframesTable,
            mergedViewTransitionTable,
            mergedCreateThemeHashTable,
            scannedTables.createThemeObjectTable,
            mergedCreateTable,
            mergedCreateStaticHashTable,
            scannedTables.createStaticObjectTable,
            undefined,
            mergedVarTypeTable,
            mergedPositionTryTable,
          );
          assertNoDroppedValues(
            args[1].expression as ObjectExpression,
            obj,
            spreadValues(
              [
                mergedStaticTable,
                mergedKeyframesTable,
                mergedViewTransitionTable,
                mergedCreateThemeHashTable,
                scannedTables.createThemeObjectTable,
                mergedCreateTable,
                mergedCreateStaticHashTable,
                scannedTables.createStaticObjectTable,
                undefined,
                mergedVarTypeTable,
                mergedPositionTryTable,
              ],
              localConstNodes,
              getSource,
            ),
          );
          const hash = themeHashOf(selector, obj);
          scannedTables.createThemeObjectTable[hash] = obj;
          if (scannedTables.createThemeSelectorTable) {
            scannedTables.createThemeSelectorTable[hash] = selector;
          }
        } else if (
          propName === 'createStatic' &&
          args.length > 0 &&
          t.isObjectExpression(args[0].expression)
        ) {
          const obj = objectExpressionToObject(
            args[0].expression as ObjectExpression,
            mergedStaticTable,
            mergedKeyframesTable,
            mergedViewTransitionTable,
            mergedCreateThemeHashTable,
            scannedTables.createThemeObjectTable,
            mergedCreateTable,
            mergedCreateStaticHashTable,
            scannedTables.createStaticObjectTable,
            undefined,
            mergedVarTypeTable,
            mergedPositionTryTable,
          );
          assertNoDroppedValues(
            args[0].expression as ObjectExpression,
            obj,
            spreadValues(
              [
                mergedStaticTable,
                mergedKeyframesTable,
                mergedViewTransitionTable,
                mergedCreateThemeHashTable,
                scannedTables.createThemeObjectTable,
                mergedCreateTable,
                mergedCreateStaticHashTable,
                scannedTables.createStaticObjectTable,
                undefined,
                mergedVarTypeTable,
                mergedPositionTryTable,
              ],
              localConstNodes,
              getSource,
            ),
          );
          const hash = genBase36Hash(obj, 1, 8);
          scannedTables.createStaticObjectTable[hash] = obj;
        } else if (
          propName === 'create' &&
          args.length > 0 &&
          t.isObjectExpression(args[0].expression)
        ) {
          const obj = objectExpressionToObject(
            args[0].expression as ObjectExpression,
            mergedStaticTable,
            mergedKeyframesTable,
            mergedViewTransitionTable,
            mergedCreateThemeHashTable,
            scannedTables.createThemeObjectTable,
            mergedCreateTable,
            mergedCreateStaticHashTable,
            scannedTables.createStaticObjectTable,
            undefined,
            mergedVarTypeTable,
            mergedPositionTryTable,
          );
          const hash = genBase36Hash(obj, 1, 8);
          scannedTables.createObjectTable[hash] = obj;
        }
      }
    },
  });

  const jsxAttributeOwnerMap = new Map<
    number,
    { compKey: string | null; attributes: JSXAttributeOrSpread[] }
  >();

  const propEntryIndexes = new Map<TableEntry[], Map<number, TableEntry[]>>();
  const localPropEntries = (list: TableEntry[], spanStart: number) => {
    let index = propEntryIndexes.get(list);
    if (!index) {
      index = new Map();
      for (const entry of list) {
        if (entry.filePath !== resourcePath) continue;
        const bucket = index.get(entry.spanStart);
        if (bucket) bucket.push(entry);
        else index.set(entry.spanStart, [entry]);
      }
      propEntryIndexes.set(list, index);
    }
    return index.get(spanStart);
  };

  const textAt = ([start, end]: Span) =>
    sourceBuffer
      .subarray(start - baseByteOffset, end - baseByteOffset)
      .toString('utf-8');

  const freshKeyName = (names: { next: number }) => {
    let name = `__plumeria_key${names.next++}`;
    while (source.includes(name)) name += '_';
    return name;
  };

  const decideKeyed = (
    rows: KeyedRow[],
    reads: Map<string, string>,
    calls: string[],
    names: { next: number },
    keys: string[],
    assign: boolean,
  ): [string, boolean] => {
    const first = rows[0];
    if (!first) return ['""', true];
    const condition = first.conditions[0];
    if (!condition) {
      const key = JSON.stringify(first.key);
      if (first.fixed) return [key, true];
      const carried = first.calls
        ? first.calls.flatMap((call) => {
            const name = reads.get(spanKey(spanOf(call)));
            return name ? [name] : [];
          })
        : calls;
      return [
        `{ key: ${key}, vars: { ${carried.map((name) => `...${name}`).join(', ')} } }`,
        false,
      ];
    }
    const test = spanOf(condition.test);
    const testKey = spanKey(test);
    const branch = (keep: (condition: Condition) => boolean): KeyedRow[] =>
      rows.flatMap((row) => {
        const position = row.conditions.findIndex(
          (other) => spanKey(spanOf(other.test)) === testKey,
        );
        if (position < 0) return [row];
        if (!keep(row.conditions[position])) return [];
        return [
          {
            ...row,
            conditions: row.conditions.filter((_, index) => index !== position),
          },
        ];
      });
    const text = reads.get(testKey) ?? textAt(test);
    const keyed = condition.keyed;
    if (!keyed) {
      const [truthy] = decideKeyed(
        branch((other) => other.truthy),
        reads,
        calls,
        names,
        keys,
        assign,
      );
      const [falsy] = decideKeyed(
        branch((other) => !other.truthy),
        reads,
        calls,
        names,
        keys,
        assign,
      );
      return [`((${text}) ? ${truthy} : ${falsy})`, false];
    }
    const branches = [...keyed.options.map((_, index) => index), null].map(
      (option) =>
        decideKeyed(
          branch(
            (other) =>
              other.keyed !== undefined && other.keyed.option === option,
          ),
          reads,
          calls,
          names,
          keys,
          assign,
        ),
    );
    const [fallback] = branches.pop()!;
    if (branches.every(([, fixed]) => fixed)) {
      const pairs = keyed.options.map(
        (option, index) => `${JSON.stringify(option)}:${branches[index][0]}`,
      );
      return [
        `({__proto__:null,${pairs.join(',')}}[${text}] ?? ${fallback})`,
        false,
      ];
    }
    const name = freshKeyName(names);
    const pairs = keyed.options.map(
      (option, index) => `${JSON.stringify(option)}:${index}`,
    );
    let body = fallback;
    for (let index = branches.length - 1; index >= 0; index--)
      body = `(${name} === ${index} ? ${branches[index][0]} : ${body})`;
    if (assign) {
      keys.push(name);
      return [
        `(${name} = {__proto__:null,${pairs.join(',')}}[${text}], ${body})`,
        false,
      ];
    }
    return [
      `((${name}) => ${body})({__proto__:null,${pairs.join(',')}}[${text}])`,
      false,
    ];
  };

  const componentParamNames = new Set<string>();
  const addFirstParamName = (fn: { params: unknown[] }) => {
    const first = fn.params[0] as any;
    const p = unwrapPatternDefault(first?.pat ?? first);
    if (t.isIdentifier(p)) {
      componentParamNames.add(p.value);
    } else if (p?.type === 'ObjectPattern') {
      for (const item of p.properties) {
        if (item.type === 'RestElement' && t.isIdentifier(item.argument)) {
          componentParamNames.add(item.argument.value);
        }
      }
    }
  };
  for (const { fn } of componentFunctions(ast)) addFirstParamName(fn);

  const excludeSubtreeSpans = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.span) {
      excludedSpans.add(n.span.start);
    }
    Object.values(n).forEach((val) => excludeSubtreeSpans(val));
  };

  const isVisibleReference = (expr: Expression): boolean => {
    if (t.isIdentifier(expr))
      return referenceIdents.references.has(expr.span.start);
    if (t.isMemberExpression(expr)) return isVisibleReference(expr.object);
    if (
      t.isCallExpression(expr) &&
      expr.callee.type !== 'Super' &&
      expr.callee.type !== 'Import'
    )
      return isVisibleReference(expr.callee);
    return true;
  };

  const resolveStyleObject = (expr: Expression): CSSObject | null => {
    expr = unwrapExpression(expr);
    expr = resolveLocalStyleAlias(localStyleAliases, expr);
    if (!isVisibleReference(expr)) return null;
    if (expr.type === 'ArrayExpression') {
      let merged: CSSObject = {};
      for (const element of expr.elements ?? []) {
        if (!element) continue;
        if (element.spread)
          throwCompilationError(
            spreadStyleMessage(getSource(element.expression)),
            element.expression as HasSpan,
          );
        const style = resolveStyleObject(element.expression);
        if (!style) return null;
        merged = deepMerge(merged, style) as CSSObject;
      }
      return merged;
    }
    if (t.isObjectExpression(expr)) {
      throwCompilationError(
        '[plumeria] Inline style objects are not accepted.',
        expr,
      );
    } else if (
      t.isMemberExpression(expr) &&
      t.isIdentifier(expr.object) &&
      (t.isIdentifier(expr.property) || expr.property.type === 'Computed')
    ) {
      const varName = (expr.object as Identifier).value;
      let propName: string;
      if (expr.property.type === 'Computed') {
        const keyExpr = expr.property.expression;
        if (!t.isStringLiteral(keyExpr)) return null;
        propName = keyExpr.value;
      } else {
        propName = (expr.property as Identifier).value;
      }
      const styleInfo = localCreateStyles[varName];
      if (styleInfo?.obj[propName]) {
        const style = styleInfo.obj[propName];
        if (typeof style === 'object' && style !== null)
          return style as CSSObject;
      }
      const hash = mergedCreateTable[varName];
      if (hash) {
        const obj = scannedTables.createObjectTable[hash];
        if (obj?.[propName] && typeof obj[propName] === 'object')
          return obj[propName] as CSSObject;
      }
    } else if (t.isIdentifier(expr)) {
      const varName = (expr as Identifier).value;
      const uniqueKey = `${resourcePath}-${varName}`;
      let hash = scannedTables.createHashTable[uniqueKey];
      if (!hash) hash = mergedCreateTable[varName];
      if (hash) {
        const obj = scannedTables.createObjectTable[hash];
        if (obj && typeof obj === 'object') return obj;
      }
      const styleInfo = localCreateStyles[varName];
      if (styleInfo?.obj) return styleInfo.obj;
    }
    return null;
  };

  const isStyleFunctionCall = (expr: Expression): boolean => {
    if (!t.isCallExpression(expr) || !t.isMemberExpression(expr.callee))
      return false;
    const callee = expr.callee;
    if (!t.isIdentifier(callee.object) || !t.isIdentifier(callee.property))
      return false;
    return Boolean(
      localCreateStyles[callee.object.value]?.functions?.[
        callee.property.value
      ] ??
      createFunctionImportMap[callee.object.value]?.[callee.property.value],
    );
  };

  const carriesStyleReference = (expression: Expression): boolean => {
    const node = unwrapExpression(expression) as Expression;
    if (node.type === 'ArrayExpression')
      return node.elements.some(
        (element) => !!element && carriesStyleReference(element.expression),
      );
    if (isStyleFunctionCall(node)) return true;
    if (t.isObjectExpression(node)) return false;
    return resolveStyleObject(node) !== null;
  };

  const assertNoStyleArraySpread = (expression: Expression) => {
    const node = unwrapExpression(expression) as Expression;
    if (node.type !== 'ArrayExpression') return;
    const spread = node.elements.find((element) => element?.spread);
    if (!spread) return;
    if (carriesStyleReference(node))
      throwCompilationError(
        spreadStyleMessage(getSource(spread.expression)),
        spread.expression as HasSpan,
      );
  };

  const resolveDynamicCall = (
    expr: Expression,
    forceRuntime = false,
  ): { style: CSSObject; vars: DynamicVar[] } | null => {
    if (!t.isCallExpression(expr) || !t.isMemberExpression(expr.callee))
      return null;
    const callee = expr.callee;
    if (!t.isIdentifier(callee.object) || !t.isIdentifier(callee.property))
      return null;

    if (!isVisibleReference(callee.object)) return null;
    const functionName = callee.property.value;
    const styleInfo = localCreateStyles[callee.object.value];
    const func =
      styleInfo?.functions?.[functionName] ??
      createFunctionImportMap[callee.object.value]?.[functionName];
    if (!func) return null;

    const callArgs = (expr as CallExpression).arguments;
    if (callArgs.some((a) => a.spread)) return null;

    const tempStaticTable = { ...mergedStaticTable };
    const providedParams = new Set<string>();
    const runtime: Array<{ param: string; source: Expression }> = [];
    const extra: Expression[] = [];

    const resolveObjectArg = (argExpr: ObjectExpression) =>
      objectExpressionToObject(
        {
          ...argExpr,
          properties: argExpr.properties.filter(
            (prop) =>
              prop.type === 'Identifier' ||
              (prop.type === 'KeyValueProperty' &&
                prop.key.type !== 'Computed' &&
                isStaticArgValue(prop.value)),
          ),
        },
        mergedStaticTable,
        mergedKeyframesTable,
        mergedViewTransitionTable,
        mergedCreateThemeHashTable,
        scannedTables.createThemeObjectTable,
        mergedCreateTable,
        mergedCreateStaticHashTable,
        scannedTables.createStaticObjectTable,
        undefined,
        mergedVarTypeTable,
        mergedPositionTryTable,
      );

    if (func.named) {
      const argExpr = callArgs[0]?.expression;
      if (
        callArgs.length > 1 ||
        (argExpr && argExpr.type !== 'ObjectExpression')
      ) {
        throwCompilationError(
          `[plumeria] ${getSource(expr)} takes one object argument, because ${functionName} destructures its parameter.`,
          expr as HasSpan,
        );
      }
      const given = new Map<string, Expression>();
      const give = (key: string, value: Expression) => {
        const earlier = given.get(key);
        if (earlier) extra.push(earlier);
        given.set(key, value);
      };
      ((argExpr as ObjectExpression)?.properties ?? []).forEach((prop) => {
        const at =
          prop.type === 'SpreadElement'
            ? prop.arguments
            : 'key' in prop && prop.key.type === 'Computed'
              ? prop.key
              : undefined;
        if (at)
          throwCompilationError(
            `[plumeria] ${getSource(expr)} cannot take a spread or a computed key, because ${functionName} destructures its parameter. Write each key out.`,
            at as HasSpan,
          );
        if (prop.type === 'Identifier') {
          give(prop.value, prop);
        } else if (
          prop.type === 'KeyValueProperty' &&
          (t.isIdentifier(prop.key) || t.isStringLiteral(prop.key))
        ) {
          give(String(prop.key.value), prop.value);
        }
      });

      const argObj = argExpr
        ? (resolveObjectArg(argExpr as ObjectExpression) ?? {})
        : {};
      func.named.forEach(({ key, local }) => {
        const source = given.get(key);
        if (!source) {
          if (func.defaults?.[local]) return;
          return throwCompilationError(
            `[plumeria] ${getSource(expr)} leaves "${key}" unset, and a dynamic style function has no value to fall back on.`,
            expr as HasSpan,
          );
        }
        if (
          !forceRuntime &&
          isStaticArgValue(source) &&
          argObj[key] !== undefined
        ) {
          tempStaticTable[local] = argObj[key];
          providedParams.add(local);
        } else runtime.push({ param: local, source });
      });
      given.forEach((source, key) => {
        if (!func.named!.some((param) => param.key === key)) extra.push(source);
      });
    } else if (
      callArgs.length === 1 &&
      callArgs[0].expression.type === 'ObjectExpression'
    ) {
      if (forceRuntime) return null;
      const argObj =
        resolveObjectArg(callArgs[0].expression as ObjectExpression) ?? {};
      func.params.forEach((p) => {
        if (argObj[p] !== undefined) {
          tempStaticTable[p] = argObj[p];
          providedParams.add(p);
        }
      });
    } else {
      callArgs.forEach((callArg, i) => {
        const p = func.params[i];
        if (!p) extra.push(callArg.expression);
        else runtime.push({ param: p, source: callArg.expression });
      });
    }

    const resolved = resolveDynamicStyle(
      func,
      runtime.map(({ param }) => param),
      tempStaticTable,
      dynamicStyleTables,
      providedParams,
      new Set(
        runtime
          .filter(({ source }) => isDefinedArgument(source))
          .map(({ param }) => param),
      ),
    );
    const { style, varGroups, derived } = resolved;

    const textOf = (source: Expression) => {
      const { start, end } = (source as HasSpan).span;
      return sourceBuffer
        .subarray(start - baseByteOffset, end - baseByteOffset)
        .toString('utf-8');
    };
    const reads = [
      ...runtime.map(({ param, source }) => ({ source, param })),
      ...extra.map((source) => ({ source, param: undefined })),
    ]
      .map(({ source, param }) => ({
        start: (source as HasSpan).span.start,
        param,
        text: textOf(source),
      }))
      .filter(({ text }) => !isLiteralSource(text))
      .sort((a, b) => a.start - b.start);
    const base = argBase ?? 0;
    if (argBase !== null) argBase += reads.length;
    const names = reads.map((_, index) => `__plumeria_arg${base + index}`);
    const argSources = new Map<string, string>();
    runtime.forEach(({ param, source }) => {
      const index = reads.findIndex((read) => read.param === param);
      argSources.set(param, index < 0 ? textOf(source) : names[index]);
    });
    const call: CallBinding | undefined = reads.length
      ? { params: names, args: reads.map(({ text }) => text) }
      : undefined;
    const runtimeSources = runtime.map(({ param }) => ({
      name: param,
      argSource: argSources.get(param)!,
    }));
    derived.forEach(({ name, pieces }) => {
      runtimeSources.push({
        name,
        argSource: pieces
          .map((piece) => {
            if (typeof piece === 'string') return piece;
            const source = String(argSources.get(piece.param));
            return piece.fallback === undefined
              ? `(${source})`
              : readOnce(
                  source,
                  (value) =>
                    `(${value}) === undefined ? ${piece.fallback} : (${value})`,
                );
          })
          .join(''),
      });
    });

    const vars: DynamicVar[] = [];
    runtimeSources.forEach(({ name, argSource }) => {
      const groups = varGroups.get(name);
      if (!groups?.length) return;

      const maybeNumber = Number(argSource);

      groups.forEach(({ cssVar, prop, unit, written }) => {
        let valueExpr: string;
        const kebabProp = camelToKebabCase(prop);
        const isNumberLiteral =
          !isNaN(maybeNumber) && argSource.trim() === String(maybeNumber);
        const isStringLiteral =
          (argSource.startsWith('"') && argSource.endsWith('"')) ||
          (argSource.startsWith("'") && argSource.endsWith("'"));
        if (written) {
          if (isNumberLiteral) {
            valueExpr = JSON.stringify(`${maybeNumber}${unit}`);
          } else if (isStringLiteral) {
            valueExpr = JSON.stringify(`${argSource.slice(1, -1)}${unit}`);
          } else {
            valueExpr = `((${argSource}) + '${unit}')`;
          }
        } else if (isNumberLiteral) {
          valueExpr = JSON.stringify(applyCssValue(maybeNumber, kebabProp));
        } else if (isStringLiteral) {
          valueExpr = JSON.stringify(
            applyCssValue(argSource.slice(1, -1), kebabProp),
          );
        } else {
          valueExpr = unit
            ? readOnce(
                argSource,
                (value) =>
                  `typeof (${value}) === 'number' ? (${value}) + '${unit}' : (${value})`,
              )
            : argSource;
        }
        vars.push({ cssVar, valueExpr, call });
      });
    });
    if (!vars.length && call) vars.push({ cssVar: '', valueExpr: '', call });

    return { style, vars };
  };

  const resolveCreateObject = (varName: string): CSSObject | null => {
    const localStyle = localCreateStyles[varName];
    if (localStyle?.type === 'create') return localStyle.obj;

    let hash = scannedTables.createHashTable[`${resourcePath}-${varName}`];
    if (!hash) hash = mergedCreateTable[varName];
    if (hash && scannedTables.createObjectTable[hash])
      return scannedTables.createObjectTable[hash];

    return null;
  };

  const resolveBracketGroup = (
    node: Expression,
  ): { varName: string; keyExpr: Expression; obj: CSSObject } | null => {
    if (
      !t.isMemberExpression(node) ||
      !t.isIdentifier(node.object) ||
      node.property.type !== 'Computed' ||
      t.isStringLiteral(node.property.expression)
    ) {
      return null;
    }
    if (!isVisibleReference(node.object)) return null;
    const varName = (node.object as Identifier).value;
    const obj = resolveCreateObject(varName);
    return obj ? { varName, keyExpr: node.property.expression, obj } : null;
  };

  interface Decision {
    keyExpr: string;
    options: Array<{ value: string; style: CSSObject }>;
    leaves: number;
    hasGroup: boolean;
  }

  const buildDecision = (
    node: Expression,
    prefix: string,
    off: string,
    counter: { n: number },
    scoped: boolean,
  ): Decision | null => {
    if (node.type === 'ParenthesisExpression') {
      return buildDecision(node.expression, prefix, off, counter, scoped);
    }
    if (node.type === 'ConditionalExpression') {
      const a = buildDecision(node.consequent, prefix, off, counter, scoped);
      if (!a) return null;
      const b = buildDecision(node.alternate, prefix, off, counter, scoped);
      if (!b) return null;
      return {
        keyExpr: `((${getSource(node.test)}) ? ${a.keyExpr} : ${b.keyExpr})`,
        options: [...a.options, ...b.options],
        leaves: a.leaves + b.leaves,
        hasGroup: a.hasGroup || b.hasGroup,
      };
    }
    if (node.type === 'BinaryExpression' && node.operator === '&&') {
      const right = buildDecision(node.right, prefix, off, counter, scoped);
      if (!right) return null;
      return {
        keyExpr: `((${getSource(node.left)}) ? ${right.keyExpr} : ${JSON.stringify(off)})`,
        options: right.options,
        leaves: right.leaves + 1,
        hasGroup: right.hasGroup,
      };
    }
    const group = resolveBracketGroup(node);
    if (group) {
      const tag = scoped ? `${counter.n++}:` : '';
      const keySource = getSource(group.keyExpr);
      return {
        keyExpr: tag ? `(${JSON.stringify(tag)} + ${keySource})` : keySource,
        options: Object.entries(group.obj).map(([value, style]) => ({
          value: `${tag}${value}`,
          style: style as CSSObject,
        })),
        leaves: 1,
        hasGroup: true,
      };
    }
    const style = resolveStyleObject(node);
    if (!style) return null;
    const value = `${prefix}${counter.n++}`;
    return {
      keyExpr: JSON.stringify(value),
      options: [{ value, style }],
      leaves: 1,
      hasGroup: false,
    };
  };

  const collectGroupKeys = (
    node: Expression,
    acc: Map<string, Set<unknown>>,
  ) => {
    if (node.type === 'ParenthesisExpression') {
      collectGroupKeys(node.expression, acc);
    } else if (node.type === 'ConditionalExpression') {
      collectGroupKeys(node.consequent, acc);
      collectGroupKeys(node.alternate, acc);
    } else if (node.type === 'BinaryExpression' && node.operator === '&&') {
      collectGroupKeys(node.right, acc);
    } else {
      const group = resolveBracketGroup(node);
      if (group)
        Object.entries(group.obj).forEach(([key, style]) => {
          let styles = acc.get(key);
          if (!styles) acc.set(key, (styles = new Set()));
          styles.add(style);
        });
    }
  };

  const resolveDecision = (node: Expression): Decision | null => {
    const groupKeys = new Map<string, Set<unknown>>();
    collectGroupKeys(node, groupKeys);
    let prefix = '#';
    while ([...groupKeys.keys()].some((k) => k.startsWith(prefix)))
      prefix += '#';
    const scoped = [...groupKeys.values()].some((styles) => styles.size > 1);
    const off = !scoped && groupKeys.has('') ? `${prefix}off` : '';
    return buildDecision(node, prefix, off, { n: 0 }, scoped);
  };

  let elementReads: Map<string, string> | null = null;
  const readText = (node: any): string =>
    elementReads?.get(spanKey(spanOf(node))) ?? getSource(node);

  interface ElementPlan {
    params: string[];
    vars: Array<{ name: string; always: boolean }>;
    folds: string[];
    reads: Map<string, string>;
    classRuntime: boolean;
    styleRuntime: boolean;
    assign: boolean;
    base: number;
  }

  const newPlan = (assign = false, base = 0): ElementPlan => ({
    params: [],
    vars: [],
    folds: [],
    reads: new Map(),
    classRuntime: false,
    styleRuntime: false,
    assign,
    base,
  });

  const slot = (plan: ElementPlan, kind: string) => {
    const name = `__plumeria_${kind}${plan.base + plan.params.length}`;
    plan.params.push(name);
    return name;
  };

  const planItem = (plan: ElementPlan, name: string, value: string) =>
    plan.assign ? `(${name} = ${value})` : value;

  const readsNothing = (node: any): boolean => {
    switch (node.type) {
      case 'StringLiteral':
      case 'NumericLiteral':
      case 'BooleanLiteral':
      case 'NullLiteral':
        return true;
      case 'TemplateLiteral':
        return node.expressions.length === 0;
      case 'ParenthesisExpression':
        return readsNothing(node.expression);
      case 'UnaryExpression':
        return node.argument.type === 'NumericLiteral';
      case 'ObjectExpression':
        return node.properties.every(
          (property: any) =>
            property.type === 'KeyValueProperty' &&
            property.key.type !== 'Computed' &&
            readsNothing(property.value),
        );
      default:
        return false;
    }
  };

  const varsObject = (
    vars: DynamicVar[],
    assign: boolean,
  ): { object: string; runtime: boolean; always: boolean } | null => {
    const first = vars[0];
    if (!first) return null;
    const pairs = vars
      .filter((entry) => entry.cssVar)
      .map((entry) => `"${entry.cssVar}": ${entry.valueExpr}`);
    if (!first.call)
      return {
        object: `{ ${pairs.join(', ')} }`,
        runtime: false,
        always: true,
      };
    if (assign)
      return {
        object: assignedCall(
          first.call,
          pairs.length ? `{ ${pairs.join(', ')} }` : 'null',
        ),
        runtime: true,
        always: pairs.length > 0,
      };
    const body = pairs.length ? `({ ${pairs.join(', ')} })` : 'null';
    return {
      object: invoke(
        first.call.params.join(', '),
        body,
        first.call.args.join(', '),
      ),
      runtime: true,
      always: pairs.length > 0,
    };
  };

  const planTopElement = (
    expr: Expression,
    plan: ElementPlan,
  ): string[] | null => {
    expr = resolveLocalStyleAlias(localStyleAliases, expr);
    if (
      t.isMemberExpression(expr) &&
      t.isIdentifier(expr.object) &&
      expr.property.type === 'Computed' &&
      expr.property.expression.type !== 'StringLiteral' &&
      isVisibleReference(expr) &&
      resolveCreateObject(expr.object.value)
    ) {
      const dynExpr = expr.property.expression;
      const name = slot(plan, 't');
      plan.reads.set(spanKey(spanOf(dynExpr)), name);
      plan.classRuntime = true;
      return [planItem(plan, name, `(${getSource(dynExpr)})`)];
    }
    const decision = resolveDecision(expr);
    if (decision && (decision.hasGroup || decision.leaves > 2)) {
      const name = slot(plan, 't');
      plan.reads.set(spanKey(spanOf(expr)), name);
      plan.classRuntime = true;
      return [planItem(plan, name, `(${decision.keyExpr})`)];
    }
    return planElement(expr, false, plan);
  };

  const planElement = (
    node: Expression,
    guarded: boolean,
    plan: ElementPlan,
  ): string[] | null => {
    node = resolveLocalStyleAlias(localStyleAliases, unwrapExpression(node));
    if (isNoOpStyle(node)) return [];
    if (t.isIdentifier(node)) return null;
    if (node.type === 'ArrayExpression') {
      const items: string[] = [];
      for (const element of node.elements) {
        if (!element) continue;
        if (element.spread) return null;
        const more = planElement(element.expression, guarded, plan);
        if (!more) return null;
        items.push(...more);
      }
      return items;
    }
    if (
      t.isMemberExpression(node) &&
      t.isIdentifier(node.object) &&
      componentParamNames.has(node.object.value)
    )
      return null;
    if (resolveStyleObject(node)) return [];
    const dynamic = resolveDynamicCall(node);
    if (dynamic) {
      const vars = varsObject(dynamic.vars, plan.assign);
      if (!vars) return [];
      const name = slot(plan, 'v');
      plan.vars.push({ name, always: vars.always && !guarded });
      plan.styleRuntime ||= vars.runtime || guarded;
      return [planItem(plan, name, vars.object)];
    }
    let test: Expression;
    let consequent: Expression;
    let alternate: Expression | undefined;
    if (node.type === 'ConditionalExpression') {
      test = node.test;
      consequent = node.consequent;
      alternate = node.alternate;
    } else if (node.type === 'BinaryExpression' && node.operator === '&&') {
      test = node.left;
      consequent = node.right;
    } else return null;
    return planGuard(test, consequent, alternate, plan, (node, plan) =>
      planElement(node, true, plan),
    );
  };

  const planReceiver = (
    node: Expression,
    plan: ElementPlan,
  ): string[] | null => {
    node = unwrapExpression(node);
    if (isNoOpStyle(node)) return [];
    if (node.type === 'ArrayExpression') {
      const items: string[] = [];
      for (const element of node.elements) {
        if (!element) continue;
        if (element.spread) return null;
        const more = planReceiver(element.expression, plan);
        if (!more) return null;
        items.push(...more);
      }
      return items;
    }
    if (node.type === 'ConditionalExpression') {
      if (node.test.type === 'BooleanLiteral')
        return planReceiver(
          node.test.value ? node.consequent : node.alternate,
          plan,
        );
      return planGuard(
        node.test,
        node.consequent,
        node.alternate,
        plan,
        planReceiver,
      );
    }
    if (node.type === 'BinaryExpression' && node.operator === '&&') {
      if (node.left.type === 'BooleanLiteral')
        return node.left.value ? planReceiver(node.right, plan) : [];
      return planGuard(node.left, node.right, undefined, plan, planReceiver);
    }
    if (t.isMemberExpression(node) && node.property.type === 'Computed') {
      const key = node.property.expression;
      const literal = unwrapExpression(key);
      if (literal.type === 'StringLiteral' || literal.type === 'NumericLiteral')
        return [];
      const name = slot(plan, 't');
      plan.reads.set(spanKey(spanOf(key)), name);
      return [planItem(plan, name, `(${getSource(key)})`)];
    }
    if (isStyleFunctionCall(node)) {
      const dynamic = resolveDynamicCall(node, true);
      if (!dynamic) return null;
      if (!dynamic.vars.length) return [];
      const name = slot(plan, 'v');
      plan.reads.set(spanKey(spanOf(node)), name);
      plan.vars.push({ name, always: true });
      if (plan.assign) {
        const object = varsObject(dynamic.vars, true)?.object ?? '';
        plan.folds.push(object);
        return [planItem(plan, name, object)];
      }
      const fold = foldDynamicVars(dynamic.vars, false, invoke).join(', ');
      plan.folds.push(fold);
      return [`{ ${fold} }`];
    }
    return [];
  };

  const planGuard = (
    test: Expression,
    consequent: Expression,
    alternate: Expression | undefined,
    plan: ElementPlan,
    recurse: (node: Expression, plan: ElementPlan) => string[] | null,
  ): string[] | null => {
    const name = slot(plan, 't');
    plan.reads.set(spanKey(spanOf(test)), name);
    plan.classRuntime = true;
    const start = plan.params.length;
    const yes = recurse(consequent, plan);
    if (!yes) return null;
    const middle = plan.params.length;
    const no = alternate ? recurse(alternate, plan) : [];
    if (!no) return null;
    const end = plan.params.length;
    if (end === start) return [planItem(plan, name, `(${getSource(test)})`)];
    if (plan.assign) {
      const reset = (params: string[]) =>
        params.map((param) => `${param} = null`);
      const truthy = [...yes, ...reset(plan.params.slice(middle, end))];
      const falsy = [...reset(plan.params.slice(start, middle)), ...no];
      const group = (steps: string[]) =>
        steps.length ? steps.join(', ') : 'null';
      return [
        `((${name} = (${getSource(test)})) ? (${group(truthy)}) : (${group(falsy)}))`,
      ];
    }
    const nulls = (count: number) => Array<string>(count).fill('null');
    const truthy = ['true', ...yes, ...nulls(end - middle)];
    const falsy = ['false', ...nulls(middle - start), ...no];
    return [
      `...((${getSource(test)}) ? [${truthy.join(', ')}] : [${falsy.join(', ')}])`,
    ];
  };

  const buildClassParts = (
    args: Array<{ expression: Expression; order?: number }>,
    dynamicClassParts: string[] = [],
    existingClass: string = '',
    isStyleProp: boolean = false,
  ): {
    classParts: string[];
    isOptimizable: boolean;
    baseStyle: CSSObject;
    dynamicVars: DynamicVar[];
    propVarSpreads: string[];
  } => {
    args.forEach((arg) => {
      arg.expression = resolveLocalStyleAlias(
        localStyleAliases,
        arg.expression,
      );
    });

    const conditionals: StyleConditional[] = [];
    const dynamicVars: DynamicVar[] = [];
    const propVarSpreads: string[] = [];
    let groupIdCounter = 0;
    let sourceOrder = 0;
    const baseChunks: Array<{ order: number; style: CSSObject }> = [];
    let baseStyle: CSSObject = {};
    let isOptimizable = true;

    const collectConditions = (
      node: Expression,
      currentTestStrings: string[] = [],
      argOrder?: number,
    ): boolean => {
      node = unwrapExpression(node);
      node = resolveLocalStyleAlias(localStyleAliases, node);
      if (isNoOpStyle(node)) return true;
      if (node.type === 'ArrayExpression') {
        return node.elements.every((element) => {
          if (!element) return true;
          if (element.spread)
            throwCompilationError(
              spreadStyleMessage(getSource(element.expression)),
              element.expression as HasSpan,
            );
          return collectConditions(
            element.expression,
            currentTestStrings,
            argOrder,
          );
        });
      }
      let branchStyle = resolveStyleObject(node);
      if (!branchStyle) {
        const dynamic = resolveDynamicCall(node);
        if (dynamic) {
          if (!isStyleProp) {
            throwCompilationError(
              `[plumeria] css.use(${getSource(
                node,
              )}) does not support dynamic function keys.`,
              node as HasSpan,
            );
          }
          branchStyle = dynamic.style;
          if (!elementReads)
            dynamic.vars.forEach((v) =>
              dynamicVars.push({
                ...v,
                test: currentTestStrings.length
                  ? currentTestStrings.join(' && ')
                  : undefined,
                order: argOrder,
              }),
            );
        }
      }
      if (branchStyle) {
        const staticStyle = branchStyle;
        if (currentTestStrings.length === 0) {
          baseStyle = deepMerge(baseStyle, staticStyle);
          baseChunks.push({ order: sourceOrder++, style: staticStyle });
        } else {
          conditionals.push({
            test: node,
            testString: currentTestStrings.join(' && '),
            truthy: staticStyle,
            falsy: {},
            varName: undefined,
            order: sourceOrder++,
          });
        }
        return true;
      }
      if (node.type === 'ConditionalExpression') {
        const testSource = readText(node.test);
        if (currentTestStrings.length === 0) {
          const trueStyle = resolveStyleObject(node.consequent);
          const falseStyle = resolveStyleObject(node.alternate);
          if (trueStyle && falseStyle) {
            conditionals.push({
              test: node,
              testString: testSource,
              truthy: trueStyle,
              falsy: falseStyle,
              varName: undefined,
              order: sourceOrder++,
            });
            return true;
          }
        }
        const consequentHandled = collectConditions(
          node.consequent,
          [...currentTestStrings, `(${testSource})`],
          argOrder,
        );
        const alternateHandled = collectConditions(
          node.alternate,
          [...currentTestStrings, `!(${testSource})`],
          argOrder,
        );
        return consequentHandled && alternateHandled;
      } else if (node.type === 'BinaryExpression' && node.operator === '&&') {
        return collectConditions(
          node.right,
          [...currentTestStrings, `(${readText(node.left)})`],
          argOrder,
        );
      } else if (node.type === 'ParenthesisExpression') {
        return collectConditions(node.expression, currentTestStrings, argOrder);
      }

      if (pushPropPossibilities(node, currentTestStrings)) return true;

      assertResolvable(node as HasSpan);
      return false;
    };

    const pushPropPossibilities = (
      expr: Expression,
      gates: string[],
    ): boolean => {
      const isParamMember =
        t.isMemberExpression(expr) &&
        t.isIdentifier(expr.object) &&
        componentParamNames.has(expr.object.value) &&
        t.isIdentifier(expr.property);
      if (!t.isIdentifier(expr) && !isParamMember) return false;
      const paramObject = isParamMember
        ? ((expr as MemberExpression).object as Identifier).value
        : undefined;
      const isPropsMember = Boolean(
        paramObject &&
        localCreateStyles[paramObject] === undefined &&
        mergedCreateTable[paramObject] === undefined,
      );

      const varName = t.isIdentifier(expr)
        ? expr.value
        : ((expr as MemberExpression).property as Identifier).value;
      const source = t.isIdentifier(expr) ? varName : getSource(expr);
      const owner = ownerComponentOf(expr as HasSpan);
      const propName =
        (t.isIdentifier(expr) && owner
          ? propAliases.get(owner)?.get(varName)
          : undefined) ?? varName;
      markStylePropApplied(propName, expr as HasSpan);

      let possibilities: any[] | undefined = owner
        ? scannedTables.componentPropsTable?.[`${resourcePath}-${owner}`]?.[
            propName
          ]
        : undefined;
      if (!possibilities) {
        const candidates: any[] = [];
        for (const key of Object.keys(
          scannedTables.componentPropsTable || {},
        )) {
          if (!key.startsWith(`${resourcePath}-`)) continue;
          const entries = scannedTables.componentPropsTable?.[key]?.[propName];
          if (entries) candidates.push(...entries);
        }
        if (candidates.length > 0) possibilities = candidates;
      }
      const fallback = owner && propDefaults.get(owner)?.get(propName);
      if (fallback && !isNoOpStyle(unwrapExpression(fallback))) {
        const style = resolveStyleObject(fallback);
        if (!style)
          throwCompilationError(
            propDefaultMessage(getSource(fallback)),
            fallback as HasSpan,
          );
        const atoms: Record<string, string> = {};
        getStyleRecords(style as CSSProperties).forEach((record) => {
          atoms[record.key] = record.hash;
        });
        const key = genBase36Hash(Object.values(atoms).join(' '), 1, 8);
        possibilities = [...(possibilities ?? []), { key, styleObj: style }];
        const span = (fallback as HasSpan).span;
        for (let index = replacements.length - 1; index >= 0; index--) {
          const replacement = replacements[index];
          if (
            replacement.start >= span.start - baseByteOffset &&
            replacement.end <= span.end - baseByteOffset
          )
            replacements.splice(index, 1);
        }
        excludeSubtreeSpans(fallback);
        replacements.push({
          start: span.start - baseByteOffset,
          end: span.end - baseByteOffset,
          content: JSON.stringify(key),
        });
      }
      if (!possibilities || possibilities.length === 0) {
        return Boolean(
          isPropsMember || (owner && declaredProps.get(owner)?.has(propName)),
        );
      }

      const carriesVars = possibilities.some((entry) => entry.hasVars);
      if (carriesVars && !isStyleProp) {
        throwCompilationError(
          `[plumeria] "${varName}" carries a dynamic function key, and css.use() returns only a class name. ` +
            `Apply it to ${styleProp} on the element instead.`,
          expr as HasSpan,
        );
      }
      const gate = gates.length ? `(${gates.join(' && ')}) && ` : '';
      if (carriesVars) {
        const spread = `...(${gate}${source} && ${source}.vars)`;
        if (!propVarSpreads.includes(spread)) propVarSpreads.push(spread);
      }

      const token = carriesVars
        ? `((${source} && ${source}.key) || ${source})`
        : source;
      const testLHS = gates.length
        ? `((${gates.join(' && ')}) ? ${token} : "")`
        : token;
      const currentGroupId = ++groupIdCounter;
      const currentOrder = sourceOrder++;

      const seen = new Set<string>();
      const pushOption = (valueName: string, style: CSSObject) => {
        conditionals.push({
          test: expr,
          testLHS,
          testString: `${testLHS} === ${JSON.stringify(valueName)}`,
          truthy: style,
          falsy: {},
          groupId: currentGroupId,
          order: currentOrder,
          groupName: undefined,
          valueName,
          varName,
        });
      };
      possibilities.forEach((entry) => {
        if (seen.has(entry.key)) return;
        seen.add(entry.key);
        pushOption(entry.key, entry.styleObj as CSSObject);
      });
      if (gates.length) pushOption('', {});
      return true;
    };

    for (const arg of args) {
      const expr = arg.expression;

      if (isNoOpStyle(expr)) continue;

      if (pushPropPossibilities(expr, [])) continue;

      if (
        t.isMemberExpression(expr) &&
        t.isIdentifier(expr.object) &&
        expr.property.type === 'Computed' &&
        expr.property.expression.type !== 'StringLiteral'
      ) {
        const varName = expr.object.value;
        const styleObj = isVisibleReference(expr)
          ? resolveCreateObject(varName)
          : null;
        if (styleObj) {
          const dynExpr = expr.property.expression;
          const dynSource = readText(dynExpr);
          const currentGroupId = ++groupIdCounter;
          const currentOrder = sourceOrder++;
          Object.entries(styleObj).forEach(([optionName, style]) => {
            conditionals.push({
              test: dynExpr,
              testLHS: dynSource,
              testString: `${dynSource} === '${optionName}'`,
              truthy: style as CSSObject,
              falsy: {},
              groupId: currentGroupId,
              order: currentOrder,
              groupName: undefined,
              valueName: optionName,
              varName,
            });
          });
          continue;
        }
      }

      const decision = resolveDecision(expr);
      if (decision && (decision.hasGroup || decision.leaves > 2)) {
        const groupId = ++groupIdCounter;
        const currentOrder = sourceOrder++;
        const keyExpr =
          elementReads?.get(spanKey(spanOf(expr))) ?? decision.keyExpr;
        decision.options.forEach(({ value, style }) =>
          conditionals.push({
            test: expr,
            testLHS: keyExpr,
            testString: `${keyExpr} === '${value}'`,
            truthy: style,
            falsy: {},
            groupId,
            order: currentOrder,
            groupName: undefined,
            valueName: value,
            varName: undefined,
            closed: !decision.hasGroup,
          }),
        );
        continue;
      }

      const handled = collectConditions(expr, [], arg.order);
      if (handled) continue;

      assertResolvable(expr as HasSpan);

      isOptimizable = false;
      break;
    }

    if (
      !isOptimizable ||
      (args.length === 0 && Object.keys(baseStyle).length === 0)
    ) {
      return {
        classParts: [...dynamicClassParts],
        isOptimizable,
        baseStyle,
        dynamicVars,
        propVarSpreads,
      };
    }

    const stateSources: StyleSource[] = baseChunks.map(({ order, style }) => ({
      order,
      style: style as CSSProperties,
    }));
    conditionals.forEach((c) => {
      const order = c.order ?? 0;
      stateSources.push({ order, style: c.truthy as CSSProperties });
      stateSources.push({ order, style: c.falsy as CSSProperties });
    });
    const stateWeights = getStateWeights(stateSources);

    const isPlainRead = (source: string) => {
      const code = source.replace(/'[^'\\\n]*'|"[^"\\\n]*"/g, '""');
      return (
        /^[\w$.\s()!=&|?:"]*$/.test(code) &&
        !/[\w$)]\s*\(|(?<!\d)\.|\.(?!\d)|\b(?:new|await|yield|delete|void|import|in|instanceof)\b/.test(
          code,
        ) &&
        !/[=&|]/.test(code.replace(/[=!]==|&&|\|\|/g, ''))
      );
    };
    const lookupTable = (entries: Array<[string, string]>, closed = false) =>
      `{${closed ? '' : '__proto__:null,'}${entries
        .map(
          ([key, value]) =>
            `${key === '__proto__' ? '["__proto__"]' : JSON.stringify(key)}:${value}`,
        )
        .join(',')}}`;
    const testSource = (c: StyleConditional) =>
      c.groupId === undefined ? (c.testString ?? getSource(c.test)) : c.testLHS;
    const bound: string[] = [];
    const skippable = new Set<string>();
    if (
      conditionals.every((c) => testSource(c) !== undefined) &&
      conditionals.some((c) => !isPlainRead(testSource(c) ?? ''))
    ) {
      const boundGroups = new Map<number, string>();
      conditionals.forEach((c) => {
        const name =
          c.groupId === undefined ? undefined : boundGroups.get(c.groupId);
        const param = name ?? `__plumeria${bound.length}`;
        if (name === undefined) bound.push(testSource(c) ?? '');
        if (c.groupId === undefined) c.testString = param;
        else {
          c.testLHS = param;
          boundGroups.set(c.groupId, param);
        }
      });
    }

    const participation: Record<string, Set<string>> = {};
    const registerParticipation = (style: CSSObject, sourceId: string) => {
      Object.keys(style).forEach((key) => {
        if (!participation[key]) participation[key] = new Set();
        participation[key].add(sourceId);
      });
    };

    registerParticipation(baseStyle, 'base');
    conditionals
      .filter((c) => c.groupId === undefined)
      .forEach((c, idx) => {
        registerParticipation(c.truthy, `std_${idx}`);
        registerParticipation(c.falsy, `std_${idx}`);
      });

    const variantGroups: Record<number, StyleConditional[]> = {};
    conditionals.forEach((c) => {
      if (c.groupId !== undefined) {
        if (!variantGroups[c.groupId]) variantGroups[c.groupId] = [];
        variantGroups[c.groupId].push(c);
      }
    });
    Object.entries(variantGroups).forEach(([groupId, opts]) => {
      opts.forEach((opt) =>
        registerParticipation(opt.truthy, `var_${groupId}`),
      );
    });

    const conflictingKeys = new Set<string>();
    Object.entries(participation).forEach(([key, sources]) => {
      if (sources.size > 1) conflictingKeys.add(key);
    });

    const baseIndependent: CSSObject = {};
    const baseConflict: CSSObject = {};
    Object.entries(baseStyle).forEach(([key, val]) => {
      if (conflictingKeys.has(key)) baseConflict[key] = val;
      else baseIndependent[key] = val;
    });

    const indepConditionals: StyleConditional[] = [];
    const conflictConditionals: StyleConditional[] = [];
    conditionals.forEach((c) => {
      const truthyIndep: CSSObject = {};
      const truthyConf: CSSObject = {};
      const falsyIndep: CSSObject = {};
      const falsyConf: CSSObject = {};
      let hasIndep = false;
      let hasConf = false;
      Object.entries(c.truthy).forEach(([k, v]) => {
        if (conflictingKeys.has(k)) {
          truthyConf[k] = v;
          hasConf = true;
        } else {
          truthyIndep[k] = v;
          hasIndep = true;
        }
      });
      Object.entries(c.falsy).forEach(([k, v]) => {
        if (conflictingKeys.has(k)) {
          falsyConf[k] = v;
          hasConf = true;
        } else {
          falsyIndep[k] = v;
          hasIndep = true;
        }
      });
      if (hasIndep)
        indepConditionals.push({
          ...c,
          truthy: truthyIndep,
          falsy: falsyIndep,
        });
      if (hasConf)
        conflictConditionals.push({
          ...c,
          truthy: truthyConf,
          falsy: falsyConf,
        });
    });

    const classParts: string[] = [];

    if (existingClass) classParts.push(existingClass);
    const boundFrom = classParts.length;

    if (Object.keys(baseIndependent).length > 0) {
      const className = processStyleRecords(baseIndependent, stateWeights)
        .map((r) => r.hash)
        .join(' ');
      if (className) classParts.push(JSON.stringify(className));
    }

    indepConditionals
      .filter((c) => c.groupId === undefined)
      .forEach((c) => {
        const processBranch = (style: CSSObject) => {
          if (Object.keys(style).length === 0) return '""';
          return JSON.stringify(
            processStyleRecords(style, stateWeights)
              .map((r) => r.hash)
              .join(' '),
          );
        };
        const testStr = c.testString ?? getSource(c.test);
        classParts.push(
          `(${testStr} ? ${processBranch(c.truthy)} : ${processBranch(c.falsy)})`,
        );
      });

    const indepVarGroups: Record<number, StyleConditional[]> = {};
    indepConditionals.forEach((c) => {
      if (c.groupId !== undefined) {
        if (!indepVarGroups[c.groupId]) indepVarGroups[c.groupId] = [];
        indepVarGroups[c.groupId].push(c);
      }
    });
    Object.values(indepVarGroups).forEach((options) => {
      const commonTestExpr =
        options[0].testLHS ??
        options[0].testString ??
        getSource(options[0].test);
      const lookupMap: Record<string, string> = Object.create(null);
      options.forEach((opt) => {
        if (opt.valueName !== undefined && opt.truthy) {
          const className = processStyleRecords(opt.truthy, stateWeights)
            .map((r) => r.hash)
            .join(' ');
          if (className) lookupMap[opt.valueName] = className;
        }
      });
      if (Object.keys(lookupMap).length > 0) {
        const table = lookupTable(
          Object.entries(lookupMap).map(([k, v]) => [k, JSON.stringify(v)]),
          options[0].closed,
        );
        classParts.push(`(${table}[${commonTestExpr}] || "")`);
      }
    });

    if (
      Object.keys(baseConflict).length > 0 ||
      conflictConditionals.length > 0
    ) {
      interface Dimension {
        type: 'std' | 'var' | 'const';
        options: Array<{
          value: number | string | undefined;
          style: CSSObject;
          label: string;
        }>;
        testExpr?: string;
        closed?: boolean;
      }
      const ordered: Array<{ order: number; dimension: Dimension }> = [];

      baseChunks.forEach(({ order, style }) => {
        const conflicting: CSSObject = {};
        Object.entries(style).forEach(([key, value]) => {
          if (conflictingKeys.has(key)) conflicting[key] = value;
        });
        if (Object.keys(conflicting).length === 0) return;
        ordered.push({
          order,
          dimension: {
            type: 'const',
            options: [{ value: undefined, style: conflicting, label: 'base' }],
          },
        });
      });

      conflictConditionals
        .filter((c) => c.groupId === undefined)
        .forEach((c) => {
          ordered.push({
            order: c.order ?? 0,
            dimension: {
              type: 'std',
              testExpr: c.testString ?? getSource(c.test),
              options: [
                { value: 0, style: c.falsy, label: 'false' },
                { value: 1, style: c.truthy, label: 'true' },
              ],
            },
          });
        });

      const conflictVarGroups: Record<number, StyleConditional[]> = {};
      conflictConditionals.forEach((c) => {
        if (c.groupId !== undefined) {
          if (!conflictVarGroups[c.groupId]) conflictVarGroups[c.groupId] = [];
          conflictVarGroups[c.groupId].push(c);
        }
      });
      Object.keys(conflictVarGroups).forEach((id) => {
        const groupId = Number(id);
        const opts = conflictVarGroups[groupId];
        const present = new Set(opts.map((c) => c.valueName));
        conditionals.forEach((c) => {
          if (c.groupId !== groupId || present.has(c.valueName)) return;
          present.add(c.valueName);
          opts.push({ ...c, truthy: {}, falsy: {} });
        });
      });
      Object.entries(conflictVarGroups).forEach(([, opts]) => {
        ordered.push({
          order: opts[0].order ?? 0,
          dimension: {
            type: 'var',
            testExpr:
              opts[0].testLHS ?? opts[0].testString ?? getSource(opts[0].test),
            options: opts.map((opt) => ({
              value: opt.valueName,
              style: opt.truthy,
              label: opt.valueName || 'default',
            })),
            closed: opts[0].closed,
          },
        });
      });

      ordered.sort((a, b) => a.order - b.order);
      const dimensions: Dimension[] = ordered.map((o) => o.dimension);

      const leafPaths = (style: CSSObject, prefix: string[]): string[][] =>
        Object.entries(style).flatMap(([key, value]) =>
          value && typeof value === 'object' && !Array.isArray(value)
            ? leafPaths(value as CSSObject, [...prefix, key])
            : [[...prefix, key]],
        );

      const leaves = new Map<string, { path: string[]; setters: string[] }>();
      dimensions.forEach((dim, d) =>
        dim.options.forEach((opt, o) =>
          leafPaths(opt.style, []).forEach((path) => {
            const id = JSON.stringify(path);
            const leaf = leaves.get(id);
            if (leaf) leaf.setters.push(`${d}:${o}`);
            else leaves.set(id, { path, setters: [`${d}:${o}`] });
          }),
        ),
      );

      const chains = new Map<string, string[][]>();
      leaves.forEach(({ path, setters }) => {
        const id = setters.join(',');
        const paths = chains.get(id);
        if (paths) paths.push(path);
        else chains.set(id, [path]);
      });

      const pick = (style: CSSObject, paths: string[][]) => {
        const picked: CSSObject = {};
        paths.forEach((path) => {
          let source = style;
          let target = picked;
          path.forEach((key, index) => {
            if (index === path.length - 1) {
              target[key] = source[key];
              return;
            }
            source = source[key] as CSSObject;
            target = (target[key] ??= {}) as CSSObject;
          });
        });
        return picked;
      };

      const generated = [...(elementReads?.values() ?? [])];
      chains.forEach((paths, id) => {
        const classes = new Map<number, Map<number, string>>();
        id.split(',').forEach((setter) => {
          const [d, o] = setter.split(':').map(Number);
          const className = processStyleRecords(
            pick(dimensions[d].options[o].style, paths),
            stateWeights,
          )
            .map((r) => r.hash)
            .join(' ');
          if (!classes.has(d)) classes.set(d, new Map());
          classes.get(d)?.set(o, JSON.stringify(className));
        });

        let expr = '""';
        const tests: string[] = [];
        let last:
          | { test: string; yes: string; no: string; built: string }
          | undefined;
        classes.forEach((byOption, d) => {
          const dim = dimensions[d];
          const previous = last;
          last = undefined;
          if (dim.type === 'const') {
            const className = byOption.get(0);
            if (className !== undefined) {
              expr = className;
              tests.length = 0;
            }
          } else if (dim.type === 'std') {
            const truthy = byOption.get(1) ?? expr;
            const falsy = byOption.get(0) ?? expr;
            const testExpr = dim.testExpr ?? '';
            if (
              previous &&
              previous.built === expr &&
              complementary(previous.test, testExpr, generated)
            ) {
              const whenTrue = falsy === expr ? previous.yes : falsy;
              const whenFalse = truthy === expr ? previous.no : truthy;
              if (whenTrue === whenFalse) {
                tests.pop();
                expr = whenTrue;
              } else {
                expr = `(${previous.test} ? ${whenTrue} : ${whenFalse})`;
                last = {
                  test: previous.test,
                  yes: whenTrue,
                  no: whenFalse,
                  built: expr,
                };
              }
            } else if (truthy === falsy) {
              expr = truthy;
            } else {
              expr = `(${dim.testExpr} ? ${truthy} : ${falsy})`;
              tests.push(testExpr);
              last = { test: testExpr, yes: truthy, no: falsy, built: expr };
            }
          } else {
            tests.push(dim.testExpr ?? '');
            const table = lookupTable(
              [...byOption].map(([o, className]) => [
                String(dim.options[o].value),
                className,
              ]),
              dim.closed,
            );
            expr = `(${table}[${dim.testExpr}] ?? ${expr})`;
          }
        });
        tests.slice(0, -1).forEach((test) => skippable.add(test));
        if (expr !== '""') classParts.push(expr);
      });
    }

    if (bound.length > 0) {
      const parts = classParts.splice(boundFrom);
      const body = parts.join(' + " " + ') || '""';
      const uses = paramMatches(body).map(({ index }) => index);
      const inline =
        uses.length === bound.length &&
        uses.every((use, index) => use === index) &&
        uses.every((use) => !skippable.has(`__plumeria${use}`));
      if (inline)
        classParts.push(...parts.map((part) => inlineParams(part, bound)));
      else if (argBase !== null) {
        const names = argNames(argBase, argBase + bound.length);
        argBase += bound.length;
        classParts.push(
          `(${names.map((name, index) => `${name} = (${bound[index]})`).join(', ')}, ${inlineParams(body, names)})`,
        );
      } else
        classParts.push(
          invoke(
            bound.map((_, index) => `__plumeria${index}`).join(', '),
            body,
            bound.join(', '),
          ),
        );
    }

    classParts.push(...dynamicClassParts);
    return {
      classParts,
      isOptimizable,
      baseStyle,
      dynamicVars,
      propVarSpreads,
    };
  };

  const assignElement = (
    node: JSXAttribute,
    args: Array<{ expression: Expression; order?: number }>,
    plan: ElementPlan,
    plans: Array<{ params: string[]; items: string[] }>,
    site: number,
    classSpan: Place | undefined,
    classPlace: Place | undefined,
    existingClass: string,
    style: { span: Place; value: string } | undefined,
    hosts: Host[],
  ) => {
    const base = plan.base;
    const argEnd = argBase ?? base;
    argBase = null;
    let temps = [...plan.params, ...argNames(base, argEnd)];
    const sxAt = node.span.start;
    const groups: Array<{ at: number; steps: string[] }> = [];
    let classSource = existingClass;
    if (classSpan) {
      const name = `__plumeria_class${base}`;
      groups.push({
        at: classSpan.start,
        steps: [`${name} = ${existingClass}`],
      });
      temps.push(name);
      classSource = name;
    }
    let existingStyle: string | undefined;
    if (style) {
      const name = `__plumeria_style${base}`;
      groups.push({
        at: style.span.start,
        steps: [`${name} = ${style.value}`],
      });
      temps.push(name);
      existingStyle = name;
    }
    const sxSteps = plans.flatMap(({ items }) => items);
    if (sxSteps.length) groups.push({ at: sxAt, steps: sxSteps });
    groups.sort((a, b) => a.at - b.at);

    elementReads = plan.reads;
    let built;
    try {
      built = buildClassParts(args, [], classSource, true);
    } finally {
      elementReads = null;
    }
    const classValue = joinClassParts(built.classParts, plan.params);
    const vars = plan.vars.map(({ name }) => name);
    let styleValue: string | undefined;
    if (!vars.length) styleValue = existingStyle;
    else if (existingStyle === undefined && vars.length === 1)
      styleValue = plan.vars[0].always ? vars[0] : `${vars[0]} || undefined`;
    else {
      const spread = [...(existingStyle ? [existingStyle] : []), ...vars].map(
        (name) => `...${name}`,
      );
      const copy = `{ ${spread.join(', ')} }`;
      styleValue = plan.vars.some(({ always }) => always)
        ? copy
        : `(${vars.join(' || ')}) ? ${copy} : ${existingStyle ?? 'undefined'}`;
    }
    const sequence = (steps: string[], value: string) =>
      steps.length ? `(${steps.join(', ')}, ${value})` : value;
    const later = (span: Place | undefined) =>
      span && span.start > sxAt ? span : undefined;
    const classAt = later(classPlace)?.start ?? sxAt;
    const styleAt = later(style?.span)?.start ?? sxAt;
    const classStatic = !classSpan && staticClass(classValue) !== undefined;
    const targets: Array<[number, number]> = [];
    if (styleValue !== undefined && classStatic) targets.push([styleAt, 1]);
    targets.push([classAt, 0]);
    if (styleValue !== undefined && !classStatic) targets.push([styleAt, 1]);
    hosts.forEach((host, index) => targets.push([host.at, index + 2]));
    const hosted: string[][] = Array.from(
      { length: hosts.length + 2 },
      () => [],
    );
    for (const { at, steps } of groups) {
      let target: [number, number] | undefined;
      for (const candidate of targets)
        if (candidate[0] >= at && (!target || candidate[0] < target[0]))
          target = candidate;
      hosted[target ? target[1] : 0].push(...steps);
    }
    const classText =
      !hosted[0].length &&
      staticClass(classValue) !== undefined &&
      !classValue.includes('&')
        ? classValue
        : `{${sequence(hosted[0], classValue)}}`;
    let styleText: string | undefined;
    if (styleValue !== undefined) {
      const prefix = `(${vars[0]} = `;
      const [step] = hosted[1];
      if (
        hosted[1].length === 1 &&
        vars.length === 1 &&
        existingStyle === undefined &&
        styleValue === vars[0] &&
        step.startsWith(prefix) &&
        step.endsWith(')')
      ) {
        temps = temps.filter((temp) => temp !== vars[0]);
        styleText = step.slice(prefix.length, -1);
      } else styleText = sequence(hosted[1], styleValue);
    }
    const atSx: string[] = [];
    const classAttr = `${classProp}=${classText}`;
    const laterClass = later(classPlace);
    if (laterClass) setReplacement(laterClass, classAttr);
    else atSx.push(classAttr);
    if (styleText !== undefined) {
      const styleAttr = `style={${styleText}}`;
      const laterStyle = later(style?.span);
      if (laterStyle) setReplacement(laterStyle, styleAttr);
      else atSx.push(styleAttr);
    }
    replacements.push({
      start: node.span.start - baseByteOffset,
      end: node.span.end - baseByteOffset,
      content: atSx.join(' '),
    });
    hosts.forEach((host, index) => {
      const steps = hosted[index + 2];
      if (!steps.length) return;
      const [open, close] = host.braces ? ['{(', ')}'] : ['(', ')'];
      replacements.push({
        start: host.open - baseByteOffset,
        end: host.open - baseByteOffset,
        content: `${open}${steps.join(', ')}, `,
      });
      replacements.push({
        start: host.close - baseByteOffset,
        end: host.close - baseByteOffset,
        content: close,
      });
    });
    tempNext.set(site, Math.max(argEnd, base + plan.params.length, base + 1));
    if (temps.length) declareTemps(site, temps);
  };

  const definitionTables = [
    'keyframesHashTable',
    'viewTransitionHashTable',
    'positionTryHashTable',
    'varTypeHashTable',
    'createThemeHashTable',
    'createHashTable',
    'createStaticHashTable',
  ] as const;

  const namespacePath = (name: string) => {
    const namespaceImport = localImports[name];
    return namespaceImport?.importedName === '*'
      ? namespaceImport.actualPath
      : undefined;
  };

  const definitionKey = (actualPath: string, propName: string) => {
    const resolved = resolveExport(actualPath, propName);
    return resolved
      ? `${resolved.filePath}-${resolved.localName}`
      : `${actualPath}-${propName}`;
  };

  const isDefinitionKey = (uniqueKey: string) =>
    definitionTables.some((table) =>
      Boolean(scannedTables[table]?.[uniqueKey]),
    );

  const namespaceReads = new Set<number>();

  const staticKey = (expr: Expression) =>
    expr.type === 'StringLiteral'
      ? expr.value
      : expr.type === 'TemplateLiteral' && expr.expressions.length === 0
        ? (expr.quasis[0]?.cooked ?? undefined)
        : undefined;

  const patternKey = (key: PropertyName) =>
    key.type === 'Identifier' || key.type === 'StringLiteral'
      ? key.value
      : key.type === 'Computed'
        ? staticKey(key.expression)
        : undefined;

  const exportedDefinition = (actualPath: string) =>
    exportNames(actualPath).find((exportName) =>
      isDefinitionKey(definitionKey(actualPath, exportName)),
    );

  const namespaceKeys = (
    namespace: string,
    actualPath: string,
    keys: [string | undefined, HasSpan][],
  ) => {
    for (const [key, node] of keys) {
      if (key !== undefined) {
        if (isDefinitionKey(definitionKey(actualPath, key)))
          throwNamespaceRead(namespace, key, node);
        continue;
      }
      const name = exportedDefinition(actualPath);
      if (name) throwNamespaceRead(namespace, name, node);
    }
  };

  const namespacePattern = (pattern: ObjectPattern, init: Expression) => {
    if (
      !t.isIdentifier(init) ||
      !referenceIdents.references.has(init.span.start)
    )
      return;
    const actualPath = namespacePath(init.value);
    if (!actualPath) return;
    namespaceKeys(
      init.value,
      actualPath,
      pattern.properties.map((prop): [string | undefined, HasSpan] => [
        prop.type === 'RestElement'
          ? undefined
          : prop.type === 'AssignmentPatternProperty'
            ? prop.key.value
            : patternKey(prop.key),
        prop.type === 'KeyValuePatternProperty' ? prop.key : prop,
      ]),
    );
    namespaceReads.add(init.span.start);
  };

  const throwNamespaceRead = (
    namespace: string,
    propName: string,
    node: HasSpan,
  ) =>
    throwCompilationError(
      `[plumeria] ${namespace}.${propName} reads a Plumeria definition through a namespace import, which cannot be compiled. Import it by name: import { ${propName} } from '...'.`,
      node,
    );

  traverse(ast, {
    JSXOpeningElement({ node }: { node: JSXOpeningElement }) {
      const owner = {
        compKey: resolveComponentKey(node.name, resourcePath, localImports),
        attributes: node.attributes,
      };
      for (const attribute of node.attributes)
        if (attribute.type === 'JSXAttribute')
          jsxAttributeOwnerMap.set(attribute.span.start, owner);
    },
    VariableDeclarator({ node }: { node: VariableDeclarator }) {
      if (node.id.type === 'ObjectPattern' && node.init)
        namespacePattern(node.id, node.init);
    },
    AssignmentExpression({ node }: { node: AssignmentExpression }) {
      if (node.left.type === 'ObjectPattern')
        namespacePattern(node.left, node.right);
    },
    MemberExpression({ node }: { node: MemberExpression }) {
      if (!isVisibleReference(node)) return;
      if (t.isIdentifier(node.object)) {
        const actualPath = namespacePath(node.object.value);
        const propName = t.isIdentifier(node.property)
          ? node.property.value
          : node.property.type === 'Computed'
            ? staticKey(node.property.expression)
            : undefined;
        if (actualPath && propName !== undefined) {
          namespaceKeys(node.object.value, actualPath, [[propName, node]]);
          namespaceReads.add(node.object.span.start);
        }
      }
      if (
        t.isIdentifier(node.object) &&
        (t.isIdentifier(node.property) || node.property.type === 'Computed')
      ) {
        const varName = node.object.value;
        const uniqueKey = `${resourcePath}-${varName}`;

        if (node.property.type === 'Computed') {
          const dynExpr = node.property.expression;
          const dynSource = getSource(dynExpr);
          const localStyle = localCreateStyles[varName];
          let hashMap: Record<string, any> | undefined;

          if (localStyle) {
            hashMap = localStyle.hashMap;
          } else {
            let hash = scannedTables.createHashTable[uniqueKey];
            if (!hash) {
              hash = mergedCreateTable[varName];
            }
            if (hash) {
              const obj = scannedTables.createObjectTable[hash];
              const atomicMap = scannedTables.createAtomicMapTable[hash];
              if (obj && atomicMap) {
                hashMap = {};
                Object.keys(obj).forEach((key) => {
                  if (atomicMap[key]) {
                    hashMap![key] = atomicMap[key];
                  }
                });
              }
            }
          }

          if (hashMap) {
            replacements.push({
              start: node.span.start - baseByteOffset,
              end: node.span.end - baseByteOffset,
              content: `((${JSON.stringify(hashMap)})[${dynSource}] || {})`,
            });
          }
          return;
        }

        const propName = node.property.value;

        const localStyle = localCreateStyles[varName];
        if (localStyle && localStyle.type === 'create') {
          const atomMap = localStyle.hashMap[propName];
          if (atomMap) {
            replacements.push({
              start: node.span.start - baseByteOffset,
              end: node.span.end - baseByteOffset,
              content: `(${JSON.stringify(atomMap)})`,
            });
            return;
          }
        }

        let hash = scannedTables.createHashTable[uniqueKey];
        if (!hash) {
          hash = mergedCreateTable[varName];
        }

        if (hash) {
          let atomMap: Record<string, string> | undefined;

          if (scannedTables.createAtomicMapTable[hash]) {
            atomMap = scannedTables.createAtomicMapTable[hash][propName];
          }

          if (atomMap) {
            replacements.push({
              start: node.span.start - baseByteOffset,
              end: node.span.end - baseByteOffset,
              content: `(${JSON.stringify(atomMap)})`,
            });
          }
        }

        let themeHash = mergedCreateThemeHashTable[varName];
        if (!themeHash) {
          themeHash = scannedTables.createThemeHashTable[uniqueKey];
        }

        if (themeHash) {
          const atomicMap = scannedTables.createAtomicMapTable[themeHash];
          if (atomicMap && atomicMap[propName]) {
            replacements.push({
              start: node.span.start - baseByteOffset,
              end: node.span.end - baseByteOffset,
              content: `(${JSON.stringify(atomicMap[propName])})`,
            });
          } else {
            const cssVarName = camelToKebabCase(propName);
            replacements.push({
              start: node.span.start - baseByteOffset,
              end: node.span.end - baseByteOffset,
              content: `(${JSON.stringify(`var(--${themeHash}-${cssVarName})`)})`,
            });
          }
        }

        let staticHash = mergedCreateStaticHashTable[varName];
        if (!staticHash) {
          staticHash = scannedTables.createStaticHashTable[uniqueKey];
        }

        if (staticHash) {
          const staticObj = scannedTables.createStaticObjectTable[staticHash];
          if (staticObj && staticObj[propName] !== undefined) {
            replacements.push({
              start: node.span.start - baseByteOffset,
              end: node.span.end - baseByteOffset,
              content: `(${JSON.stringify(staticObj[propName])})`,
            });
          }
        }
      }
    },
    Identifier({ node }: { node: Identifier }) {
      if (excludedSpans.has(node.span.start)) return;
      if (idSpans.has(node.span.start)) return;
      if (!referenceIdents.references.has(node.span.start)) return;
      if (!namespaceReads.has(node.span.start)) {
        const actualPath = namespacePath(node.value);
        const name = actualPath && exportedDefinition(actualPath);
        if (name) {
          throwCompilationError(
            `[plumeria] ${node.value} is used as a whole, but it holds ${node.value}.${name}, a Plumeria definition that cannot be compiled through a namespace import. Import the names it needs instead: import { ${name} } from '...'.`,
            node,
          );
        }
      }

      const prefix = referenceIdents.shorthands.has(node.span.start)
        ? `${node.value}: `
        : '';
      const pushReplacement = (content: string) => {
        replacements.push({
          start: node.span.start - baseByteOffset,
          end: node.span.end - baseByteOffset,
          content: `${prefix}${content}`,
        });
      };

      const definition = [
        ['kf-', mergedKeyframesTable[node.value]],
        ['vt-', mergedViewTransitionTable[node.value]],
        ['--pt-', mergedPositionTryTable[node.value]],
        ['--pr-', mergedVarTypeTable[node.value]],
      ].find(([, hash]) => typeof hash === 'string' && hash);
      if (definition) {
        pushReplacement(JSON.stringify(`${definition[0]}${definition[1]}`));
        return;
      }

      const styleInfo = localCreateStyles[node.value];
      if (styleInfo) {
        pushReplacement(`(${JSON.stringify(styleInfo.hashMap)})`);
        return;
      }

      const varName = node.value;
      const uniqueKey = `${resourcePath}-${varName}`;

      let hash = mergedCreateTable[varName];
      if (!hash) {
        hash = scannedTables.createHashTable[uniqueKey];
      }

      if (hash) {
        const obj = scannedTables.createObjectTable[hash];
        const atomicMap = scannedTables.createAtomicMapTable[hash];

        if (obj && atomicMap) {
          const hashMap: Record<string, Record<string, string>> = {};
          Object.keys(obj).forEach((key) => {
            if (atomicMap[key]) {
              hashMap[key] = atomicMap[key];
            }
          });

          pushReplacement(`(${JSON.stringify(hashMap)})`);
        }
      }

      let themeHash = mergedCreateThemeHashTable[varName];
      if (!themeHash) {
        themeHash = scannedTables.createThemeHashTable[uniqueKey];
      }

      if (themeHash) {
        const atomicMap = scannedTables.createAtomicMapTable[themeHash];
        if (atomicMap) {
          pushReplacement(`(${JSON.stringify(atomicMap)})`);
          return;
        }
      }

      let staticHash = mergedCreateStaticHashTable[varName];
      if (!staticHash) {
        staticHash = scannedTables.createStaticHashTable[uniqueKey];
      }

      if (staticHash) {
        const staticObj = scannedTables.createStaticObjectTable[staticHash];
        if (staticObj) {
          pushReplacement(`(${JSON.stringify(staticObj)})`);
        }
      }
    },
    JSXAttribute({ node }: { node: JSXAttribute }) {
      if (node.name.type !== 'Identifier') return;
      const attrName = node.name.value;

      const compKey =
        jsxAttributeOwnerMap.get(node.span.start)?.compKey ?? null;

      const receivesStyleProp = Boolean(
        compKey &&
        scannedTables.styleReceiverTable?.[compKey]?.includes(attrName),
      );

      let relayed = false;

      if (attrName !== styleProp || receivesStyleProp) {
        if (compKey) {
          if (node.value?.type === 'JSXExpressionContainer')
            assertNoStyleArraySpread(node.value.expression);
          const list = scannedTables.componentPropsTable?.[compKey]?.[attrName];
          if (
            list &&
            node.value &&
            node.value.type === 'JSXExpressionContainer'
          ) {
            const expr = node.value.expression;
            const replaceWithKey = (subNode: Expression) => {
              const entries = localPropEntries(
                list,
                (subNode as HasSpan).span.start,
              );
              if (!entries) return false;
              const site = siteOf(node);
              const base = site === undefined ? 0 : (tempNext.get(site) ?? 0);
              argBase = site === undefined ? null : base;
              const plan = newPlan(site !== undefined, base);
              let items: string[] | null;
              let argEnd = base;
              try {
                items = planReceiver(subNode, plan);
              } finally {
                argEnd = argBase ?? base;
                argBase = null;
              }
              if (!items) return false;
              const rows: KeyedRow[] = [];
              for (const entry of entries) {
                if (
                  entry.hasVars &&
                  entry.dynamicCalls?.some(
                    (call) => !plan.reads.has(spanKey(spanOf(call))),
                  )
                )
                  return false;
                rows.push({
                  conditions: entry.conditions ?? [],
                  key: entry.key,
                  fixed: !entry.hasVars,
                  calls: entry.dynamicCalls,
                });
                processStyleRecords(entry.styleObj);
              }
              const keys: string[] = [];
              const [body] = decideKeyed(
                rows,
                plan.reads,
                plan.vars.map(({ name }) => name),
                { next: 0 },
                keys,
                plan.assign,
              );
              const [row] = rows;
              if (site !== undefined && plan.assign) {
                const content =
                  rows.length === 1 &&
                  !row.conditions.length &&
                  !row.fixed &&
                  items.length === 1 &&
                  plan.folds.length === 1
                    ? `{ key: ${JSON.stringify(row.key)}, vars: ${plan.folds[0]} }`
                    : !items.length
                      ? body
                      : `(${items.join(', ')}, ${body})`;
                const temps = [
                  ...(content.startsWith('{ key: ') ? [] : plan.params),
                  ...argNames(base, argEnd),
                  ...keys,
                ];
                if (temps.length) {
                  tempNext.set(
                    site,
                    Math.max(argEnd, base + plan.params.length, base + 1),
                  );
                  declareTemps(site, temps);
                }
                replacements.push({
                  start: (subNode as HasSpan).span.start - baseByteOffset,
                  end: (subNode as HasSpan).span.end - baseByteOffset,
                  content,
                });
                return true;
              }
              const key = JSON.stringify(row.key);
              const folds = plan.folds.join(', ');
              const content = !plan.params.length
                ? body
                : rows.length === 1 && !row.conditions.length
                  ? row.fixed
                    ? `({ ${folds} }, ${key})`
                    : `{ key: ${key}, vars: { ${folds} } }`
                  : `((${plan.params.join(', ')}) => (${body}))(${items.join(', ')})`;
              replacements.push({
                start: (subNode as HasSpan).span.start - baseByteOffset,
                end: (subNode as HasSpan).span.end - baseByteOffset,
                content,
              });
              return true;
            };
            traverse(expr, {
              MemberExpression({ node: subNode }) {
                if (replaceWithKey(subNode)) {
                  relayed = true;
                  excludeSubtreeSpans(subNode);
                }
              },
              ArrayExpression({ node: subNode }) {
                if (replaceWithKey(subNode)) {
                  relayed = true;
                  excludeSubtreeSpans(subNode);
                }
              },
              CallExpression({ node: subNode }) {
                if (replaceWithKey(subNode)) {
                  relayed = true;
                  excludeSubtreeSpans(subNode);
                }
              },
            });
          }
        }
        if (attrName !== styleProp || relayed) return;
      }

      if (!node.value || node.value.type !== 'JSXExpressionContainer') return;

      const appliedBefore = receivesStyleProp
        ? new Set(appliedStyleProps)
        : null;
      if (appliedBefore) appliedStyleProps.clear();
      const expr = node.value.expression;
      const args: Array<{ expression: Expression; order?: number }> =
        expr.type === 'ArrayExpression'
          ? expr.elements
              .filter((el) => el != null)
              .map((el) => {
                if (el.spread)
                  throwCompilationError(
                    spreadStyleMessage(getSource(el.expression)),
                    el.expression as HasSpan,
                  );
                return { expression: el.expression };
              })
          : [{ expression: expr }];

      const dynamicClassParts: string[] = [];
      const existingStyleParts: string[] = [];

      const attributes: Array<JSXAttribute | SpreadElement> =
        jsxAttributeOwnerMap.get(node.span.start)?.attributes ?? [];

      const classNameAttr = attributes.find(
        (attr): attr is JSXAttribute =>
          attr.type === 'JSXAttribute' &&
          attr.name.type === 'Identifier' &&
          attr.name.value === classProp,
      );
      let existingClassExpr = '';

      if (classNameAttr) {
        replacements.push({
          start: classNameAttr.span.start - baseByteOffset,
          end: classNameAttr.span.end - baseByteOffset,
          content: '',
        });
        if (classNameAttr.value?.type === 'StringLiteral') {
          existingClassExpr = JSON.stringify(classNameAttr.value.value);
        } else if (classNameAttr.value?.type === 'JSXExpressionContainer') {
          existingClassExpr = `(${deferSource(classNameAttr.value.expression as HasSpan)})`;
        }
      }

      const styleAttrExisting = attributes.find(
        (attr): attr is JSXAttribute =>
          attr.type === 'JSXAttribute' &&
          attr.name.type === 'Identifier' &&
          attr.name.value === 'style',
      );
      let existingStyleExpr = '';
      let styleObject = false;

      if (styleAttrExisting) {
        replacements.push({
          start: styleAttrExisting.span.start - baseByteOffset,
          end: styleAttrExisting.span.end - baseByteOffset,
          content: '',
        });

        if (styleAttrExisting.value?.type === 'JSXExpressionContainer') {
          const innerExpr = styleAttrExisting.value?.expression;

          if (innerExpr.type === 'ObjectExpression') {
            styleObject = true;
            for (const property of innerExpr.properties) {
              const token = deferProperty(property);
              if (token) existingStyleParts.push(token);
            }
          } else {
            existingStyleExpr = `...(${deferSource(innerExpr as HasSpan)})`;
          }
        }
      }

      const styleArg = existingStyleExpr
        ? existingStyleExpr.slice(3)
        : styleObject
          ? `{ ${existingStyleParts.join(', ')} }`
          : null;
      const classIsExpr = existingClassExpr.startsWith('(');
      const attributeReads = (attr: JSXAttribute | undefined) =>
        attr?.value?.type === 'JSXExpressionContainer' &&
        attr.value.expression.type !== 'JSXEmptyExpression' &&
        !readsNothing(attr.value.expression);
      const site = siteOf(node);
      const base = site === undefined ? 0 : (tempNext.get(site) ?? 0);
      argBase = site === undefined ? null : base;
      let plan = newPlan(site !== undefined, base);
      const plans: Array<{ params: string[]; items: string[] }> = [];
      for (const arg of args) {
        const start = plan.params.length;
        const items = planTopElement(arg.expression, plan);
        if (!items) {
          plans.length = 0;
          plan = newPlan();
          break;
        }
        plans.push({ params: plan.params.slice(start), items });
      }
      const planned = plans.length === args.length;
      const wraps =
        (plan.classRuntime || attributeReads(classNameAttr)) &&
        (plan.styleRuntime || attributeReads(styleAttrExisting));
      const moved = [node, classNameAttr, styleAttrExisting].flatMap((attr) =>
        attr ? [attr.span.start] : [],
      );
      const hosts: Host[] = [];
      for (const item of attributes) {
        if (item.type === 'SpreadElement') {
          hosts.push({
            at: item.spread.start,
            open: (item.arguments as HasSpan).span.start,
            close: (item.arguments as HasSpan).span.end,
            braces: false,
          });
          continue;
        }
        if (moved.includes(item.span.start)) continue;
        const value = item.value;
        if (value?.type === 'JSXExpressionContainer') {
          const inner = value.expression;
          if (inner.type !== 'JSXEmptyExpression' && !readsNothing(inner))
            hosts.push({
              at: item.span.start,
              open: (inner as HasSpan).span.start,
              close: (inner as HasSpan).span.end,
              braces: false,
            });
        } else if (
          value?.type === 'JSXElement' ||
          value?.type === 'JSXFragment'
        )
          hosts.push({
            at: item.span.start,
            open: value.span.start,
            close: value.span.end,
            braces: true,
          });
      }
      const positions = [
        node.span.start,
        classNameAttr?.span.start,
        styleArg !== null ? styleAttrExisting?.span.start : undefined,
      ].filter((position) => position !== undefined);
      const first = Math.min(...positions);
      const last = Math.max(...positions);
      const crossing = hosts.some((host) => host.at > first && host.at < last);
      if (
        site !== undefined &&
        planned &&
        plan.assign &&
        (wraps || plan.styleRuntime || crossing)
      ) {
        assignElement(
          node,
          args,
          plan,
          plans,
          site,
          classIsExpr ? classNameAttr?.span : undefined,
          classNameAttr?.span,
          existingClassExpr,
          styleArg !== null && styleAttrExisting
            ? { span: styleAttrExisting.span, value: styleArg }
            : undefined,
          hosts,
        );
      } else if (planned && wraps) {
        argBase = null;
        const entries: Array<{
          order: [number, number];
          param: string;
          arg: string;
        }> = [];
        if (classIsExpr && classNameAttr)
          entries.push({
            order: [classNameAttr.span.start, 0],
            param: '__plumeria_class',
            arg: existingClassExpr,
          });
        if (styleArg !== null && styleAttrExisting)
          entries.push({
            order: [styleAttrExisting.span.start, 0],
            param: '__plumeria_style',
            arg: styleArg,
          });
        plans.forEach(({ params, items }, index) => {
          if (!params.length) return;
          const single =
            params.length === 1 &&
            items.length === 1 &&
            !items[0].startsWith('...');
          entries.push({
            order: [node.span.start, index + 1],
            param: single ? params[0] : `[${params.join(', ')}]`,
            arg: single ? items[0] : `[${items.join(', ')}]`,
          });
        });
        entries.sort(
          (a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1],
        );

        elementReads = plan.reads;
        let built;
        try {
          built = buildClassParts(
            args,
            [],
            classIsExpr ? '__plumeria_class' : existingClassExpr,
            true,
          );
        } finally {
          elementReads = null;
        }
        const classValue = joinClassParts(built.classParts, plan.params);
        const existing = styleArg !== null ? '__plumeria_style' : undefined;
        const spread = [
          ...(existing ? [existing] : []),
          ...plan.vars.map(({ name }) => name),
        ].map((name) => `...${name}`);
        const copy = `{ ${spread.join(', ')} }`;
        const styleValue = !plan.vars.length
          ? (existing ?? 'undefined')
          : plan.vars.length === 1 && !existing
            ? plan.vars[0].always
              ? plan.vars[0].name
              : `${plan.vars[0].name} || undefined`
            : plan.vars.some(({ always }) => always)
              ? copy
              : `(${plan.vars.map(({ name }) => name).join(' || ')}) ? ${copy} : ${existing ?? 'undefined'}`;
        const sides = entries.map(({ param }) => {
          const inClass = mentions(classValue, param);
          const inStyle = mentions(styleValue, param);
          return !param.startsWith('[') && inClass !== inStyle
            ? inClass
            : undefined;
        });
        if (
          sides.every((side) => side !== undefined) &&
          sides.every((side, index) => index === 0 || sides[index - 1] || !side)
        ) {
          const side = (want: boolean, value: string) => {
            const picked = entries.filter((_, index) => sides[index] === want);
            if (!picked.length) return value;
            if (picked.length === 1 && picked[0].param === value)
              return picked[0].arg;
            return invoke(
              picked.map(({ param }) => param).join(', '),
              value,
              picked.map(({ arg }) => arg).join(', '),
            );
          };
          const classText = side(true, classValue);
          const styleText = side(false, styleValue);
          const classAttr =
            staticClass(classText) !== undefined && !classText.includes('&')
              ? classText
              : `{${classText}}`;
          const styleAttr =
            styleText === 'undefined' ? '' : ` style={${styleText}}`;
          replacements.push({
            start: node.span.start - baseByteOffset,
            end: node.span.end - baseByteOffset,
            content: `${classProp}=${classAttr}${styleAttr}`,
          });
        } else
          replacements.push({
            start: node.span.start - baseByteOffset,
            end: node.span.end - baseByteOffset,
            content: `{...${invoke(
              entries.map(({ param }) => param).join(', '),
              `({ ${classProp}: ${classValue}, style: ${styleValue} })`,
              entries.map(({ arg }) => arg).join(', '),
            )}}`,
          });
      } else {
        const foldBase = site === undefined ? 0 : (tempNext.get(site) ?? 0);
        argBase = site === undefined ? null : foldBase;
        const {
          classParts,
          isOptimizable,
          baseStyle,
          dynamicVars,
          propVarSpreads,
        } = buildClassParts(args, dynamicClassParts, existingClassExpr, true);
        const folded = foldDynamicVars(dynamicVars, site !== undefined, invoke);
        if (site !== undefined && argBase !== null && argBase > foldBase) {
          tempNext.set(site, argBase);
          declareTemps(site, argNames(foldBase, argBase), false);
        }
        argBase = null;

        if (!isOptimizable) {
          throwCompilationError(
            `[plumeria] Dynamic or unresolvable style object "${getSource(expr)}" is not supported.`,
            expr as HasSpan,
          );
        }

        const styleParts = [
          ...existingStyleParts,
          ...folded,
          ...propVarSpreads,
        ];
        const generatedOnly =
          !styleObject && !existingStyleExpr && !propVarSpreads.length;
        const allStyles = [existingStyleExpr, ...styleParts].filter(Boolean);
        const styleAttr = !(styleParts.length > 0 || existingStyleExpr)
          ? ''
          : allStyles.length === 1 &&
              generatedOnly &&
              allStyles[0].startsWith('...')
            ? ` style={${allStyles[0].slice(3)}}`
            : ` style={{ ${allStyles.join(', ')} }}`;

        if (
          isOptimizable &&
          (args.length > 0 ||
            Object.keys(baseStyle).length > 0 ||
            dynamicClassParts.length > 0)
        ) {
          const replacement = joinClassParts(classParts, []);
          const fixed = staticClass(replacement) !== undefined;
          const value =
            fixed && !replacement.includes('&')
              ? replacement
              : `{${replacement}}`;
          if (
            classNameAttr &&
            classNameAttr.span.start > node.span.start &&
            fixed &&
            !styleAttr
          ) {
            setReplacement(classNameAttr.span, `${classProp}=${value}`);
            replacements.push({
              start: node.span.start - baseByteOffset,
              end: node.span.end - baseByteOffset,
              content: '',
            });
          } else
            replacements.push({
              start: node.span.start - baseByteOffset,
              end: node.span.end - baseByteOffset,
              content: `${classProp}=${value}${styleAttr}`,
            });
        } else {
          const keptClass = existingClassExpr
            ? `${classProp}={${existingClassExpr}}`
            : '';
          replacements.push({
            start: node.span.start - baseByteOffset,
            end: node.span.end - baseByteOffset,
            content: `${keptClass}${styleAttr}`,
          });
        }
      }
      if (appliedBefore) {
        const referenced = new Set(appliedStyleProps);
        for (const key of referenced) {
          const [owner, propName] = key.split(':');
          const ownerKey = `${resourcePath}-${owner}`;
          if (
            scannedTables.componentPropsTable?.[ownerKey]?.[propName] ||
            scannedTables.styleReceiverTable?.[ownerKey]?.includes(propName)
          ) {
            const separator = compKey?.lastIndexOf('-') ?? -1;
            const target =
              compKey && separator >= 0
                ? compKey.slice(separator + 1)
                : 'the component';
            throwCompilationError(
              `[plumeria] "${propName}" is a style received through a prop, so it cannot be passed on ` +
                `to <${target}>, which takes ${styleProp} too. Pass the style to <${target} ${styleProp}={...} /> ` +
                `where it is chosen, or apply it to an element this component renders.`,
              node,
            );
          }
        }
        for (const applied of appliedBefore) appliedStyleProps.add(applied);
        for (const applied of referenced) appliedStyleProps.add(applied);
      }
    },
    CallExpression({ node }: { node: CallExpression }) {
      const callee = node.callee;
      let isUseCall = false;

      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object) &&
        t.isIdentifier(callee.property)
      ) {
        const objectName = callee.object.value;
        const propertyName = callee.property.value;
        if (
          localCreateStyles[objectName]?.functions?.[propertyName] ||
          createFunctionImportMap[objectName]?.[propertyName]
        ) {
          dynamicFnCalls.push(node);
        }
        const alias = plumeriaAliases[objectName];
        if (alias === 'NAMESPACE' && propertyName === 'use') {
          isUseCall = true;
        }
      } else if (t.isIdentifier(callee)) {
        const calleeName = callee.value;
        const originalName = plumeriaAliases[calleeName];
        if (originalName === 'use') {
          isUseCall = true;
        }
      }

      if (!isUseCall) return;

      const args: Array<{ expression: Expression }> = node.arguments;
      for (const arg of args) {
        const expr = arg.expression;
        if (!t.isCallExpression(expr) || !t.isMemberExpression(expr.callee))
          continue;
        const callee = expr.callee;
        if (!t.isIdentifier(callee.object) || !t.isIdentifier(callee.property))
          continue;

        const varName = callee.object.value;
        const propKey = callee.property.value;
        const styleInfo = localCreateStyles[varName];
        if (styleInfo?.functions?.[propKey]) {
          throwCompilationError(
            `[plumeria] css.use(${getSource(
              expr,
            )}) does not support dynamic function keys.`,
            expr,
          );
        }
      }

      const { classParts, isOptimizable } = buildClassParts(args);

      if (isOptimizable) {
        replacements.push({
          start: node.span.start - baseByteOffset,
          end: node.span.end - baseByteOffset,
          content: joinClassParts(classParts, []),
        });
      } else {
        throwCompilationError(
          `[plumeria] Dynamic or unresolvable style object "${getSource(node)}" is not supported.`,
          node,
        );
      }
    },
  });

  for (const { name, node, wrapped } of wrappedBindings(ast)) {
    const props =
      scannedTables.componentPropsTable?.[`${resourcePath}-${name}`];
    if (wrapped === 'ambiguous' && Object.keys(props ?? {}).length > 0)
      throwCompilationError(
        `[plumeria] "${name}" is made by a call with more than one argument that could be the component, ` +
          `so a style passed to it cannot reach one. Leave the component as the only function that renders, ` +
          `or the only component name, the call takes.`,
        node,
      );
  }

  for (const { name, node } of components) {
    const props =
      scannedTables.componentPropsTable?.[`${resourcePath}-${name}`];
    for (const propName of Object.keys(props ?? {})) {
      if (appliedStyleProps.has(`${name}:${propName}`)) {
        continue;
      }
      throwCompilationError(
        `[plumeria] "${propName}" is a style received through a prop but is never applied ` +
          `to ${styleProp} or css.use() here. Apply it on an element this component renders; ` +
          `a style prop cannot be passed on to another component.`,
        node,
      );
    }
  }

  const buildExportedInit = (info: CreateStyleValue): string => {
    const keys = Object.keys(info.obj);
    if (!isDev || keys.length === 0) {
      return JSON.stringify('');
    }
    const head = JSON.stringify(`[plumeria] "${info.name}.`);
    const tail = JSON.stringify(
      `" was read at runtime. The file that read it was not compiled ` +
        `because it does not reference "@plumeria/core" — add ` +
        `import '@plumeria/core'; to it (see the stack below). Defined in ` +
        `${path.relative(root, baseId)}.`,
    );
    return (
      `(()=>{const k=new Set(${JSON.stringify(keys)});` +
      `return new Proxy({},{get(t,p){` +
      `if(typeof p==="string"&&k.has(p))throw new Error(${head}+p+${tail});` +
      `return t[p];}});})()`
    );
  };

  Object.values(localCreateStyles).forEach((info) => {
    if (info.isExported) {
      replacements.push({
        start: info.initSpan.start,
        end: info.initSpan.end,
        content: buildExportedInit(info),
      });
    } else {
      replacements.push({
        start: info.declSpan.start,
        end: info.declSpan.end,
        content: '',
      });
    }
  });

  dynamicFnCalls.forEach((call) => {
    const start = call.span.start - baseByteOffset;
    const end = call.span.end - baseByteOffset;
    const isResolved = replacements.some(
      (r) => r.start <= start && r.end >= end,
    );
    if (!isResolved) {
      throwCompilationError(
        `[plumeria] ${getSource(call)} is only supported in the ${styleProp} prop. ` +
          `A dynamic style function resolves to a class name and a CSS variable on the element itself, ` +
          `so it cannot be passed through another prop or read as a value.`,
        call,
      );
    }
  });

  const moduleSite = declSites.get(MODULE_SITE);
  if (moduleSite && helpers.size)
    replacements.push({
      start: moduleSite.at,
      end: moduleSite.at,
      content: `${[...helpers.values()]
        .map(
          ({ name, params, body }) =>
            `\nfunction ${name}(${params}) { return ${body}; }`,
        )
        .join('')}\n`,
    });

  for (const [site, names] of siteTemps) {
    const declared = declSites.get(site);
    if (!declared || !names.length) continue;
    for (const [at, content] of insertions(declared, names))
      replacements.push({ start: at, end: at, content });
  }

  const byPosition = (
    a: { start: number; end: number },
    b: { start: number; end: number },
  ) =>
    a.start - b.start ||
    Number(a.end > a.start) - Number(b.end > b.start) ||
    b.end - a.end;
  replacements.sort(byPosition);

  for (const deferred of deferredSources) {
    let cursor = deferred.start;
    const pieces: string[] = [];
    for (const replacement of replacements) {
      if (replacement.start < cursor || replacement.end > deferred.end)
        continue;
      pieces.push(
        sourceBuffer.subarray(cursor, replacement.start).toString('utf-8'),
        replacement.content,
      );
      cursor = replacement.end;
    }
    pieces.push(sourceBuffer.subarray(cursor, deferred.end).toString('utf-8'));
    const content = pieces.join('');
    for (const replacement of replacements)
      replacement.content = replacement.content.replaceAll(
        deferred.token,
        content,
      );
  }

  const splice = (list: typeof replacements): string => {
    let offset = 0;
    const parts: Buffer[] = [];
    list.forEach((r) => {
      if (r.start < offset) return;
      parts.push(sourceBuffer.subarray(offset, r.start));
      parts.push(Buffer.from(r.content));
      offset = r.end;
    });
    parts.push(sourceBuffer.subarray(offset));
    return Buffer.concat(parts).toString();
  };

  const transformedSource = splice(replacements);
  const elided = elidedImports(
    ast,
    baseByteOffset,
    replacements,
    transformedSource,
  );
  if (elided.length === 0) return { code: transformedSource };

  replacements.push(...elided);
  replacements.sort(byPosition);

  return { code: splice(replacements) };
};

const elidedImports = (
  ast: Module,
  baseByteOffset: number,
  replacements: Array<{ start: number; end: number; content: string }>,
  transformedSource: string,
): Array<{ start: number; end: number; content: string }> => {
  if (replacements.length === 0) return [];
  const overlaps = (start: number, end: number) =>
    replacements.some((r) => r.start <= end && r.end >= start);
  const covered = (position: number) =>
    replacements.some((r) => r.start <= position && r.end > position);

  const imports = ast.body.filter(
    (statement): statement is ImportDeclaration =>
      statement.type === 'ImportDeclaration' &&
      !statement.typeOnly &&
      statement.specifiers.length > 0 &&
      statement.specifiers.every(
        (specifier) =>
          specifier.type !== 'ImportSpecifier' || !specifier.isTypeOnly,
      ) &&
      !overlaps(
        statement.span.start - baseByteOffset,
        statement.span.end - baseByteOffset,
      ),
  );
  if (imports.length === 0) return [];

  const positionsOf = new Map<string, number[]>();
  const { names } = collectReferenceIdentifiers(ast, { runtimeReads: true });
  const record = (name: string, position: number) => {
    const positions = positionsOf.get(name);
    if (positions) positions.push(position);
    else positionsOf.set(name, [position]);
  };
  for (const [start, name] of names) {
    record(name, start - baseByteOffset);
    const dot = name.indexOf('.');
    if (dot > 0) record(name.slice(0, dot), start - baseByteOffset);
  }
  const candidates = imports.filter((node) =>
    node.specifiers.every(({ local }) => {
      const positions = positionsOf.get(local.value);
      return positions !== undefined && positions.every(covered);
    }),
  );
  if (candidates.length === 0) return [];

  let output: Module;
  try {
    output = parseSync(transformedSource, {
      syntax: 'typescript',
      tsx: true,
      target: 'es2022',
    });
  } catch {
    return [];
  }
  const remaining = new Set(
    collectReferenceIdentifiers(output, { runtimeReads: true }).names.values(),
  );
  return candidates
    .filter((node) =>
      node.specifiers.every(({ local }) => !remaining.has(local.value)),
    )
    .map((node) => ({
      start: node.span.start - baseByteOffset,
      end: node.span.end - baseByteOffset,
      content: '',
    }));
};
