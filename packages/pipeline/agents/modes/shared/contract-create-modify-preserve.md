<!-- Shared by backend and frontend roles in both planning modes. -->

## Expected scope and Preserve safety

- Treat Create and Modify entries as the expected change surface, not an exhaustive
  lock list. Implement the listed work that remains relevant to the requested
  outcome.
- A directly required companion test, declaration, migration, fixture, generated
  file, route registration, or configuration change is in scope when it supports
  acceptance behavior and stays inside the role's ownership boundary.
- Leave every genuine Preserve path unchanged. Preserve is a safety boundary, not
  a reason to ignore an achievable outcome; use a safe in-scope alternative when
  one exists.
- Do not expand into unrelated product behavior. Summarize companion files that
  were not named in the task so the result stays easy to review.
- If the requested outcome truly conflicts with Preserve or the role boundary,
  report the concrete conflict and the smallest useful next action.
