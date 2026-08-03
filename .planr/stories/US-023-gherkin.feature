@v1
Feature: Coaching-style linter feedback (US-023)
  Linter output includes educational hints configured on rules.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Coaching hints appear for vague-language findings
    Given default or custom vague phrase rules include optional hints
    When I run `planr report-linter` on text that triggers those rules
    Then the CLI prints coaching lines that may include the educational hint

  @v2
  Scenario: Persistent coaching history and positive reinforcement (deferred)
    Given a future release stores per-author linter history across runs
    When report quality improves over time
    Then the tool acknowledges improvement automatically
