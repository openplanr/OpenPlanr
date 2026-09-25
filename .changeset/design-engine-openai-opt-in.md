---
'planr-pipeline': minor
'@openplanr/design': minor
---

The design-loop engine no longer picks OpenAI just because a key is present: `auto` always resolves to the $0 `claude-svg` provider, OpenAI runs only behind an explicit `--provider openai` (defaulting to `gpt-5.5` with the `gpt-image-2.5-sunburst` image model, overridable with `--model` and `--image-model`; `--size` and `--quality` validate the documented values), the billed PNG `check` and `taste` vision calls need the same flag, and requesting OpenAI without a key fails naming `planr-design setup`.
