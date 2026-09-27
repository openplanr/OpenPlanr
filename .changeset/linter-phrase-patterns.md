---
'openplanr': patch
---

A `reportLinter.vaguePhrases[].pattern` in `.planr/config.json` that is not a valid regular expression, or that can match empty text such as `(soon)?`, now fails config loading with `E_CONFIG_INVALID` naming the field and the pattern. Before, `planr report`, `planr report-linter` and `planr voice` failed with a raw `SyntaxError` or looped until the process ran out of memory.
