Feature: Create Story sub-issues linked to Feature issues
  US-059 - As a As a sprint planner, I want to I want Stories to become sub-issues under their parent Features so that So that I can estimate and assign Stories while maintaining the hierarchy in Linear

  Background:
    Given the system is initialized

  Scenario: Create Story sub-issues under Feature issues
    Given Feature issues exist in Linear
    When I push Stories to Linear
    Then Each Story becomes a sub-issue linked to its parent Feature issue

  Scenario: Handle Stories with existing Linear sub-issues
    Given A Story already has a Linear issue ID in frontmatter
    When I push the Story to Linear
    Then The existing Linear sub-issue is updated instead of creating a duplicate

  Scenario: Maintain Story-Feature hierarchy in Linear
    Given Stories are created as sub-issues
    When I view the Feature issue in Linear
    Then All related Story sub-issues are visible and properly linked

