# Changelog

All notable changes to ContractGuard are recorded here. The project follows semantic versioning for the rule engine and application packages.

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
