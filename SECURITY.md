# Security Policy

ContractGuard is designed first for local, single-user analysis. The default server listens on the loopback interface, and Docker Compose publishes the service only on `127.0.0.1`. These defaults reduce accidental exposure; they are not a substitute for authentication or production hardening.

## Supported version

Security fixes are applied to the current `main` branch. Older commits, forks, and locally modified deployments are not maintained separately. When reporting a problem, include the affected commit or release and whether the default configuration was changed.

## Reporting a vulnerability

Do not disclose a suspected vulnerability, leaked credential, or unsafe deployment detail in a public issue.

1. Use GitHub private vulnerability reporting from the repository's **Security** tab when that option is available.
2. If private reporting is unavailable, contact the repository owner through a private channel listed on the owner's GitHub profile before publishing technical details.
3. Include the affected version or commit, a minimal reproduction, expected impact, relevant configuration, and any known workaround.

Do not include real API keys, private OpenAPI documents, customer data, access tokens, production URLs, or unredacted analysis files in the report. Use synthetic examples wherever possible.

## Security model and trust boundaries

ContractGuard has three distinct data paths:

1. **Deterministic analysis:** baseline and candidate documents are parsed by the local API process and are not sent to a ContractGuard-operated cloud service.
2. **Local persistence:** completed analyses are written as JSON files under `CONTRACTGUARD_DATA_DIR` (default `./data/analyses`). These records can include endpoint names and before/after evidence.
3. **Optional DeepSeek review:** only after an explicit AI review request, the API server sends bounded finding summaries to the configured DeepSeek-compatible endpoint.

The application does not include authentication, authorization, tenant isolation, encryption at rest, TLS termination, request quotas, or audit logging. Any process or network client that can reach the API may be able to create, read, export, or delete analysis records. CORS settings limit browser origins; **CORS is not access control**.

## Credential handling

Deterministic compatibility analysis requires no cloud credential. The optional AI integration reads `DEEPSEEK_API_KEY` from the API server process environment.

- Never commit a populated `.env` file.
- Never put a key in browser code, an OpenAPI document, an API request body, a test fixture, an issue, or a screenshot.
- Prefer a secret manager with narrowly scoped access for any shared deployment.
- Rotate a key immediately if it appears in Git history, CI logs, terminal transcripts, reports, or other shared material.
- Treat a deleted secret as compromised until it has been rotated; removing it from the latest commit is not sufficient.

The Windows launcher reads a supplied key without echoing it, exposes it only to the launched server process, and removes it from that launcher environment when the process exits. It does not write the key to a project file. Environment variables may still be visible to privileged local processes, so do not treat this as hardware-backed secret storage.

## AI data boundary

The default AI request excludes the original baseline/candidate documents and full finding `before`/`after` objects. It includes bounded metadata and finding fields such as rule ID, severity, location, message, and recommendation. Those fields may still reveal internal endpoint names, schema names, or business terminology.

Before enabling AI review:

- confirm that the chosen endpoint, model, account, region, retention terms, and pricing are acceptable;
- classify and, when necessary, sanitize contract names and endpoint paths;
- restrict outbound network access to the intended provider;
- add per-user or per-service rate and cost limits for shared deployments;
- review generated guidance as untrusted advisory content.

Runtime schema validation protects the application from malformed model output. It does not make generated prose authoritative, correct, or safe to execute. Model output never changes deterministic finding severity, score, compatibility status, or CLI exit codes.

## Local data protection

Analysis history is not encrypted by ContractGuard. Protect `CONTRACTGUARD_DATA_DIR` with operating-system permissions appropriate to the sensitivity of the contracts. For shared or long-running deployments, define retention, backup, deletion, and access-review policies before collecting data.

The repository ignores runtime analysis files, `.env` files, logs, build output, and generated reports by default. Before publishing changes, review both tracked and untracked files:

```bash
git status --short
git diff --check
```

Do not assume `.gitignore` can protect a file that has already been committed.

## Input and service limits

The API applies a configurable per-specification size limit (`CONTRACTGUARD_MAX_SPEC_BYTES`, 5 MiB by default) and validates supported input structure. These controls reduce accidental resource use but are not a complete denial-of-service defense. Local references and complex schemas can still consume CPU or memory.

For any environment with untrusted clients, add limits at a reverse proxy or gateway, including:

- authenticated request size and rate limits;
- connection, request, and upstream timeouts;
- process CPU and memory limits;
- concurrency and storage quotas;
- monitoring for repeated parse failures and AI usage spikes.

## Deployment requirements

Do not expose the built-in API directly to the public Internet. A hosted deployment should add, at minimum:

- TLS at a maintained reverse proxy or gateway;
- authentication and least-privilege authorization;
- tenant isolation where more than one trust domain is present;
- request size, rate, concurrency, storage, and AI cost limits;
- secret management and key rotation;
- outbound allow-listing for optional AI calls;
- protected storage, backups, retention, and secure deletion;
- dependency scanning, logging, monitoring, and incident response.

Keep `HOST=127.0.0.1` for local use. Binding to `0.0.0.0`, changing the Compose port mapping, or placing the service behind a public hostname expands the trust boundary and requires the controls above.

## Dependency and configuration hygiene

- Install the locked dependency graph with `pnpm install --frozen-lockfile`.
- Review automated dependency updates and CI results before merging.
- Use only the expected Node.js and pnpm versions documented in the repository.
- Keep DeepSeek base URLs and proxy configuration under administrator control; do not accept arbitrary upstream URLs from end users.
- Treat imported OpenAPI documents and exported HTML/Markdown as untrusted data when integrating them into other systems.

## Explicit non-goals

ContractGuard is not an API penetration-testing tool, malware scanner, secrets scanner, authorization verifier, or compliance certification system. A “compatible” result means no definitely breaking change was found by the implemented static rules; it does not establish that an API is secure, available, legally compliant, or safe to deploy.
