import { implementations } from '../compiler-implementations';

describe.each(implementations)('$name', ({ needsCompile }) => {
  // None of these sources import the core package, so the answer is the style
  // prop filter's alone.
  const uses = (
    source: string,
    styleProp = 'classStyle',
    filePath = 'App.tsx',
  ) => needsCompile(source, styleProp, filePath);

  describe('the style prop filter: an attribute it has to find', () => {
    it.each([
      ['a plain attribute', '<div classStyle={a} />'],
      ['spaces around the equals sign', '<div classStyle = \n {a} />'],
      ['an apostrophe in JSX text', "<p>Don't <b classStyle={a} /> won't</p>"],
      ['a URL in JSX text', '<a>http://x <b classStyle={a} /></a>'],
      ['a regex before it', "const r = /'/; <div classStyle={a} />"],
      [
        'a regex with a slash in a class',
        "const r = /[/']/; <div classStyle={a} />",
      ],
      [
        'divisions before it',
        'const x = a / b; const y = c / d; <div classStyle={a} />',
      ],
      [
        'JSX inside a template expression',
        'const t = `${<div classStyle={a} />}`;',
      ],
      [
        'a nested template before it',
        'const t = `${`${x}`}`; <div classStyle={a} />',
      ],
      [
        'a block comment before it',
        '/* classStyle={x} */ <div classStyle={a} />',
      ],
      [
        'an escaped backtick in a template',
        'const t = `\\``; <div classStyle={a} />',
      ],
      [
        'an escaped slash in a regex',
        'const r = /\\//; <div classStyle={a} />',
      ],
      [
        'a division after an increment',
        'const x = i++ / 2; <div classStyle={a} />',
      ],
      [
        'a division after a decrement',
        'const x = i-- / 2; <div classStyle={a} />',
      ],
      [
        'a regex after a plus sign',
        "const x = a + /'/.source; <div classStyle={a} />",
      ],
      [
        'a less-than sign that does not open a tag',
        'const x = y = < 3; <div classStyle={a} />',
      ],
      [
        'a block comment before the equals sign',
        '<div classStyle /* c */ = {a} />',
      ],
      [
        'a block comment after the equals sign',
        '<div classStyle= /* c */ {a} />',
      ],
      [
        'a closing tag inside a template expression on the same line',
        'const s = `${<A>x</A>}`; <div classStyle={a} />',
      ],
      [
        'a closing tag after a spread',
        'const p = {...<A>x</A>, b: <div classStyle={a} />};',
      ],
      [
        'a closing tag after a division',
        'const d = x / <A>y</A>; <div classStyle={a} />',
      ],
      [
        'a closing tag after an increment and a division',
        'const d = x++ / <A>y</A>; <div classStyle={a} />',
      ],
      [
        'a line comment before the equals sign',
        '<div classStyle // c\n = {a} />',
      ],
      [
        'a line comment after the equals sign',
        '<div classStyle = // c\n {a} />',
      ],
      ['a vertical tab before the equals sign', '<div classStyle\v={a} />'],
      [
        'a block comment in a tag holding > and a quote',
        "<div /* > it's */ classStyle={a} />",
      ],
      [
        'a line comment in a tag holding > and a quote',
        "<div // > it's\n classStyle={a} />",
      ],
      ['a string holding a brace', "const s = '{'; <div classStyle={a} />"],
      [
        'a string holding an escaped quote',
        "const s = 'it\\'s'; <div classStyle={a} />",
      ],
      [
        'JSX returned from a function',
        "function A() { return <p>it's <b classStyle={a} /></p>; }",
      ],
      ['a fragment', "const A = () => <><p>'</p><b classStyle={a} /></>;"],
      [
        'a quote in an attribute string',
        `const A = () => <p title="it's"><b classStyle={a} /></p>;`,
      ],
      [
        'a string in a child expression',
        'const A = () => <p>{"}"}<b classStyle={a} /></p>;',
      ],
      [
        'a generic arrow in TSX',
        "const f = <T,>(x: T) => x; const s = 'a'; <b classStyle={a} />",
      ],
      [
        'a comparison before it',
        'if (a < b) { const s = "x"; } <b classStyle={a} />',
      ],
      [
        'a JSX branch of a ternary',
        "const A = ok ? <p>'</p> : null; <b classStyle={a} />",
      ],
      [
        'an attribute after an expression attribute',
        '<p a={{ b: 1 }} classStyle={a} />',
      ],
      [
        'an attribute after a nested element',
        '<p><i /><b>x</b><b classStyle={a} /></p>',
      ],
    ])('%s', (_, source) => {
      expect(uses(source)).toBe(true);
    });
  });

  describe('the style prop filter: text that only looks like the attribute', () => {
    it.each([
      ['a line comment', '// <Box classStyle={a} />\nexport const x = 1;'],
      [
        'a JSDoc block',
        '/**\n * <Box classStyle={a} />\n */\nexport const x = 1;',
      ],
      ['a string', "const s = '<Box classStyle={a} />';"],
      ['a double-quoted string', 'const s = "<Box classStyle={a} />";'],
      ['template text', 'const s = `<Box classStyle={a} />`;'],
      [
        'template text after an expression',
        'const s = `${x}<Box classStyle={a} />`;',
      ],
      ['a longer name', '<Box tsx={a} />'],
      ['a member assignment', 'box.classStyle = {};'],
      ['a value that is not an expression', '<Box classStyle="a" />'],
      [
        'a name without an equals sign',
        'const classStyle = 1; classStyle + {};',
      ],
      ['a line comment at the end', 'const x = 1; // classStyle={a}'],
      ['a regex holding the attribute', 'const r = /classStyle={a}/;'],
      [
        'an unterminated comment before the equals sign',
        '<div classStyle /* = {a} />',
      ],
      [
        'an unterminated line comment after the equals sign',
        '<div classStyle = // {a} />',
      ],
      ['a longer name followed by the equals sign', '<div sxx={a} />'],
    ])('%s', (_, source) => {
      expect(uses(source)).toBe(false);
    });

    it('never looks for JSX in a TypeScript file', () => {
      expect(uses('<div classStyle={a} />', 'classStyle', 'styles.ts')).toBe(
        false,
      );
      expect(uses('<div classStyle={a} />', 'classStyle', 'styles.mts')).toBe(
        false,
      );
    });

    it('does nothing for an empty prop name', () => {
      expect(uses('<div classStyle={a} />', '')).toBe(false);
    });
  });

  describe('the style prop filter: input it cannot read sends the file to the parser', () => {
    it.each([
      ['an unterminated string', "const s = 'x\n; // classStyle={a}"],
      ['an unterminated block comment', '/* classStyle={a}'],
      ['an unterminated template', '`abc classStyle={a}'],
      [
        'a regex that does not close on its line',
        "const r = /'\n<div classStyle={a} />",
      ],
      ['an unterminated template after an expression', '`${x} classStyle={a}'],
      ['an unterminated template expression', '`${x}` + `${ classStyle={a}'],
      ['a closing brace with nothing open', '}; // classStyle={a}'],
      ['an unterminated attribute string', '<p title="x // classStyle={a}'],
      ['an unterminated block comment in a tag', '<p /* classStyle={a}'],
      ['an unterminated line comment in a tag', '<p // classStyle={a}'],
      ['an unterminated closing tag', '<p></p // classStyle={a}'],
    ])('%s', (_, source) => {
      expect(uses(source)).toBe(true);
    });
  });

  describe('needsCompile', () => {
    it('compiles a file that imports the core package', () => {
      expect(needsCompile("import '@plumeria/core';", 'sx', 'a.ts')).toBe(true);
    });

    it('compiles a file that writes the style prop without the import', () => {
      expect(needsCompile('<div sx={s.a} />', 'sx', 'a.tsx')).toBe(true);
    });

    it('skips a file that only mentions the style prop in a comment', () => {
      expect(needsCompile('// <div sx={s.a} />', 'sx', 'a.tsx')).toBe(false);
    });
  });
});
