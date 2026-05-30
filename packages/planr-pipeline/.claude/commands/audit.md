# planr-pipeline & OpenPlanr — Master Codebase Audit Prompt
# For use in Claude Code / any agentic coding environment
# Drop this as a slash command or paste directly into Claude Code

---

You are a **Principal Engineer & Product Architect** conducting a full adversarial audit of this codebase. Your job is not to be polite. Your job is to find every structural, architectural, and experiential problem — then produce an actionable plan to fix them.

This audit has **three phases**. You must complete them in order. Do not skip phases. Do not summarize — produce full deliverables.

---

## PHASE 1 — DISCOVERY (Read-Only)

Scan the entire repository. Read every file. Build a mental model before drawing conclusions.

### 1.1 Structure Inventory
Run the following and record the output:
```
find . -type f | grep -v node_modules | grep -v .git | sort
```
Then map the tree into categories:
- Entry points (CLI commands, slash commands)
- Agent definitions
- Shared utilities / helpers
- Config / schema files
- Templates
- Documentation
- Tests
- Generated / output artifacts

### 1.2 Complexity Heatmap
For every source file, record:
- Line count
- Number of functions / exported symbols
- Number of external imports
- Cyclomatic complexity (estimate from nesting depth)

Flag any file over 300 lines as a **bloat candidate**. Flag any file over 500 lines as a **critical bloat violation**.

### 1.3 Dependency Audit
Read `package.json` (and any sub-package manifests). For every dependency, ask:
- Is it actually used? (grep for import/require)
- Could it be replaced by a built-in Node/TypeScript equivalent?
- Is it a heavy library doing a job that needs 10 lines of code?
- Is it pinned to a specific version? Is that version current?

Flag every unused or replaceable dependency as a **dead weight item**.

### 1.4 Schema & Contract Audit
Locate every schema definition (Zod, TypeScript interfaces, JSON schema, frontmatter contracts). For each:
- Is the schema co-located with its consumer, or floating?
- Is it validated at runtime or only at compile time?
- Is there a single source of truth, or duplicates?
- Is the schema versioned?

### 1.5 Agent Roster Audit
For each agent (db-agent, designer-agent, specification-agent, frontend-agent, backend-agent, qa-agent, devops-agent, doc-gen-agent):
- Read its definition file completely
- Record: model assignment, tool restrictions, responsibilities, output contract
- Identify: scope creep (does it do more than one thing?), missing constraints, ambiguous responsibility boundaries
- Check: is the tool restriction enforced at the manifest level or only in the prompt?

### 1.6 Command Surface Audit
For every slash command and CLI command:
- What does it accept as input?
- What does it produce as output?
- What are the failure modes?
- Is the failure mode handled gracefully?
- Is there a dry-run mode?
- Is there a non-interactive / CI mode?

### 1.7 Error Handling Audit
Search for all try/catch blocks, error returns, and exit codes. For each:
- Is the error surfaced to the user with a human-readable message?
- Is the error logged with enough context to debug?
- Is the error recoverable? If so, is recovery attempted?
- Is there a partial-failure state that leaves the codebase in an inconsistent state?

### 1.8 Test Coverage Audit
Locate all test files. For each:
- What is tested? (unit, integration, end-to-end?)
- What is NOT tested? (identify critical untested paths)
- Are agents tested? Are schemas tested? Are command flows tested?
- Is there a test runner configured? Does it pass?

---

## PHASE 2 — VERDICT

For each item discovered in Phase 1, classify it into one of these buckets. Be ruthless.

### BUCKET A — Critical Violations (Fix Before Anything Else)
These break reliability, correctness, or maintainability in ways that compound over time. Includes:
- Files over 500 lines that mix multiple concerns
- Agents with no tool-layer enforcement (prompt-only rules)
- Schemas with no runtime validation
- Commands with no error handling
- Untested critical paths (spec decomposition, task generation, ship phase)
- Circular dependencies
- Inconsistent naming conventions across the codebase

### BUCKET B — Structural Debt (Fix in Next Major Cycle)
These slow down feature development and make onboarding painful. Includes:
- Files 300-500 lines that can be split
- Utility functions duplicated across files
- Hardcoded strings / magic values that should be constants
- Missing TypeScript types (any, implicit any)
- Agent definitions that mix prompt logic with configuration
- Documentation that is stale or contradicts the code

### BUCKET C — Experience Gaps (Fix for Product Quality)
These hurt UX and DX without breaking correctness. Includes:
- Commands with no progress feedback (silent long operations)
- Error messages that expose internal paths or stack traces to users
- Missing `--dry-run` modes on destructive commands
- No cost/token estimation before expensive operations
- Non-obvious command names or flag names
- Inconsistent output formats across commands

### BUCKET D — Bloat (Remove, Don't Fix)
These add weight without adding value. Includes:
- Dependencies that can be removed
- Files that are never imported
- Feature flags / experimental code left in main
- Over-engineered abstractions for single-use cases
- Templates or scaffolds that duplicate each other
- Comments that restate what the code already says

### BUCKET E — Missing Architecture (Add for Long-Term Health)
Things that don't exist yet but will cause pain as the product scales. Includes:
- No context handoff manifest between pipeline phases
- No run log / observability
- No rollback / snapshot mechanism
- No cost estimation before ship
- No learning / pattern memory across runs
- No plugin contract for custom agents

---

## PHASE 3 — EXECUTION PLAN

You will now spawn specialized sub-agents to produce an actionable remediation plan. Each sub-agent has a single responsibility. Run them in the order listed.

---

### Sub-Agent 1: ARCHITECT
**Responsibility:** Redesign the file structure and module boundaries.

Produce a proposed new directory tree that:
- Groups files by **responsibility domain**, not by file type
- Keeps each file under 300 lines (hard limit)
- Co-locates schemas with their consumers
- Separates agent **definitions** (who they are, what tools they have) from agent **prompts** (what they say)
- Separates **pipeline orchestration logic** from **artifact I/O logic**
- Has a clear `index.ts` or entry point per domain

Output format:
```
NEW STRUCTURE:
/
├── agents/
│   ├── db/          # db-agent definition + prompt + tool-manifest
│   ├── designer/
│   ├── specification/
│   ├── frontend/
│   ├── backend/
│   ├── qa/
│   ├── devops/
│   └── doc-gen/
├── pipeline/
│   ├── plan.ts      # PO phase orchestration
│   ├── ship.ts      # DEV phase orchestration
│   ├── manifest.ts  # context handoff manifest schema + writer
│   └── rollback.ts  # pre-ship snapshot + restore
├── schema/
│   ├── spec.ts      # SPEC artifact schema (Zod)
│   ├── story.ts     # US artifact schema
│   ├── task.ts      # Task artifact schema
│   └── manifest.ts  # Context manifest schema
├── commands/
│   ├── plan.md      # /planr-pipeline:plan slash command
│   └── ship.md      # /planr-pipeline:ship slash command
├── stacks/          # stack-specific hints per framework
├── hooks/           # Claude Code hooks
├── templates/       # error-report, design-spec templates
├── tests/
│   ├── schema/
│   ├── pipeline/
│   └── agents/
└── docs/
```

For each file that currently violates the 300-line limit, propose the split: what stays, what moves, where it goes.

---

### Sub-Agent 2: SCHEMA GUARDIAN
**Responsibility:** Define the single source of truth for every data contract.

Audit every artifact schema (SPEC, US, Task, context manifest, stack.md). For each:

1. Write a strict Zod schema (or TypeScript interface + Zod validator) that captures the full contract
2. Identify where this schema is currently implicit (prose in markdown, assumed in prompts) vs explicit (validated at runtime)
3. Propose where each schema file should live
4. Define a schema versioning convention: `schemaVersion: "1.0.0"` in frontmatter, a migration path when schema changes

Output: one schema definition file per artifact type, with inline comments explaining every field, which fields are required vs optional, and which fields agents are allowed to write vs read-only for agents.

---

### Sub-Agent 3: AGENT AUDITOR
**Responsibility:** Enforce single responsibility and tool-layer purity for every agent.

For each of the 9 agents, produce a one-page agent contract:

```
AGENT: backend-agent
MODEL: claude-opus-4-8[1m] (codegen tier)
PHASE: 3 (DEV)
SINGLE RESPONSIBILITY: Generate backend implementation code for Type=Tech tasks
INPUT CONTRACT:
  - Reads: task file, US file, context-manifest.json, input/tech/stack.md
  - Must NOT read: other agents' output files during this phase
OUTPUT CONTRACT:
  - Writes: src/ files specified in task Create/Modify list
  - Writes: nothing outside the task's file scope
TOOL RESTRICTIONS (enforced at manifest level, not prompt level):
  - Read: ✅
  - Write: ✅ (scoped to task's file list only)
  - Edit: ✅
  - Bash(npm:*): ✅
  - Bash(prisma:*): ✅
  - Bash(node:*): ✅
  - Bash(git:*): ❌ (no commits during codegen)
  - Bash(docker:*): ❌
  - Bash(curl:*): ❌
  - Bash(rm:*): ❌
FAILURE BEHAVIOR:
  - Max 3 iterations (R6)
  - On failure: write error-report.md, halt, do not proceed to qa-agent
SCOPE VIOLATIONS TO DETECT:
  - Agent writing to files not in task's Create/Modify list → HALT
  - Agent calling forbidden bash commands → HALT
  - Agent skipping error-report.md after 3 failures → FLAG
```

Flag every agent where current tool restrictions are ONLY in the prompt (not in the manifest `tools:` field). This is a critical violation — prompts can be ignored, manifests cannot.

---

### Sub-Agent 4: DX AUDITOR (Developer Experience)
**Responsibility:** Make the pipeline a joy to use and impossible to misuse.

Audit every command and interaction surface. For each issue found, produce a specific fix:

**Command ergonomics:**
- Are command names consistent and predictable?
- Do flags have short aliases for common operations?
- Does every destructive command require confirmation or `--yes`?
- Does every long operation show progress (spinner, stage indicators)?
- Is the output machine-parseable (JSON) when piped, human-readable when TTY?

**Error messages:**
- Does every error tell the user: what went wrong, why it happened, and what to do next?
- Example of bad error: `Error: ENOENT: no such file or directory`
- Example of good error: `Spec file not found at .planr/specs/SPEC-001-auth/. Run 'planr spec init' first, then 'planr spec create auth'.`

**Onboarding:**
- Can a new user go from `git clone` to a successful `/planr-pipeline:ship` with zero prior knowledge?
- Is there a `--wizard` mode for first-time setup?
- Is there a minimal working example (a pre-built spec) that ships with the repo?

**Feedback loops:**
- After `/planr-pipeline:plan`, does the user know exactly what to review and where?
- After `/planr-pipeline:ship`, does the user know what was built, what changed, and what to do next?
- On failure, does the error-report.md link directly to the failing task file?

Produce: a numbered list of DX issues with severity (critical / moderate / minor) and a specific before/after fix for each.

---

### Sub-Agent 5: BLOAT ELIMINATOR
**Responsibility:** Identify and remove everything that does not earn its place.

Audit with zero sentimentality. For everything found:
- State what it is
- State what value it provides
- State whether that value can be achieved with less
- Give a clear KEEP / SIMPLIFY / DELETE verdict

Categories to audit:
1. **Dependencies** — every package in package.json. Justify each one.
2. **Template files** — are all templates used? Do any duplicate each other?
3. **Stack files** — are all stack variants used? Are they maintained?
4. **Documentation files** — are all docs current? Do any contradict the code?
5. **Agent prompt length** — are prompts longer than they need to be? Identify filler, repetition, and over-specification that adds tokens without adding precision.
6. **Command flags** — are all flags documented and used? Are any flags that solve the same problem as another flag?
7. **Helper functions** — are utilities shared or duplicated? Are there abstractions that exist for a single use case?

Rule: **if you can't clearly state the value, delete it.** Bloat doesn't announce itself. Bloat looks like "we might need this later" and "it's harmless to keep it."

---

### Sub-Agent 6: SCALABILITY STRATEGIST
**Responsibility:** Identify what breaks as the product grows — in usage, features, and team size.

Analyze the current architecture against three growth scenarios:

**Scenario A: 10x spec complexity** — specs with 20+ stories, 50+ tasks, deep dependency graphs. What fails? Where do linear sequential agents become bottlenecks? Where does the context window fill up?

**Scenario B: Custom agent plugins** — a user wants to add a `mobile-agent` or `ml-agent`. What does the current architecture make hard? What would need to change to support a plugin contract?

**Scenario C: Team usage** — multiple developers on the same codebase, running the pipeline concurrently on different specs. What breaks? File conflicts? Race conditions on shared files? No locking mechanism?

For each scenario, produce:
- The specific breaking points
- The architectural change needed to handle them
- A complexity estimate (small / medium / large refactor)

---

### Sub-Agent 7: TEST STRATEGIST
**Responsibility:** Define the minimum test suite that gives real confidence.

Current gap: identify what is untested and what the risk is of it failing silently.

Produce a test plan with three tiers:

**Tier 1 — Schema contracts (fast, zero LLM calls)**
- Every Zod schema has a unit test with valid input, invalid input, and edge cases
- Every frontmatter parser has a unit test
- Every artifact writer has a unit test (writes correct structure, correct file path)

**Tier 2 — Pipeline orchestration (mocked LLM)**
- `/planr-pipeline:plan` with a pre-written spec → expected US + task structure
- `/planr-pipeline:ship` with pre-written tasks → expected file creation order
- Phase gate enforcement: ship refuses if plan hasn't run
- Rollback: ship failure → expected git state restored
- Max-3 iterations: agent fails 3 times → error-report.md written, pipeline halts

**Tier 3 — Integration (real LLM, expensive, run in CI only)**
- Full plan + ship on a minimal spec (single story, single task)
- Validates that `.pipeline-shipped` marker exists
- Validates that generated code compiles/passes `npm run build`

For each test, specify: file location, test name, what it asserts, and what it would catch.

---

## FINAL OUTPUT — THE MASTER REMEDIATION PLAN

After all 7 sub-agents complete, synthesize their findings into:

### Section 1: Critical Path (do these first, in order)
A numbered list of actions that unblock everything else. These are the structural changes that, if done wrong, make all other improvements harder.

### Section 2: Sprint-Sized Work Packages
Group all remediation items into packages that can each be completed in 2-3 days. Each package has:
- **Title** (what it is)
- **Why it matters** (what breaks without it)
- **Acceptance criteria** (how you know it's done)
- **Files affected** (which files change)
- **Estimated complexity** (S / M / L)

### Section 3: The Product Constitution
A short, opinionated document (1-2 pages) that defines:
- What this product IS (one sentence)
- What this product is NOT (three hard boundaries)
- The 5 non-negotiable architecture rules
- The definition of done for a new feature
- The standard for when a file is "too big"
- The standard for when a feature is "too complex"

This document becomes the decision filter for all future development. When someone proposes a new feature, you read this first.

### Section 4: Health Score Dashboard
A simple scorecard showing current state vs. target state:

```
DIMENSION              CURRENT    TARGET    GAP
File size discipline    ⚠️ Poor    ✅ Good   [list violations]
Schema validation       ⚠️ Poor    ✅ Good   [list gaps]
Tool-layer enforcement  ✅ Good    ✅ Good   -
Test coverage           ❌ None    ✅ Good   [list missing]
Error handling          ⚠️ Poor    ✅ Good   [list gaps]
DX / UX clarity         ⚠️ Poor    ✅ Good   [list issues]
Dependency hygiene      ⚠️ Poor    ✅ Good   [list dead weight]
Documentation accuracy  ⚠️ Poor    ✅ Good   [list stale docs]
```

---

## RULES FOR THIS AUDIT

1. **Be honest, not diplomatic.** If something is bad, say it's bad. Vague feedback is useless.
2. **Every finding must be specific.** "Code quality is poor" is not a finding. "File `agents/backend.md` is 847 lines and mixes prompt logic, schema definition, and tool configuration — split into 3 files" is a finding.
3. **Every recommendation must be actionable.** "Improve error handling" is not actionable. "Add a try/catch in `pipeline/ship.ts:executeDEVPhase()` that catches subagent timeout and writes `error-report.md` before halting" is actionable.
4. **Do not add features during an audit.** The audit finds problems. The sprint plan fixes them. Keep these separate.
5. **Respect the product's design principles.** R1 (no auto-chain), R3 (fixed model assignments), R8 (db READ-ONLY) are non-negotiable. Work within them, not around them.
6. **Prefer deletion over abstraction.** If something isn't earning its place, remove it. Do not wrap it in a new abstraction.
7. **File size is a proxy for clarity.** A 600-line file is almost always doing too many things. Name what it's doing and split it.

---

## START HERE

```bash
# First command to run — get the full picture
find . -type f \( -name "*.ts" -o -name "*.md" -o -name "*.json" -o -name "*.js" \) \
  | grep -v node_modules | grep -v .git | grep -v dist \
  | xargs wc -l | sort -rn | head -50
```

Read the output. The top 10 files by line count are your first targets.

Then read the README.md and every file in `docs/`. Then read every agent definition. Then read the pipeline entry points.

Only after reading everything do you begin Phase 2.
