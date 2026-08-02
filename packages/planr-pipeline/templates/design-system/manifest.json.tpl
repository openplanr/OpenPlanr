{
  "$comment": "Machine-readable design-system manifest (planr v0.18.0). Written by /planr-pipeline:design alongside tokens.css; read by lib/design/designSystem.mjs. The generator replaces values with the project's real brand and keeps this in sync with tokens.css. kind ∈ color|font|spacing|radius|shadow|motion.",
  "name": "GENERATOR:name",
  "tokens": [
    { "name": "--background", "value": "#ffffff", "kind": "color" },
    { "name": "--foreground", "value": "#14181f", "kind": "color" },
    { "name": "--muted-foreground", "value": "#5b6472", "kind": "color" },
    { "name": "--primary", "value": "#3b5bdb", "kind": "color" },
    { "name": "--primary-foreground", "value": "#ffffff", "kind": "color" },
    { "name": "--border", "value": "#e6e8ee", "kind": "color" },
    { "name": "--ring", "value": "#3b5bdb", "kind": "color" },
    { "name": "--font-sans", "value": "-apple-system, system-ui, sans-serif", "kind": "font" },
    { "name": "--text-base", "value": "14px", "kind": "font" },
    { "name": "--space-4", "value": "16px", "kind": "spacing" },
    { "name": "--radius-md", "value": "8px", "kind": "radius" },
    { "name": "--shadow-md", "value": "0 4px 12px rgba(20,24,31,.10)", "kind": "shadow" },
    { "name": "--duration-base", "value": "180ms", "kind": "motion" },
    { "name": "--background", "value": "#0e1116", "kind": "color", "scope": ".dark" },
    { "name": "--foreground", "value": "#e9edf4", "kind": "color", "scope": ".dark" }
  ],
  "themes": [{ "selector": ".dark", "label": "Dark" }],
  "fonts": [{ "family": "GENERATOR:font", "status": "ok" }],
  "frames": { "desktop": { "w": 1440, "h": 1024 }, "tablet": { "w": 834, "h": 1194 }, "mobile": { "w": 390, "h": 844 } },
  "breakpoints": { "desktop": 1280, "tablet": 768 },
  "source": "planr-design"
}
