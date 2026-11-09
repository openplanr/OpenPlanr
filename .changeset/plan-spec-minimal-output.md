---
"openplanr": minor
---

In a repository with no `.planr/` folder, Plan now returns the decomposition in chat or in one file where the repository keeps such documents, and Spec writes the specification where the repository already keeps specifications. With `.planr/`, or when implementation follows, both work as before.

Plan no longer copies an existing specification into `.planr/specs/`; it references the specification's path. Gherkin files are written only when you ask.
