# @plumeria/migrate

Migrate an existing project's styles to Plumeria. Run the CLI from the project root with Node.js 20 or later. Choose the library you are migrating from and preview the changes first.

```sh
npx @plumeria/migrate from vanilla-extract --dry-run
npx @plumeria/migrate from vanilla-extract
```

The CLI reads the styling prop from the bundler's `styleProp` setting and defaults to `sx`. Pass `--style-prop <name>` to override it.

## Reading the report

A **hold** means the CLI found a case that needs a decision. It prints the reason, the relevant expression or name, and a source location when available. A run with holds exits unsuccessfully, including in dry-run mode. When applying changes, other files or stylesheets can still convert successfully. Check the conversion summary and the diff before working through the holds.

| Source after `from` | What converts and appears in the report | Examples that trigger a hold |
| --- | --- | --- |
| `css-modules` | Lists each `*.module.css` and its destination `*.styles.ts`, then counts rewritten consumers. Supported class reads in JSX become styling props, including local composition. | Named CSS Module imports, dynamic class lookups, an existing destination file, or references from files the CLI cannot rewrite. |
| `vanilla-extract` | Lists each converted `.css.ts` or `.css.js` and its destination, then counts rewritten consumers. Handles local `style` composition, `styleVariants`, and `keyframes`. A namespace variant lookup such as `s.background[variant]` can move directly into the styling prop. | `globalStyle`, `createVar`, fallback arrays, cross-sheet style imports, or a composed style in a ternary branch. |
| `emotion` | Lists converted files containing supported `css` styles, styled elements, or keyframes. Separately lists configuration files that still mention Emotion for cleanup after migration. | Theme callbacks, exported `css` styles, or a `css` prop on a custom component. |
| `styled-components` | Lists converted files with supported styled HTML elements, template styles, prop reads, or keyframes. Flags remaining compiler or Babel configuration for cleanup. | `styled(Link)`, `.attrs()`, `createGlobalStyle`, or an interpolation that calls a runtime helper. |
| `stylex` | Reports converted files and counts files given a Plumeria core import. Converts supported `stylex.create` declarations and JSX `stylex.props` calls. | Overlapping states with ambiguous precedence, unsupported APIs such as `createTheme`, or a props spread beside an existing `className`. Linked files can also be held. |
| `tailwindcss` | Lists files with convertible utilities and conditional class expressions. Prints an installation reminder when the generated styles use `@plumeria/wind`. | Unknown or conflicting utilities, dynamic class strings, custom variants, or classes on custom components. A JavaScript theme config stops the run before conversion. |

For CSS Modules and vanilla-extract, a blocking diagnostic holds the **whole stylesheet** and its consumer rewrites. Successful conversion writes the replacement stylesheet, rewrites its consumers, and removes the original. The report groups diagnostics by stylesheet and can also include nonblocking notes. For the other sources, a hold applies to the whole source file.

## Finish the remaining work with AI

After applying the automatic changes, give your coding agent the CLI report and access to the project. Include the conversion summary so it can distinguish completed rewrites from held files. Use this prompt with the report:

> Finish the remaining migration to Plumeria. Read the Plumeria AI guide, then inspect each reported location and its consumers. Use the hold reason to identify the behavior the automatic rewrite could not preserve. Keep class-name strings where another API expects them, and preserve composition order, conditional styles, and component props. Resolve each hold or explain which behavior needs my decision. Rerun the same migration with `--dry-run` and report any remaining holds. Check remaining uses before removing the old library or its configuration.

[Plumeria AI guide](https://plumeria.dev/docs/ai.md)
