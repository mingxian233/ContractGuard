# Contributing to ContractGuard

Thanks for helping make OpenAPI compatibility checks more useful and trustworthy. The most valuable contributions are small, reproducible examples of a false positive, a missed breaking change, or an unclear explanation.

## Before opening an issue

- Remove credentials, internal hostnames, customer data, and other sensitive content from every specification and log.
- Reduce the baseline and candidate to the smallest pair that still reproduces the behavior.
- Check the documented [rule semantics](docs/compatibility-rules.md) and [current boundaries](README.md#current-boundaries).
- Report security concerns through the process in [SECURITY.md](SECURITY.md), not a public issue.

## Local development

Prerequisites: Node.js 22.13+ and pnpm 11.19.0.

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm check
```

Useful focused commands:

```bash
pnpm --filter @contractguard/core test
pnpm --filter @contractguard/api test
pnpm --filter @contractguard/web typecheck
pnpm smoke
```

The full development guide is in [`docs/development.md`](docs/development.md).

## Adding or changing a compatibility rule

A rule change should include:

1. a stable rule ID and a clear request/response direction;
2. an atomic positive case that should emit the finding;
3. a negative case that must not emit it;
4. at least one boundary case when the OpenAPI or JSON Schema semantics are ambiguous;
5. an actionable recommendation and relevant before/after evidence;
6. updates to [`docs/compatibility-rules.md`](docs/compatibility-rules.md) and fixtures when the public behavior changes.

When exact compatibility cannot be established from the contract alone, prefer an explicit `potentially-breaking` finding or a documented non-goal over a confident but unsupported result.

## Pull requests

- Keep each pull request focused on one behavior or concern.
- Explain the consumer impact, not only the code change.
- Add or update tests before changing expected fixture results.
- Run `pnpm check`; if the environment prevents a stage from running, state exactly which command was not verified.
- Do not include generated build output, API keys, `.env` files, or analysis history.

By contributing, you agree that your contribution is provided under the repository's [MIT License](LICENSE).
