# Operate review procedure

When OpenPlanr reports the cycle `reviewable`:

1. Present the concise executive synthesis in chat.
2. Include separate CEO, CTO, CPO, CMO, COO, and Chair sections, cross-role
   agreements and conflicts, immediate/next/later priorities, owner decisions,
   experiments and proposed metrics, DEV/OWNER/AGENT actions, draft paths, and
   remaining gaps and assumptions.
3. Ensure the canonical files exist under
   `.planr/operate/cycles/<cycle>/`: `report.md`, `report.json`, role files under
   `board/`, and `actions.md`. The visual dashboard is optional.
4. List provisional canonical drafts created by the engine. Explain that they
   are reversible proposals and cannot enter PLAN or SHIP until separately
   approved.
5. Stop at the review gate. Ask separately before approving/discarding a draft,
   accepting/rejecting a finding, applying/rolling back a route, invoking PLAN,
   invoking SHIP, or performing an external effect.
