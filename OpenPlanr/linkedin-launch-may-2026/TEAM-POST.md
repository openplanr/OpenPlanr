# LinkedIn Post — "The Team" (Direction A)

> **Strategy:** Personification angle. Pitches OpenPlanr by describing what
> "8 specialized subagents" actually means in human terms.
> **Pair with:** `openplanr-team-card.png` (1080×1080 square).
> **Voice:** Personal first-person ("I gave..."). Short declarative sentences.
> No asterisks, no em-dashes between words.
> **Length:** 615 characters — well under LinkedIn's 3,000-char ceiling.

---

## The post body (paste into LinkedIn as-is)

I gave my AI coding agents a team structure.

A planner who decomposes specs. An estimator who shows the bill before shipping. A frontend dev who stays in their lane. A QA who catches drift. A DevOps who packages it. A writer who keeps the docs honest.

They started shipping like a real engineering team.

That's what OpenPlanr is.

```
npm install -g openplanr
```

#OpenSource #AgenticCoding #ClaudeCode #DeveloperTools #BuildInPublic

---

## Pin this as the first comment

> 8 specialists. Sonnet 4.6 for analysis (db, designer, specification, qa, devops, doc-gen). Opus 4.7 for code (frontend, backend). Each one has manifest-enforced tool restrictions, so the frontend agent literally cannot write backend files.
>
> Repo · `github.com/openplanr/openplanr`
> Plugin · `github.com/openplanr/planr-pipeline`
> Docs · `openplanr.dev`
>
> Follow me on GitHub · `github.com/asemdevs`

---

## Why this works

The previous post was philosophical and abstract ("build your own coding ecosystem"). This one is personal and concrete ("I gave my AI a team"). Posting them 2–3 days apart gives readers two angles on the same product without either feeling repetitive.

The image is the proof. The post body is the framing. A reader who scrolls past the words will still pause on a team-roster layout because it's a universally recognized format — *every dev has seen an "about the team" page on a company site*. That pause is the conversion.

The closing CTA is one line (`npm install -g openplanr`) — no marketplace command, no multi-step install. For a short post, one command is more conversion-friendly than two. The pinned first comment carries the rest of the links.

---

## Reply playbook (3 likely questions)

### Q — "Are these actual sub-agents or just prompt personas?"

> Actual subagents. On Claude Code they live in the plugin manifest as separate agent files, each with its own `model`, `tools[]` allowlist, and prompt. Sonnet 4.6 for analysis tasks (db, designer, spec, qa, devops, doc-gen), Opus 4.7 for code generation (frontend, backend). The orchestrator dispatches them per-task with isolated context.

### Q — "How does the frontend agent 'literally cannot' write backend files?"

> Tool-layer enforcement. The agent's `tools:` frontmatter only allowlists Read/Edit on `src/components/**` and similar UI paths. When the model tries to Edit a backend path, the tool call fails before any write happens. The rule lives in the manifest, not the prompt — so it survives prompt injection, jailbreak attempts, or the model just being confused.

### Q — "Does this work on Cursor / Codex?"

> Yes. Claude Code is the canonical adapter (the only runtime that enforces tool restrictions at the manifest layer), but the same 8-agent contract runs on Cursor and Codex via `planr rules generate --target cursor --scope pipeline` (or `--target codex`). Same `.planr/specs/` artifacts, same workflow. Manifest enforcement becomes advisory on those runtimes.
