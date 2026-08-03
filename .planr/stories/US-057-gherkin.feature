Feature: Create Linear project from Epic with metadata
  US-057 - As a As a product manager, I want to I want to push an Epic to Linear as a Project so that So that I can track the entire Epic scope in Linear's project management interface

  Background:
    Given the system is initialized

  Scenario: Successfully create Linear project from Epic
    Given I have an Epic with title and description
    When I run planr linear push EPIC-004
    Then A Linear Project is created with Epic title, description, and metadata

  Scenario: Handle existing Linear project
    Given The Epic already has a Linear project ID in frontmatter
    When I run planr linear push EPIC-004
    Then The existing Linear project is updated instead of creating a duplicate

  Scenario: Store Linear project ID in Epic frontmatter
    Given A Linear project is successfully created
    When The push operation completes
    Then The Linear project ID is stored in the Epic's frontmatter

