---
'planr-pipeline': minor
---

The design engine's OpenAI provider is removed, together with `design-engine setup`, `evolve`, `--provider openai`, image quality checks and vision attribute extraction. claude-svg, already the default, remains: your coding agent authors the SVG and the engine reads no API key.

- `--model`, `--image-model`, `--size`, `--quality` and `--from-image` are gone.
- `iterate` and `record` refuse sessions made with the OpenAI provider; start a new session for those designs.
- `doctor --json` no longer reports `auth`, `openai` or `providers.openai`.
- If you saved a key with `design-engine setup`, delete `openai_api_key` from `~/.planr/credentials.json`.
- Doctor no longer reads project `.env` files.
