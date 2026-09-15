# Shared diagram rules

1. Preserve semantic content in the canonical `.planr-diagram.json` document.
2. Never copy renderer coordinates, palettes, fonts, or automatic layout into canonical IR.
3. Use only primitives allowed by the selected grammar.
4. Keep SVG and HTML static, self-contained, accessible, and free of external URLs.
5. Return a named multi-panel split plan when a readability budget is exceeded.
6. Emit Mermaid or Excalidraw only with the fidelity declared by the grammar registry.
