# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in OpenPlanr, please report it responsibly.

**Do not open a public issue.** Instead, email us at:

**security@openplanr.dev**

Please include:

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fix (optional)

## Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 5 business days
- **Fix release:** as soon as possible, depending on severity

## Scope

OpenPlanr is a CLI tool that generates markdown files and interacts with AI APIs. Security concerns may include:

- Command injection through user input or artifact content
- Unintended exposure of API keys or credentials
- Malicious content in generated templates or rule files
- Dependency vulnerabilities

## Best Practices for Users

- Never commit `.env` files or API keys to your repository
- Keep your dependencies up to date (`npm audit`)
- Review generated AI rule files before committing them
