# Design craft and browser verification

Aim for a deliberate interface that fits the actual product. Project tokens and
components are authoritative. Static rules help catch accidents; screenshots and
interaction checks establish whether the design works.

## Review while authoring

| Dimension | What to inspect |
| --- | --- |
| Hierarchy | A clear main job and primary action; scanning order matches user priority |
| Typography | Deliberate scale, appropriate density, readable line lengths and labels; aligned data numerals |
| Spacing | Consistent project rhythm, aligned baselines, related items grouped and sections distinguished |
| Components | Consistent control sizes and states; long labels wrap without clipping; repeated badges have coherent dimensions |
| Color | Semantic roles remain consistent; computed text contrast at least 4.5:1 or 3:1 for large text |
| Content | Concrete copy and plausible data; honest loading/empty/error states; no lorem ipsum or misleading product claims |
| Responsiveness | Content reflows at declared frames, controls remain reachable, no accidental horizontal overflow |
| Accessibility | Semantic controls, accessible names, visible focus, logical keyboard order, reduced-motion support |

Use the project's visual vocabulary. Avoid ornamental gradients, repeated generic
cards or decorative imagery that does not serve the content; do not ban treatments
the brand explicitly uses. Use the project icon set and appropriate real assets.
Dense tools and branded pages need different hierarchy and density. A polished
canvas shell does not compensate for a weak interface inside its artboards.

## Keep product and explanation separate

A product artboard must look and behave like the interface the team can build and
ship. Do not turn it into a requirements document, comparison slide, annotated
wireframe, or architecture memo. Move author commentary, tradeoffs, field mappings,
recommendations, citations, and implementation notes into the studio's external
Notes accordion, Walkthrough narrative, or `design-spec.md`. Use short tooltips for
one concise screen note and collapsed accordion entries when several screens carry
guidance. Review the artboard once with all studio notes closed; it should still be
a coherent, production-like product screen.

Check development readiness explicitly: components map to a consistent recipe,
spacing and typography use declared tokens, content is realistic, interaction and
validation states are present, responsive changes are intentional, and keyboard
focus follows the user journey. A detailed explanation of missing behavior does not
substitute for demonstrating that behavior in Prototype.

## Inspect the rendered result

Run static validation first, fixing its concrete errors in source. Project scales
and declared frames take precedence over generic linter defaults. Then use the
available browser tool to open the actual studio URL and:

1. Verify the loaded design/revision and wait for fonts, images and frames to load.
   Capture and visually inspect each selected screen at narrow and wide declared
   frames; inspect all available variants when comparing alternatives.
2. Check computed foreground/background colors, including CSS variables and parent
   surfaces. Detect clipping and overflow, missing assets, overlapping controls and
   unreadable text. Review console/network errors that affect this design.
3. Exercise the primary journey, changed controls, form validation and back/next
   navigation. Use keyboard navigation and visible focus. Test annotation mode
   separately so a pin cannot accidentally trigger a product action.
4. Switch Canvas, Prototype and Walkthrough; verify that source content, responsive
   frame choices and existing feedback stay consistent. Check long walkthroughs
   through their final step rather than assuming the first eight prove the rest.
5. Record actual screenshots, tested frames/actions, findings and fixes. Re-render
   and recheck affected screens after changes. Submit the resulting browser report
   through the verification utility as documented in [utilities.md](utilities.md).

Do not fabricate measurements or pass a report based only on static markup.
When a browser, screenshot capability or required asset is unavailable, deliver
the source and preview with **unverified** status and the missing check. Failed
checks remain visible until corrected; server health alone is not visual verification.
