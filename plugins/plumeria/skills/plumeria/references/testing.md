## Testing

**NEVER stub `@plumeria/core`.** It publishes types and no runtime. A `moduleNameMapper` entry or a hand-written mock makes the suite run, but every class name it produces is invented, so the test says nothing about the styles. If a runner cannot resolve the package, that is the signal to test a different layer, not to fake the package.

**NEVER assert a generated class name in a component test.** `xvdv6o3r` is one property-value pair, hashed. Adding a property to the style breaks every test that spelled the old list out. Assert what the component renders, holds, or branches on.

**To test component behavior, put the transform in the runner's module pipeline.** This is the only layer that needs it. Vitest takes the plugin in its config:

```ts
export default defineConfig({
  plugins: [react(), plumeria.vite()],
  test: { environment: 'jsdom' },
});
```

Jest takes `@plumeria/swc-jest` in place of `@swc/jest`, `ts-jest` or `babel-jest`; SWC options stay in `.swcrc` or beside the transformer:

```js
module.exports = {
  testEnvironment: 'jsdom',
  transform: { '^.+\\.(t|j)sx?$': '@plumeria/swc-jest' },
};
```

**jsdom applies no stylesheet.** `document.styleSheets` is empty and `getComputedStyle` returns initial values. A test there can see which classes were attached, never what they do. Anything about the cascade — specificity, `@media`, `marker` with `extended` — belongs in an end-to-end test against a real browser.
