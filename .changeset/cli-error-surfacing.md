---
'openplanr': patch
---

`--verbose` now prints the stack of a failed command and every cause it wraps, while the default output stays one line and `--json` output stays one envelope. JSON mode and the `upgrade` exemption from the inline upgrade offer are read from the parsed command instead of scanning the raw arguments, so an option value spelled `--json` no longer switches the output to JSON and an argument that is merely the word `upgrade` no longer suppresses the offer. A thrown non-`Error` value is reported as its text instead of `undefined`, and `--verbose` explains why the compatibility manifest could not be fetched or read.
