---
'@plumeria/unplugin': patch
---

- Fix: link the single CSS bundle to entry chunks so the Vite manifest lists it under the entry's `css`. `plumeria.vite()` now returns an array of plugins.
