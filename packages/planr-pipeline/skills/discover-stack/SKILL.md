---
name: discover-stack
description: Use this skill when a technology referenced in stack.md has no corresponding file in the stack library. Walks the Tech Lead through 4 questions and writes .claude/stacks/{category}/{name}.md as a user-side override.
argument-hint: <category: frontend|backend|database|devops>
allowed-tools: Read, Write, Edit, Glob
---

# Skill: discover-stack

> **Type:** Interactive dialogue
> **Owner:** Tech Lead
> **Output:** `.claude/stacks/{category}/{stack-name}.md` (in the user's project — overrides plugin defaults)
> **Purpose:** Help the Tech Lead document a stack that isn't yet in the plugin's library

## Trigger

```
/openplanr-pipeline:discover-stack {category}
```

Where `{category}` is one of: `frontend` | `backend` | `database` | `devops`

## When to Use

Use this skill when `input/tech/stack.md` references a technology that has no corresponding file in either:
- `${CLAUDE_PLUGIN_ROOT}/stacks/{category}/` (plugin defaults), or
- `.claude/stacks/{category}/` (user overrides)

The specification-agent will warn:
```
⚠️ Stack file not found: stacks/backend/django.md
   Run /openplanr-pipeline:discover-stack backend to create it.
```

The new file is written to `.claude/stacks/...` in the user's project. The plugin's defaults remain untouched. User project files always win on filename collision.

## Dialogue Flow

### Question 1 — Technology Identity

```
What technology are you adding to the stack library?
(e.g. "NestJS", "Drizzle ORM", "Fly.io", "SvelteKit")

Provide: name, version, and official docs URL.
```

### Question 2 — Folder & File Conventions

```
What are the standard file/folder conventions for this technology?

Describe:
- Typical project structure
- File naming patterns
- Key config files
```

### Question 3 — Code Patterns

```
What are the core code patterns agents should follow?

Describe:
- How to create a new module/feature
- How to define a data model
- How to expose an endpoint or page
- Any must-use decorators, annotations, or utilities
```

### Question 4 — Integration Points

```
How does this technology connect with the rest of the stack?

Describe:
- How it reads/writes to the database (if applicable)
- How it communicates with the frontend/backend (if applicable)
- Any required env vars or config keys
```

## Output: `.claude/stacks/{category}/{stack-name}.md`

```markdown
# Stack: {StackName}

> **Category:** {category}
> **Version:** {version}
> **Docs:** {official URL}
> **Created:** {date} via /openplanr-pipeline:discover-stack

---

## Overview

[Auto-filled from Question 1 answers]

## Project Structure

[Auto-filled from Question 2 answers]

## Code Patterns

[Auto-filled from Question 3 answers]

## Integration Points

[Auto-filled from Question 4 answers]

---

## Agent Usage Notes

> How specification-agent and DEV agents should use this stack definition.

- File path pattern: [e.g. `src/modules/{feature}/{Feature}.module.ts`]
- Entry point pattern: [e.g. `src/main.ts`]
- Test file pattern: [e.g. `{name}.spec.ts` co-located]
- Key imports: [most commonly needed imports]
```

## Post-Generation Prompt

```
Stack definition created: .claude/stacks/{category}/{stack-name}.md

Next steps:
1. Add it to input/tech/stack.md under ActiveStackFiles
2. Re-run your spec: /openplanr-pipeline:po-phase {name}

The specification-agent will now use this stack definition
when decomposing features (user override takes precedence over plugin defaults).
```

---

*Writes: `.claude/stacks/{category}/{stack-name}.md` (user project)*
*See: `${CLAUDE_PLUGIN_ROOT}/stacks/` for plugin-shipped stack definitions*
