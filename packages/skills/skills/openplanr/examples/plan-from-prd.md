# Example: PRD → Full Agile Hierarchy

A worked scenario showing how Claude turns a PRD markdown file into a complete `.planr/` hierarchy end-to-end.

---

## The ask

> **User:** "Here's our PRD for the user authentication feature — `prd.md`. Plan this out."

## Sample PRD (truncated)

```markdown
# User Authentication

## Goal
Let users sign up, sign in, and manage their session securely.

## Success criteria
- Email/password signup with verification email
- Google OAuth login
- Session persists 30 days with sliding refresh
- Password reset via emailed token
- SOC2-compatible audit logging

## Non-goals
- SSO / SAML (enterprise-only, future)
- MFA (Phase 2)

## Constraints
- Must integrate with existing user table in Postgres
- Session tokens go in httpOnly cookies
```

---

## Agent execution

### Step 1 — verify install + initialize

```bash
npx openplanr@latest --version
# → 1.3.0

# Check if .planr/ exists; if not:
planr init --name "auth-service" --yes
planr config show                     # verify AI provider is configured
```

### Step 2 — generate the epic from the PRD

```bash
planr epic create --file ./prd.md --yes
# → Created .planr/epics/EPIC-001-user-authentication.md
```

Claude reads the generated epic and confirms coverage of the PRD's success criteria before proceeding.

### Step 3 — cascade through the hierarchy

Option A — automated:

```bash
planr plan --epic EPIC-001 --yes
```

Option B — step by step (gives the user chances to review):

```bash
planr feature create --epic EPIC-001 --yes
# → FEAT-001 Email/password signup
# → FEAT-002 Google OAuth
# → FEAT-003 Session management
# → FEAT-004 Password reset
# → FEAT-005 Audit logging

planr story create --epic EPIC-001 --yes
# → US-001..US-015 across all features, each with a gherkin file

planr task create --feature FEAT-001 --yes
planr task create --feature FEAT-002 --yes
# ... one merged task list per feature
```

### Step 4 — generate agent rules

So the implementing agent has context on its first run:

```bash
planr rules generate --yes
# → CLAUDE.md
# → AGENTS.md
# → .cursor/rules/200x-*.mdc
```

### Step 5 — confirm and propose next step

```bash
planr status
```

---

## Resulting `.planr/` tree

```
.planr/
├── config.json
├── epics/
│   └── EPIC-001-user-authentication.md
├── features/
│   ├── FEAT-001-email-password-signup.md
│   ├── FEAT-002-google-oauth.md
│   ├── FEAT-003-session-management.md
│   ├── FEAT-004-password-reset.md
│   └── FEAT-005-audit-logging.md
├── stories/
│   ├── US-001-signup-with-email.md
│   ├── US-001-gherkin.feature
│   ├── US-002-verify-email.md
│   ├── US-002-gherkin.feature
│   └── ... (US-003..US-015)
└── tasks/
    ├── TASK-001-email-password-signup.md
    ├── TASK-002-google-oauth.md
    ├── TASK-003-session-management.md
    ├── TASK-004-password-reset.md
    └── TASK-005-audit-logging.md
```

## Claude's summary to the user

> Created **1 epic** (EPIC-001), **5 features** (FEAT-001..005), **15 stories** with
> gherkin acceptance criteria, and **5 merged task lists** — one per feature. Also
> generated `CLAUDE.md`, `AGENTS.md`, and `.cursor/rules/` so the implementation
> agent has full planning context.
>
> Suggested next step: pick a task to implement — `TASK-001` (signup) is the
> natural starting point since FEAT-002/003/004 depend on it. Want me to open it
> and start on the first unchecked subtask?

---

## Notes for the agent

- If `planr plan` fails mid-cascade (AI quota, network), resume at the specific step — already-generated artifacts won't be re-created.
- If the PRD is too long for the model context, split it into sections and run `epic create --file` per section, then use `refine` to stitch them.
- Always read the generated epic before cascading — users often want to adjust scope before features are generated.
