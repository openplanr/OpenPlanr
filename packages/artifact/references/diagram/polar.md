# Polar chart

- Grammar ID: `polar`
- Layout family: `chart`
- Required primitives: `series`, `axis`
- Allowed primitives: `node`, `series`, `axis`, `annotation`, `emphasis`
- Directions: `radial`
- Mermaid: `unsupported`
- Excalidraw: `editable`

## Renderer mapping

Declare the category axis first and a linear value scale second. Spokes and equal-angle sectors follow value keys in first-appearance order across series, including ordinal category axes. Values share a zero-centred scale and must be finite and non-negative; duplicate keys are rejected. Every radar series must include every spoke. The category axis also accepts the legacy linear declaration; category positions still come from keys. Each series draws a closed polygon. Polar draws one sector per value with radius proportional to the value; multiple series divide each key's angle into equal slots, leaving missing values empty. Zero values remain at the centre.

Canonical SVG, HTML and PNG include the radial grid, category labels and series legend. Editable Excalidraw export and authoring migration are unsupported; the runtime emits a fidelity report without an editable file.

## Use this grammar

Polar chart semantic grammar using the chart layout family.

## Readability

Simplified 7; balanced 12; faithful 24; hard split threshold 24. Labels stay within 80 characters, with at most 12 crossings and 6 incoming relations per item.
