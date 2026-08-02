@v1
Feature: GitHub commits and PRs in reports (US-016)
  Reports can include recent commits and pull requests when GitHub CLI access is available.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Report includes commit and PR sections when GitHub is enabled
    Given the repo is linked to GitHub and `gh` is authenticated
    When I run `planr report weekly --stdout` with default GitHub integration
    Then the output contains commit and pull request evidence when the API returns data

  @v1
  Scenario: GitHub unavailable or rate-limited still produces a report
    Given GitHub data cannot be fetched or returns warnings
    When I run `planr report weekly --stdout`
    Then the report still renders and may include a warning about GitHub data
