---
'@plumeria/compiler': patch
'@plumeria/utils': patch
---

- Fix: reject inline style objects passed to `sx` or `css.use()` instead of dropping them
- Update: split the Claude Code plugin skill into reference files, so SKILL.md loads 15KB instead of 46KB
