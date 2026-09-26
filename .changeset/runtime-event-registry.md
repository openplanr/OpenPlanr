---
'planr-pipeline': patch
---

The Operate runtime reducer and the experience-projection replay check now read one Event registry (`lib/operate/runtime-foundation/event-registry.mjs`) for the handler, entity identity and parity rule of every Protocol 2.0 Event type. Event handling, replay validation and the `planr-pipeline/operate/runtime-v2` and `planr-pipeline/operate/experience-projection-v2` exports are unchanged.
