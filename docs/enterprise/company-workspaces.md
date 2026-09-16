# Company workspace development

Status: implemented local integration; not deployed or approved for company data.

The portable company contracts are owned by `packages/protocol/src/enterprise-contracts.mjs` (Protocol 1.12). Company API and frontend deployment are owned by the separate `openplanr-web` repository. Do not copy company storage into the existing encrypted token-share Worker. Accepted repository content stays in Git/.planr; hosted revisions are shared collaboration state. Browser proposals do not execute code.

## Use the development workflow

The canonical CLI now exposes `planr company --help`. See the bundled [company review workflow](../../skills/planr-artifact/references/company-review.md) for explicit publication preview, push, proposal review, local application and interruption recovery. Browser sign-in uses `planr company login` against the branded hosted service by default, with public-client PKCE, organization consent, private credential storage, renewable access, and explicit logout. `--api-url <origin>` and manual token input remain development fallbacks. The configured Clerk instance must pass live callback, consent, renewal, revocation and organization-isolation checks before pilot use.

The web repository provides the isolated Worker under `company/`, configuration and safe operations in `company/OPERATIONS.md`, and the workspace UI under `/dashboard`. Required origins and Clerk configuration have no permissive fallback. Missing service configuration yields an unavailable state; it never substitutes seed content. Admin metadata inventory grants no content access. Project recovery is explicit and audited.

## Validation and release

Run Protocol and company CLI tests, command-catalog checks, generated-asset checks and packed-workspace verification here. In the web repository run `npm test`, `npm run company:check`, `npm run company:test`, `npm run company:test:browser`, `npm run company:dry-run`, `npm run share:check`, `npm run share:dry-run`, and `npm run build`. Browser fixtures are isolated from production auth and report measured workloads without inventing SLOs.

The program is tracked privately in SPEC-013 / BL-022. M0–M2 code completion is not enterprise availability. Live identity/browser onboarding, live renewable CLI acceptance, tested multi-store recovery, paid customer cycles, later authoring/integrations/administration and independent security assessment still govern rollout. No availability, residency, compliance or procurement claim may exceed demonstrated evidence.
