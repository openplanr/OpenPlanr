Feature: Create Feature issues linked to Epic project
  US-058 - As a As a product manager, I want to I want Features to become top-level Issues in the Linear project so that So that I can track feature progress and assign them to teams in Linear

  Background:
    Given the system is initialized

  Scenario: Create Feature issues in Linear project
    Given An Epic has been pushed to Linear as a Project
    When I push Features to Linear
    Then Each Feature becomes a top-level Issue linked to the Epic project

  Scenario: Handle Features with existing Linear issues
    Given A Feature already has a Linear issue ID in frontmatter
    When I push the Feature to Linear
    Then The existing Linear issue is updated instead of creating a duplicate

  Scenario: Store Linear issue IDs in Feature frontmatter
    Given Feature issues are successfully created in Linear
    When The push operation completes
    Then Linear issue IDs are stored in each Feature's frontmatter

