@v1
Feature: Evidence-linked report content (US-018)
  Generated reports include an evidence appendix (artifacts, commits, PRs). Optional strict mode enforces anchors in narrative bullets.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Evidence appendix lists commits and PRs with URLs
    Given GitHub activity exists for the lookback window
    When I run `planr report weekly --stdout`
    Then the Evidence section contains markdown links to commits and pull requests where available

  @v1
  Scenario: Strict evidence mode rejects weak narrative bullets
    Given a generated report whose `##` sections have bullets without URLs or issue references
    When I run the same generation path with `--strict-evidence`
    Then the CLI exits with a non-zero status and lists offending bullets
