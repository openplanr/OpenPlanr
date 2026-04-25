---
name: shape-spec
description: Use this skill when the Product Owner needs guided help authoring a feature spec. Walks them through 4 questions and produces input/specs/spec-{name}.md from the template. Trigger on requests like "shape a spec for X" or "help me write a spec".
argument-hint: <feature-name>
allowed-tools: Read, Write, Edit
---

# Skill: shape-spec

> **Type:** Interactive dialogue
> **Owner:** Product Owner
> **Output:** `input/specs/spec-{name}.md` (pre-filled from `${CLAUDE_PLUGIN_ROOT}/templates/spec.md.tpl`)
> **Purpose:** Guide non-technical POs through writing a valid spec via conversation

## Trigger

```
/openplanr-pipeline:shape-spec {name}
```

Where `{name}` becomes the feature folder name (e.g. `auth`, `dashboard`, `checkout`).

## Dialogue Flow

Conduct a structured conversation with the PO across 4 questions. Each question builds on the previous answer. The PO can answer in plain language.

### Question 1 — Context

```
What is the business context for this feature?
Who is the primary user, and what problem are they trying to solve?

(Plain language. 2–5 sentences is ideal.)
```

*Skill behavior: Extract role, pain point, and expected outcome.*

### Question 2 — Goal & Scope

```
What must this feature allow the user to DO?
List the key actions or capabilities — one per line.

(Use action verbs: "view", "create", "edit", "delete", "search", etc.)
```

*Skill behavior: Map each bullet to a candidate User Story or functional requirement.*

### Question 3 — Business Rules & Constraints

```
Are there any rules, limits, or restrictions this feature must enforce?
For example: permissions, validation rules, data formats, limits, dependencies.

(If none, say "none" and we'll skip this section.)
```

*Skill behavior: Populate the Business Rules section of the spec.*

### Question 4 — Screens / Acceptance

```
Do you have screen mockups or wireframes for this feature?
If yes, list the PNG filenames you'll drop into input/ui/feat-{name}/.

Also: how will you know this feature is done?
Describe 2–3 observable outcomes you'd verify.
```

*Skill behavior: Set UIFiles list + populate Acceptance Criteria.*

## Output Generation

After all 4 answers:

1. Read `${CLAUDE_PLUGIN_ROOT}/templates/spec.md.tpl` as the base template.
2. Pre-fill all answered sections from the dialogue.
3. Mark unanswered optional sections with `[TO FILL]`.
4. Add a summary at the top:

```markdown
> ✅ Generated via /openplanr-pipeline:shape-spec on [date]
> Completeness: [X/4 sections answered]
> Review before running: /openplanr-pipeline:po-phase {name}
```

5. Write to `input/specs/spec-{name}.md` (in the user's project root).

## Post-Generation Prompt

```
Your spec has been created at input/specs/spec-{name}.md

Next steps:
1. Review and edit the file if needed
2. Drop any UI PNGs into input/ui/feat-{name}/ (optional)
3. When ready: /openplanr-pipeline:po-phase {name}

Tip: If you have screen mockups, add them now — the designer-agent
     will generate a full design spec automatically.
```

## Validation Rules

Warn (but do not block) if:
- Feature name contains spaces → suggest kebab-case
- No acceptance criteria provided → prompt again
- Scope is too vague (e.g. "make it better") → ask for specifics

---

*Writes: `input/specs/spec-{name}.md`*
*See: `${CLAUDE_PLUGIN_ROOT}/docs/spec-anatomy.md` for the full spec format reference*
