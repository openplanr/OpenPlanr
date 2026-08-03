@v1
Feature: Vague language detection (US-022)
  The linter suggests more specific phrasing when generic status language is detected.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Low-signal phrases produce suggestions
    Given a report includes wording like "making progress" or "almost done"
    When I run `planr report-linter` on the file
    Then findings reference `vague-language` and include suggested replacements

  @v1
  Scenario: Specific measurable language avoids vague-language hits for those phrases
    Given a report states concrete counts, IDs, or URLs instead of generic progress language
    When I run `planr report-linter` on the file
    Then vague-language findings are absent for those sentences
