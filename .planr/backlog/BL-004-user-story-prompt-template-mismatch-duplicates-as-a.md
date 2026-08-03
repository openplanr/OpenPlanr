---
id: "BL-004"
title: "User story prompt/template mismatch duplicates 'As a' / 'I want to' / 'So that' prefixes"
priority: "high"
tags: ["bug", "ai", "prompts", "templates", "stories", "revise"]
status: "open"
created: "2026-04-22"
updated: "2026-04-22"
---

# BL-004: User story prompt/template mismatch duplicates 'As a' / 'I want to' / 'So that' prefixes

## Priority
HIGH

## Tags

- bug
- ai
- prompts
- templates
- stories
- revise

## Description

### Problem (observed via `planr revise`)

`planr revise` consistently flags user story files for malformed story format. The rendered story repeats the prefix twice:

```md
**As a** As a product manager
**I want to** I want to authenticate with Linear using my Personal Access Token
**So that** So that I can securely connect OpenPlanr to my Linear workspace
```

After revise auto-fixes it, the diff looks like:

```diff
+**As a** product manager
+**I want to** I want to authenticate with Linear using my Personal Access Token
+**So that** So that I can securely connect OpenPlanr to my Linear workspace
-**As a** As a product manager
-**I want to** I want to authenticate with Linear using my Personal Access Token
-**So that** So that I can securely connect OpenPlanr to my Linear workspace
```

This happens on every revise pass that touches a generated story, meaning the underlying generator is consistently producing malformed content and revise is cleaning it up as a side effect rather than the story being correct at generation time.

### Root cause

The prompt and the template contradict each other:

- **Prompt** ([src/ai/prompts/system-prompts.ts:73](../../src/ai/prompts/system-prompts.ts)) instructs the model to return `role` as `"As a <role>"`, `goal` as `"I want to <goal>"`, `benefit` as `"So that <benefit>"` — i.e., **with** the prefix already baked into the value.
- **Template** ([src/templates/stories/user-story.md.hbs:15-17](../../src/templates/stories/user-story.md.hbs)) renders `**As a** {{role}}`, `**I want to** {{goal}}`, `**So that** {{benefit}}` — i.e., the template also adds the prefix.

Result: every generated story double-prints the prefix. The prompt wording (`"As a <role>"`) was likely intended as a conceptual hint but is being interpreted by the model as a literal format instruction.

### Acceptance criteria

1. Generated stories render exactly once:
   ```
   **As a** product manager
   **I want to** authenticate with Linear using my Personal Access Token
   **So that** I can securely connect OpenPlanr to my Linear workspace
   ```
2. Fix in the **prompt** ([src/ai/prompts/system-prompts.ts](../../src/ai/prompts/system-prompts.ts) STORIES_SYSTEM_PROMPT): reword the field descriptions so the model returns **only the fragment** (e.g., `"role": The user role WITHOUT the "As a" prefix — e.g., "product manager" not "As a product manager"`). Do the same for `goal` and `benefit`.
3. Audit the gherkin prompt/template pair for the same pattern ([src/templates/stories/gherkin.feature.hbs](../../src/templates/stories/gherkin.feature.hbs)) — given/when/then may have the same "prefix baked into value + template adds prefix" bug.
4. Regenerate or back-fix existing malformed stories under `.planr/stories/` that have double prefixes (spot check: US-054 was already fixed by revise; other stories generated before this fix lands may still be malformed).
5. Add a regression test that asserts a generated story's rendered markdown contains `"**As a** <role>"` exactly once (no nested `As a As a`).

### Out of scope

- Restructuring the prompt architecture beyond fixing these three fields + gherkin scenario fields.
- Changing the user-facing template format.

### References

- Prompt: [src/ai/prompts/system-prompts.ts:80-82](../../src/ai/prompts/system-prompts.ts)
- Template: [src/templates/stories/user-story.md.hbs:15-17](../../src/templates/stories/user-story.md.hbs)
- Real-world example: US-054 under FEAT-015 (Linear integration epic)

---

_Promote to agile hierarchy: `planr backlog promote BL-004 --story` or `planr backlog promote BL-004 --quick`_
_Close when done: `planr backlog close BL-004`_
