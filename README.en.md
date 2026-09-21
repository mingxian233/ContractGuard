# ContractGuard

English · [简体中文](README.md)

[![CI](https://github.com/mingxian233/ContractGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/mingxian233/ContractGuard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f6f61.svg)](LICENSE)
[![Node.js >= 22.13](https://img.shields.io/badge/Node.js-%3E%3D22.13-3c873a.svg)](package.json)

**A local-first, explainable OpenAPI backward-compatibility analyzer for human review and CI quality gates.**

ContractGuard compares a released OpenAPI contract (the baseline) with a proposed contract (the candidate) and identifies changes that may break existing consumers. It goes beyond showing what changed: each finding includes a severity, stable rule ID, precise contract location, relevant before/after evidence, and remediation guidance.

All compatibility decisions come from a deterministic rule engine. The optional DeepSeek integration only turns existing findings into a risk summary, migration plan, and test suggestions; it does not participate in scoring or release gating.

The current release targets OpenAPI 3.0 and 3.1. Refer to the official [OpenAPI 3.0.4 specification](https://spec.openapis.org/oas/v3.0.4.html), [OpenAPI 3.1.2 specification](https://spec.openapis.org/oas/v3.1.2.html), and [published specification index](https://spec.openapis.org/oas/) for the authoritative syntax.

## Why it exists

Two OpenAPI documents can both be valid while the newer contract still breaks old clients. For example:

- making an optional query parameter required causes an old app to receive `400` responses;
- removing a response property breaks a frontend or SDK that still reads it;
- narrowing a request enum rejects input that used to be valid;
- widening a response enum surprises clients with exhaustive branches;
- changing a success status or adding authentication changes an established call flow.

A validator answers whether a document is syntactically valid. A text diff answers which lines changed. ContractGuard answers the release question: **where might existing consumers fail, why, and what should the team migrate or test first?**

## Where it fits

| Scenario | How ContractGuard helps |
| --- | --- |
| Pull request gate | Compare the released and proposed contracts in CI and return exit code `2` when findings reach the selected threshold |
| API design review | Inspect risk locations, evidence, and remediation in the Web workspace before implementation |
| SDK/client migration | Export Markdown or HTML and optionally generate a staged migration and regression-test checklist |
| Version audit and handoff | Feed JSON reports into automation and keep reviewable analysis history in local files |

ContractGuard is a static contract analyzer. It is not runtime monitoring, an API security scanner, or production traffic validation.

## Capabilities

| Capability | Current implementation |
| --- | --- |
| Deterministic rule engine | Checks paths, operations, parameters, request bodies, responses, media types, schemas, security, and selected metadata |
| Direction-aware analysis | Reasons separately about accepted requests and produced responses instead of classifying identical schema edits mechanically |
| Explainable findings | Returns a stable rule ID, severity, contract location, before/after evidence, and remediation guidance |
| Web workspace | Imports, drops, or pastes two YAML/JSON specifications; filters results, opens history, browses rules, and exports reports |
| CLI and CI gate | Supports `table`, `json`, `markdown`, and `html` output with configurable failure thresholds |
| REST API | Creates, reads, and deletes analyses; lists rules; exports JSON, Markdown, and HTML reports |
| Local persistence | Stores analysis records as local JSON files with no database requirement |
| Optional DeepSeek review | Produces a structured summary, migration steps, and test suggestions from bounded finding context |

## Run it in five minutes

### 1. Prerequisites

- Node.js 22.13 or newer;
- pnpm 11.19.0, pinned by the repository's `packageManager` field and lockfile.

Node.js 22 installations can normally enable pnpm through Corepack:

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
```

If Corepack is not available:

```bash
npm install --global pnpm@11.19.0
```

### 2. Install, build, and start

```bash
git clone https://github.com/mingxian233/ContractGuard.git
cd ContractGuard
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open `http://localhost:8080`, select “载入演示规范” (load demo contracts), and then select “运行兼容性分析” (run compatibility analysis). AI is disabled by default, so the first analysis requires no API key and makes no model request.

For development:

```bash
pnpm dev
```

The Web development server runs at `http://localhost:5173` and proxies `/api` to the API on local port `8080`.

### Windows launcher

If PowerShell blocks `pnpm.ps1`, use the `.cmd` entry point:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
.\start-contractguard.bat
```

The launcher prompts for an optional DeepSeek API key. Press Enter to run only the local deterministic analyzer. A supplied key exists only in that server process environment and is not written to a project file.

## CLI and CI usage

After building, run the bundled breaking-change example:

```bash
pnpm demo
```

To write a Markdown report and fail when a `breaking` finding is present:

```bash
pnpm contractguard compare fixtures/petstore-v1.yaml fixtures/petstore-v2-breaking.yaml --format markdown --output contractguard-report.md --fail-on breaking
```

`--fail-on` accepts `breaking`, `potentially-breaking`, or `never`. Exit codes are:

- `0`: analysis completed and did not reach the selected threshold;
- `1`: file, parsing, or execution error;
- `2`: one or more findings reached the selected threshold.

A reusable workflow is available at [`examples/github-actions-contractguard.yml`](examples/github-actions-contractguard.yml). It assumes `openapi/released.yaml` and `openapi/candidate.yaml`; replace those paths for your repository.

## Optional DeepSeek integration

AI review is not required for core analysis. It must be enabled explicitly in the API server environment:

```dotenv
CONTRACTGUARD_AI_ENABLED=true
DEEPSEEK_API_KEY=<YOUR_DEEPSEEK_API_KEY>
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
CONTRACTGUARD_AI_TIMEOUT_MS=30000
CONTRACTGUARD_AI_MAX_CHANGES=50
CONTRACTGUARD_AI_MAX_OUTPUT_TOKENS=8192
```

`.env.example` is a configuration template. A directly started Node.js process does not load arbitrary `.env` files, so inject the variables through the current shell, a process manager, or the container environment. On Windows, `start-contractguard.bat` is the safer path because it keeps the key out of command history.

Data and decision boundaries:

- the API key is read server-side and is never returned to the browser;
- the default request excludes the original OpenAPI documents and full finding `before`/`after` objects;
- the model receives bounded finding summaries, which may still contain private endpoint names;
- every model response must pass runtime structure validation;
- model output cannot alter rule severity, compatibility score, the `compatible` flag, or CI exit codes.

See the [AI report interpreter guide](docs/ai-report-interpreter.md) for complete PowerShell, bash, Docker, status-check, and API examples. Cloud model usage may incur fees; review your organization's data and privacy policy before enabling it.

## Docker

```bash
docker compose up --build
```

Open `http://localhost:8080`. Compose binds to `127.0.0.1` by default and stores analysis history in a Docker volume. The project does not provide authentication, TLS, tenant isolation, rate limiting, or AI budget controls. Do not expose it directly to the public Internet; see the [Security Policy](SECURITY.md) for deployment requirements.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `pnpm` is not found | Run `corepack enable` and `corepack prepare pnpm@11.19.0 --activate`, or install the pinned version with npm |
| PowerShell blocks `pnpm.ps1` | Use `pnpm.cmd` instead; changing the system execution policy is unnecessary |
| The UI reports that the analysis engine is offline | Confirm that the API is listening on port `8080`; in development, keep both processes launched by `pnpm dev` running |
| The CLI exits with code `2` | This is the expected policy result when findings reach `--fail-on`, not a program crash |
| AI is disabled or not configured | Set both `CONTRACTGUARD_AI_ENABLED=true` and `DEEPSEEK_API_KEY`, then restart the API process |
| AI returns invalid or truncated JSON | Retry; if it persists, increase `CONTRACTGUARD_AI_MAX_OUTPUT_TOKENS` or reduce `CONTRACTGUARD_AI_MAX_CHANGES` |

See the [user-guide troubleshooting section](docs/user-guide.md#11-故障排查) and [AI error reference](docs/ai-report-interpreter.md#10-错误与降级) for more detail.

## How it works

```mermaid
flowchart LR
    A[Baseline OpenAPI] --> P[Parse and normalize]
    B[Candidate OpenAPI] --> P
    P --> D[Direction-aware comparison]
    D --> R[Deterministic rules]
    R --> S[Score and findings]
    S --> W[Web review]
    S --> C[CLI / CI gate]
    S --> E[JSON / Markdown / HTML]
    S --> M[Bounded finding context]
    M --> AI[Optional DeepSeek explanation]
```

The Web app, REST API, and CLI reuse the same core engine. DeepSeek lives on a separate explanatory branch; analysis, gating, and report export continue to work when the model is disabled or unavailable.

## Repository layout

```text
apps/
  api/       REST API, local persistence, report export, DeepSeek adapter
  cli/       local and CI command-line entry point
  web/       Vue 3 Web workspace
packages/
  core/      OpenAPI parsing, local reference resolution, rules, and scoring
fixtures/    reproducible compatible/breaking examples and evaluation manifest
examples/    GitHub Actions and AI request examples
docs/        architecture, rules, API, usage, development, evaluation, and verification
scripts/     end-to-end smoke test
```

The engineering focus is broader than “adding an LLM”: it covers domain-rule modeling, shared frontend/backend behavior, a stable CLI contract, reproducible fixtures, automated testing, CI gating, and a trustworthy separation between generative explanation and deterministic decisions.

## Verification

```bash
pnpm check
```

`pnpm check` runs the build, type checks, tests, documentation-link and example-configuration checks, and end-to-end smoke validation. Use `pnpm docs:check`, `pnpm config:check`, or `pnpm smoke` to rerun those stages independently. GitHub Actions performs the same class of checks on Node.js 22 and verifies that the breaking fixture triggers the expected gate. See [`docs/verification.md`](docs/verification.md) for the recorded local validation scope; it is not a claim of accuracy across every real-world OpenAPI document.

## Current scope

ContractGuard focuses on OpenAPI 3.0/3.1 and same-document JSON Pointer `$ref` values. The following still require other tools or human review:

- Swagger 2.0;
- external URL and cross-file references;
- general `oneOf`, `anyOf`, `allOf`, discriminator, and other composition semantics;
- business rules, database migrations, performance, SLAs, and runtime traffic behavior;
- complete consumer-contract testing, integration testing, and progressive delivery.

The compatibility score is a heuristic for risk ordering, not a mathematical proof of production safety. See [`docs/compatibility-rules.md`](docs/compatibility-rules.md) for rule coverage and decision semantics.

## Documentation

- [Project background, scenarios, and portfolio value](docs/project-overview.md)
- [User guide](docs/user-guide.md)
- [Architecture](docs/architecture.md)
- [Compatibility rules](docs/compatibility-rules.md)
- [REST API](docs/api-reference.md)
- [DeepSeek report interpreter](docs/ai-report-interpreter.md)
- [Development guide](docs/development.md)
- [Evaluation methodology](docs/evaluation.md)
- [Verification record](docs/verification.md)
- [Delivery and release checklist](docs/delivery-checklist.md)
- [Security Policy](SECURITY.md)

## License

[MIT](LICENSE)
