---
'@plumeria/compiler': patch
'@plumeria/utils': patch
---

- Fix: a style passed to a component that React's `lazy` loads is handed to the export its `import()` names, as in `lazy(() => import('./Card'))` or `lazy(() => import('./Card').then((m) => ({ default: m.Card })))`, instead of being resolved to a `className` the component never reads
- Fix: only a `lazy` imported from `react`, including `React.lazy` and a renamed import, is read this way, and a loader or pick written as a block is read like one written as an expression
- Fix: the module a lazy component loads is a dependency of the file that loads it, so a change to that module, or the module appearing later, rescans the call site
