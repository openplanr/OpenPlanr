Feature: Clean Git Tree Requirement with Override
  US-038 - As a As a developer using planr revise, I want to I want the system to require a clean git tree before making changes so that So that I can safely rollback if something goes wrong and avoid mixing revision changes with uncommitted work

  Background:
    Given the system is initialized

  Scenario: Clean tree allows operation
    Given The git working directory is clean
    When I run planr revise on an artifact
    Then The revision process continues normally

  Scenario: Dirty tree blocks operation
    Given The git working directory has uncommitted changes
    When I run planr revise without --allow-dirty
    Then The command fails with a clean tree requirement message

  Scenario: Override allows dirty tree operation
    Given The git working directory has uncommitted changes
    When I run planr revise with --allow-dirty flag
    Then The revision process continues with a warning about dirty tree

