# ADR-008: CLI-owned guided interactions

- Status: accepted
- Date: 2026-07-29
- Protocol: v1.2

## Context

Operating Board questions were previously embedded in terminal prompt control
flow. Coding runtimes could either hand users to a competing terminal prompt or
copy product questions and reconstruct commands. Reconstruction allowed field
answers to be mistaken for authority to initialize a project or start a cycle.

## Decision

OpenPlanr is the single behavioral owner for questions, answers, sessions,
validation, previews, confirmations, and mutations. `planr-pipeline` owns strict
portable schemas, adapter presentation capability, conformance, and generated
runtime assets.

Runtime adapters consume CLI-returned questionnaires and actions. They may
choose native UI, structured chat, terminal, or a handoff according to declared
capability. Presentation capability never grants mutation authority.

All non-read-only actions require a fresh digest-bound confirmation for the
named effect. Sessions are machine-local, expiring, and incapable of persisting
sensitive answers.

## Consequences

- Terminal, Claude Code, Codex, and Cursor can present the same canonical
  questions without copying business logic.
- Equal typed answers reduce to the same preview and confirmation inputs.
- Runtime UX can improve independently of governance semantics.
- Existing string `next` fields may remain temporarily for compatibility, but
  typed actions are authoritative.
- Adapters must fail or downgrade honestly when structured interaction is not
  available.
