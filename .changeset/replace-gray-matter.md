---
"openplanr": patch
---

Replace gray-matter with yaml package to eliminate eval() vulnerability

- Remove gray-matter dependency (+ 6 transitive deps including js-yaml with eval)
- Add yaml package (zero deps, YAML 1.2 spec, no eval, maintained by YAML spec editors)
- Custom frontmatter parse/stringify in ~15 lines with robust regex handling
