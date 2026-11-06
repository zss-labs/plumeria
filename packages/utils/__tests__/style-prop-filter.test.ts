import { needsCompile, usesStyleProp } from '../src/stylePropFilter';

const uses = (source: string, filePath = 'App.tsx') =>
  usesStyleProp(source, 'classStyle', filePath);

describe('usesStyleProp', () => {
  it('filters file extensions and sources without an attribute candidate', () => {
    expect(uses('<div classStyle={a} />', 'App.ts')).toBe(false);
    expect(uses('<div classStyle={a} />', 'App.mts')).toBe(false);
    expect(usesStyleProp('<div classStyle={a} />', '', 'App.tsx')).toBe(false);
    expect(uses('<div />')).toBe(false);
    expect(uses('<div prefixsx={a} />')).toBe(false);
    expect(uses('<div classStyle />')).toBe(false);
    expect(uses('<div classStyle /* comment */ = // comment\n {a} />')).toBe(
      true,
    );
    expect(uses('<div classStyle /*')).toBe(false);
    expect(uses('<div classStyle //')).toBe(false);
  });

  it.each([
    '<div classStyle={a} />',
    '<div /* comment */ classStyle={a} />',
    '<div // comment\n classStyle={a} />',
    '<div title="escaped \\" quote" classStyle={a} />',
    "<div title='escaped \\' quote' classStyle={a} />",
    '<div>{value}<span classStyle={a} /></div>',
    '<div>text<span classStyle={a} /></div>',
    '<><div classStyle={a} /></>',
    '<div><span /></div>; <p classStyle={a} />',
    '<div>{<span classStyle={a} />}</div>',
    '<div prop={{ nested: true }} classStyle={a} />',
  ])('finds an attribute through JSX syntax in %s', (source) => {
    expect(uses(source)).toBe(true);
  });

  it.each([
    '/* comment */ <div classStyle={a} />',
    '// comment\n<div classStyle={a} />',
    "'string'; <div classStyle={a} />",
    '"string"; <div classStyle={a} />',
    '`template`; <div classStyle={a} />',
    '`escaped \\` template`; <div classStyle={a} />',
    '`template ${value}`; <div classStyle={a} />',
    '`template ${first} between ${second}`; <div classStyle={a} />',
    '`template ${`nested ${value}`} tail`; <div classStyle={a} />',
    '/regexp/.test(value); <div classStyle={a} />',
    '/escaped\\//.test(value); <div classStyle={a} />',
    '/[a/]/.test(value); <div classStyle={a} />',
    'return /regexp/; <div classStyle={a} />',
    'yield /regexp/; <div classStyle={a} />',
    'default: /regexp/; <div classStyle={a} />',
    'else /regexp/; <div classStyle={a} />',
    'case /regexp/: <div classStyle={a} />',
    'await /regexp/; <div classStyle={a} />',
    'do /regexp/; <div classStyle={a} />',
    'typeof /regexp/; <div classStyle={a} />',
    'void /regexp/; <div classStyle={a} />',
    'value in /regexp/; <div classStyle={a} />',
    'value of /regexp/; <div classStyle={a} />',
    'new /regexp/; <div classStyle={a} />',
    'delete /regexp/; <div classStyle={a} />',
    'throw /regexp/; <div classStyle={a} />',
    'fn(.../regexp/); <div classStyle={a} />',
    'value++ / divisor; <div classStyle={a} />',
    'value-- / divisor; <div classStyle={a} />',
    '{ value }; <div classStyle={a} />',
    '<1; <div classStyle={a} />',
  ])('scans JavaScript preceding JSX in %s', (source) => {
    expect(uses(source)).toBe(true);
  });

  it('returns according to incomplete constructs before a later candidate', () => {
    expect(uses('// no newline classStyle ={a}')).toBe(false);
    expect(uses('/* unterminated classStyle ={a}')).toBe(true);
    expect(uses("'unterminated\n classStyle ={a}")).toBe(true);
    expect(uses("'unterminated classStyle ={a}")).toBe(true);
    expect(uses('`unterminated classStyle ={a}')).toBe(true);
    expect(uses('`interpolation ${value} unterminated classStyle ={a}')).toBe(
      true,
    );
    expect(uses('} classStyle ={a}')).toBe(true);
    expect(uses('/unterminated\n classStyle ={a}')).toBe(true);
    expect(uses('<div /* unterminated classStyle ={a}')).toBe(true);
    expect(uses('<div // unterminated classStyle ={a}')).toBe(true);
    expect(uses('<div title="unterminated classStyle ={a}')).toBe(true);
    expect(uses('<div></div classStyle ={a}')).toBe(true);
  });

  it('ignores candidates skipped as non-code', () => {
    expect(uses("'classStyle={a}'")).toBe(false);
    expect(uses('"classStyle={a}"')).toBe(false);
    expect(uses('`classStyle={a}`')).toBe(false);
    expect(uses('// classStyle={a}')).toBe(false);
  });
});

describe('needsCompile', () => {
  it('accepts either a core import or a style prop', () => {
    expect(
      needsCompile("import '@plumeria/core';", 'classStyle', 'App.tsx'),
    ).toBe(true);
    expect(
      needsCompile('<div classStyle={a} />', 'classStyle', 'App.tsx'),
    ).toBe(true);
    expect(needsCompile('<div />', 'classStyle', 'App.tsx')).toBe(false);
  });
});
