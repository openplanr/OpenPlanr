@v1
Feature: Evidence validation signals (US-019)
  The tooling warns when repository access is uncertain; reports still generate for review.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: GitHub reachability is checked best-effort
    When I run `planr report weekly --stdout` with GitHub enabled
    Then the CLI may log a warning if evidence validation suspects the repo is unreachable

  @v1
  Scenario: Planning export includes a flat evidence index
    When I run `planr export --format markdown`
    Then the export contains an Evidence index section listing stories and tasks for traceability
