@v1
Feature: Report archive and GitHub delivery (US-026)
  v1 writes dated files under `.planr/reports/` and can open a GitHub issue with the report body.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Reports use consistent dated filenames
    When I run `planr report weekly --no-github` twice on the same day
    Then new files are created under `.planr/reports/` with `YYYY-MM-DD-` prefixes

  @v1
  Scenario: Push report to GitHub as an issue
    Given GitHub CLI is authenticated
    When I run `planr report weekly --push github`
    Then a GitHub issue is created containing the report markdown

  @v2
  Scenario: Git-native commit of report files without using issues (deferred)
    Given a future command commits `.planr/reports` via git or Contents API
    When archiving completes
    Then the repository history contains the report with a descriptive message
