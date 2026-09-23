# Changelog

All notable changes to ContractGuard are recorded here. The project follows semantic versioning for the rule engine and application packages.

## [1.1.0] - 2026-09-23

### Added

- server-owned multi-LLM profiles for DeepSeek, OpenAI-compatible cloud endpoints, Gemini's compatibility endpoint, and local Ollama;
- a provider selector that exposes only enabled, sanitized profile metadata to the browser;
- strict JSON schemas and checked examples for LLM profiles and rule policies;
- policy-as-code controls for rule enablement, severity overrides, and scoring weights in the CLI and API;
- SHA-256 fingerprints for baseline input, candidate input, and the normalized applied policy;
- policy and input fingerprint metadata in JSON, Markdown, and HTML reports.

### Changed

- generalized the AI prompt, transport, response validation, UI, and documentation from a DeepSeek-only integration to an allowlisted OpenAI Chat adapter;
- added `providerId` to AI review requests and responses while preserving the legacy DeepSeek environment-variable path;
- made the Chat Completions output-token parameter profile-specific, including `max_completion_tokens` for newer OpenAI models;
- extended the Windows launcher with a PowerShell 5.1 implementation, strict preflight/stale-build validation, automatic local-profile discovery, install/build/no-AI modes, and a non-interactive `--check` mode;
- added CLI `--policy` and API `CONTRACTGUARD_POLICY_CONFIG` configuration;
- synchronized the Web, API, CLI, core engine, and workspace versions at `1.1.0`.

### Security

- kept all provider credentials in server-side environment variables; profile JSON stores only `secretEnv` names;
- restricted remote endpoints to HTTPS, rejected redirects and embedded credentials, and limited HTTP to explicitly declared local loopback profiles;
- prevented browser clients from supplying arbitrary model endpoints, headers, or credentials;
- kept automatic cross-provider fallback disabled to avoid unapproved data-boundary changes;
- propagated HTTP disconnect cancellation before the first asynchronous route operation, avoiding orphaned model calls;
- rejected circular or excessively deep object inputs during fingerprinting and preflighted CLI policy file size before reading.

## [1.0.1] - 2026-09-21

### Added

- bounded DeepSeek response streaming and recovery of a single schema-valid JSON review from brief surrounding prose;
- documentation-link and example-configuration checks in the main CI pipeline;
- stricter regression tests for AI output, OpenAPI parsing, local references, CLI escaping, and extension handling;
- responsive and keyboard-accessible Web interactions, including focus restoration and clearer retry states.

### Changed

- synchronized the Web, API, CLI, core engine, and workspace versions at `1.0.1`;
- limited generated AI lists to the documented UI bounds instead of failing an otherwise useful review;
- improved English and Chinese project documentation, security guidance, and reproducible verification records.

### Security

- capped DeepSeek response bodies at 128 KiB before parsing;
- tightened analysis ID, filename, and local JSON Pointer validation;
- used owner-only permissions for temporary analysis files where supported and guaranteed cleanup after writes.

## [1.0.0] - 2026-09-18

- Initial public release with a deterministic OpenAPI 3.0/3.1 compatibility engine, Web workspace, REST API, CLI/CI gate, local report history, exports, Docker support, and an optional DeepSeek explanation layer.

[1.0.1]: https://github.com/mingxian233/ContractGuard/compare/24466123b5dee1178e8dc3df26665a807027a16a...v1.0.1
[1.0.0]: https://github.com/mingxian233/ContractGuard/commit/24466123b5dee1178e8dc3df26665a807027a16a
[1.1.0]: https://github.com/mingxian233/ContractGuard/compare/v1.0.1...v1.1.0
