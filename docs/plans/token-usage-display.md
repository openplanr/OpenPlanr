# Plan: Token Usage Display After AI Calls

## Context

When running AI-powered commands (`planr refine`, `planr plan`, `planr feature create`, etc.), the CLI shows a spinner with "Generating..." but provides no feedback about token consumption. Users have no visibility into how many tokens each operation costs. The Anthropic and OpenAI SDKs both return token usage data in their responses — we just need to capture and display it.

## Goal

Show token usage summary after every AI generation call:
```
⠋ Generating...
✓ Done (1,240 in → 860 out tokens)
```

---

## Step 1: Add `AIUsage` type and update provider interface

### File: `src/ai/types.ts`
- Add `AIUsage` type: `{ inputTokens: number; outputTokens: number }`
- Add `lastUsage: AIUsage | null` property to `AIProvider` interface
- Each provider sets `this.lastUsage` after completing a call — no return type changes needed

---

## Step 2: Capture usage from Anthropic SDK

### File: `src/ai/providers/anthropic-provider.ts`
- **`chatSync()`**: Extract `response.usage.input_tokens` and `response.usage.output_tokens` from the `Message` object returned by `client.messages.create()`. Store in `this.lastUsage`
- **`chat()` (streaming)**: After stream completes, capture usage from the final message event or `stream.finalMessage()`. Store in `this.lastUsage`

SDK response shape (already available):
```typescript
response.usage.input_tokens   // number
response.usage.output_tokens  // number
```

---

## Step 3: Capture usage from OpenAI SDK

### File: `src/ai/providers/openai-provider.ts`
- **`chatSync()`**: Extract `response.usage.prompt_tokens` and `response.usage.completion_tokens`, map to `AIUsage` format. Store in `this.lastUsage`
- **`chat()` (streaming)**: Add `stream_options: { include_usage: true }` to get usage in the final chunk. Store in `this.lastUsage`

SDK response shape:
```typescript
response.usage.prompt_tokens       // → inputTokens
response.usage.completion_tokens   // → outputTokens
```

---

## Step 4: Handle Ollama provider

### File: `src/ai/providers/ollama-provider.ts`
- Ollama may not provide token counts — set `lastUsage = null` (skip display)

---

## Step 5: Update AI service to read and display usage

### File: `src/services/ai-service.ts`
- After `generateJSON()` and `generateStreamingJSON()` complete, read `provider.lastUsage`
- Update spinner stop to show usage: `✓ Done (X in → Y out tokens)`
- If `lastUsage` is null (Ollama), just show `✓ Done`

---

## Step 6: Add `formatUsage()` helper and spinner `succeed()` method

### File: `src/utils/logger.ts`
- Add helper:
  ```typescript
  function formatUsage(usage?: AIUsage | null): string {
    if (!usage) return '';
    return ` (${usage.inputTokens.toLocaleString()} in → ${usage.outputTokens.toLocaleString()} out tokens)`;
  }
  ```
- Add `succeed(msg: string)` method to `Spinner` — clears spinner line and prints success message with green checkmark

---

## Step 7: Cumulative usage for cascade/batch operations

### Files to modify
- **`src/cli/commands/refine.ts`** — In `refineCascade()`, accumulate usage across all AI calls:
  ```
  ✓ Cascade complete: 7 artifacts refined (12,400 in → 8,200 out tokens total)
  ```
- **`src/cli/commands/plan.ts`** — In `planFromScratch()`, accumulate across epic + features + stories + tasks

---

## Step 8: Add tests

### Files to create/modify
- **`tests/unit/token-usage.test.ts`** — Test `formatUsage()` helper (null → empty, valid → formatted)
- Update `tests/unit/logger.test.ts` — Test spinner `succeed()` method
- Update provider tests to verify `lastUsage` is set after calls

---

## Output examples

```
⠋ Generating...
✓ Done (1,240 in → 860 out tokens)

⠋ Generating...
✓ Done                                    ← Ollama (no usage data)

⠋ Retrying...
✓ Done (2,480 in → 1,720 out tokens)      ← includes retry tokens

✓ Cascade complete: 7 artifacts refined (12,400 in → 8,200 out tokens total)
```

---

## Files summary

| File | Change |
|------|--------|
| `src/ai/types.ts` | Add `AIUsage`, add `lastUsage` to `AIProvider` |
| `src/ai/providers/anthropic-provider.ts` | Capture `response.usage` |
| `src/ai/providers/openai-provider.ts` | Capture `response.usage` |
| `src/ai/providers/ollama-provider.ts` | Set `lastUsage = null` |
| `src/services/ai-service.ts` | Read usage after calls, display in spinner |
| `src/utils/logger.ts` | Add `formatUsage()`, spinner `succeed()` |
| `src/cli/commands/refine.ts` | Cumulative usage for cascade |
| `src/cli/commands/plan.ts` | Cumulative usage for plan flow |

## Verification

```bash
npm run build
npm test                              # all tests pass
planr refine EPIC-001                 # shows "✓ Done (X in → Y out tokens)"
planr refine EPIC-001 --cascade       # shows per-artifact + total usage
planr plan --epic EPIC-001            # shows usage for each generation step
```
