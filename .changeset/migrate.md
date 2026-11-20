---
'@plumeria/migrate': patch
---

- Feat: Migrate named styles and styled components imported from Emotion and styled-components files. Keep shared definitions intact when consumers re-export them or load them dynamically from a fixed path.
- Update: Skip the side-effect core import when CSS Modules, vanilla-extract, or StyleX consumers use the configured style prop.
- Fix: Remove leftover blank lines when merging vanilla-extract styles and handle CRLF line endings when removing imports.
- Fix: Mark the migrate CLI executable.
