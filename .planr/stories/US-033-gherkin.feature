Feature: Implement REVISE_SYSTEM_PROMPT with decision rubric
  US-033 - As a As a developer, I want to I want a system prompt that guides AI revision decisions so that So that AI makes consistent fact-based revision choices

  Background:
    Given the system is initialized

  Scenario: System prompt includes decision rubric
    Given The REVISE_SYSTEM_PROMPT constant
    When I examine the prompt content
    Then It contains clear rules for revise/skip/flag decisions

  Scenario: Prompt emphasizes facts over intent
    Given The REVISE_SYSTEM_PROMPT constant
    When I examine the prompt content
    Then It instructs to revise facts but flag intent conflicts

  Scenario: Evidence requirements are specified
    Given The REVISE_SYSTEM_PROMPT constant
    When I examine the prompt content
    Then It requires specific evidence citations for all decisions

