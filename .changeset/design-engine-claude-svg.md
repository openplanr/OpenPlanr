---
'planr-pipeline': minor
---

The design engine's OpenAI provider is removed, together with `design-engine setup`, `evolve`, `--provider openai`, image quality checks and vision attribute extraction. claude-svg, already the default, remains: your coding agent authors the SVG and the engine reads no API key. If you saved a key with `design-engine setup`, delete `openai_api_key` from `~/.planr/credentials.json`. Doctor no longer reads project `.env` files.
