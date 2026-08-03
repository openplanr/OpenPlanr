@v1
Feature: Quality validation for standups (US-031)
  Dictated standups can use the same linter as stakeholder reports.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Lint standup output
    When I run `planr voice standup --file transcript.txt --lint`
    Then `planr report-linter` rules run against the standup type and non-error severity does not block by default

  @v1
  Scenario: Story command appends standup with optional lint gate
    Given a user story file exists
    When I run `planr story standup --story US-028 --file transcript.txt --lint`
    Then the story gains a dated `## Standup notes` section when lint passes

  @v2
  Scenario: Voice-specific coaching beyond generic vague-language rules (deferred)
    Given future rules target common STT errors
    When lint runs
    Then coaching calls out garbled phrases or missing punctuation patterns
