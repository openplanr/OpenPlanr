@v1
Feature: Transcript to structured standup (US-029)
  Heuristic parser extracts yesterday, today, and blockers sections.

  Background:
    Given an OpenPlanr project exists with `.planr/config.json`

  @v1
  Scenario: Labeled transcript lines populate all sections
    Given a transcript uses lines like "Yesterday: …", "Today: …", "Blockers: …"
    When I run `planr voice standup --file transcript.txt`
    Then the markdown contains populated Yesterday, Today, and Blockers sections

  @v1
  Scenario: Incomplete transcript adds a completion note
    Given a transcript is missing yesterday or today content
    When I run `planr voice standup --file transcript.txt`
    Then the output notes that sections may be incomplete

  @v1
  Scenario: Parser records segments for future audio sync metadata
    When the standup parser runs
    Then each parsed line is also represented in a `segments` list for optional timestamps
