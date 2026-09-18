# Security Policy

## Reporting a vulnerability

Please do not disclose a suspected vulnerability, leaked credential, or unsafe deployment detail in a public issue. Use GitHub private vulnerability reporting when it is available for the repository, or contact the repository owner privately before publishing technical details.

Include the affected version, a minimal reproduction, expected impact, and any known workaround. Do not include real API keys, private OpenAPI documents, customer data, or production URLs in the report.

## Credential handling

ContractGuard does not require cloud credentials for deterministic compatibility analysis. The optional DeepSeek integration reads `DEEPSEEK_API_KEY` only from the API server process environment.

- Never commit a populated `.env` file.
- Never place a key in browser code, an OpenAPI document, an issue, or a test fixture.
- Rotate a key immediately if it is accidentally exposed.
- Prefer a restricted secret manager for shared or hosted deployments.

The Windows launcher keeps a supplied key in the child process environment for the lifetime of that run and removes it when the process exits. It does not write the key to a project file.

## Deployment boundary

The repository is configured for local use and does not include user authentication, tenant isolation, TLS termination, request quotas, or billing controls. Do not expose the API directly to the public Internet. A hosted deployment should add, at minimum:

- TLS at a trusted reverse proxy;
- authentication and authorization;
- request size and rate limits;
- secret management and key rotation;
- network egress restrictions;
- storage access controls and retention rules;
- AI usage and cost limits.

Analysis history may contain private endpoint names and before/after contract evidence. Protect the configured data directory accordingly.

## Supported version

Security fixes are applied to the current default branch. Older snapshots and locally modified deployments are not maintained separately.
