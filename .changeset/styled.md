---
'@plumeria/compiler': minor
'@plumeria/utils': minor
'@plumeria/eslint-plugin': minor
---

- Feat: Add styled components from @plumeria/react, compiled to the sx prop
- Feat: Lint styled objects in eslint-plugin rules
- Fix: Evaluate each dynamic style argument once in source order
- Fix: Read each sx element and received style once
- Fix: Reject a spread or a computed key in a named argument
- Fix: Cap styled inheritance at 16 levels
- Fix: Support at-rules and starting-style in eslint-plugin
